export interface Env {
  ASSETS: Fetcher;
  MEDIA_BUCKET?: R2Bucket;
  UPSTREAM_ORIGIN?: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; media-src 'self' blob: data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. API and Health routes MUST pass through to upstream origin directly (A23 Fastify via Cloudflare Tunnel)
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health/')) {
      if (env.UPSTREAM_ORIGIN) {
        const upstreamUrl = new URL(url.pathname + url.search, env.UPSTREAM_ORIGIN);
        const upstreamRequest = new Request(upstreamUrl.toString(), request);
        return fetch(upstreamRequest);
      }
      // Native Cloudflare Worker subrequest to origin zone (bypasses Worker route, preventing proxy loops)
      return fetch(request);
    }

    // 2. Media Route (/media/*) served directly from Cloudflare R2
    if (url.pathname === '/media' || url.pathname.startsWith('/media/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', {
          status: 405,
          headers: {
            ...SECURITY_HEADERS,
            Allow: 'GET, HEAD',
          },
        });
      }

      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(url.pathname);
      } catch {
        return new Response('Bad Request: Invalid encoding', {
          status: 400,
          headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      const mediaKey = decodedPath.replace(/^\/media\/?/, '');

      // Traversal and security validation
      const segments = mediaKey.split('/');
      if (
        !mediaKey ||
        mediaKey.includes('\0') ||
        mediaKey.includes('\\') ||
        mediaKey.startsWith('/') ||
        segments.includes('..') ||
        segments.includes('.')
      ) {
        return new Response('Bad Request: Invalid media key', {
          status: 400,
          headers: {
            ...SECURITY_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }

      if (!env.MEDIA_BUCKET) {
        return new Response('Service Unavailable: Media bucket not configured', {
          status: 503,
          headers: {
            ...SECURITY_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }

      if (request.method === 'HEAD') {
        const headObj = await env.MEDIA_BUCKET.head(mediaKey);
        if (!headObj) {
          return new Response('Not Found', {
            status: 404,
            headers: {
              ...SECURITY_HEADERS,
              'Content-Type': 'text/plain; charset=utf-8',
            },
          });
        }

        const headers = new Headers();
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
          headers.set(k, v);
        }
        headers.set('Content-Type', headObj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Content-Disposition', headObj.httpMetadata?.contentDisposition || 'inline');
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Content-Length', headObj.size.toString());
        if (headObj.httpEtag) {
          headers.set('ETag', headObj.httpEtag);
        }

        return new Response(null, { status: 200, headers });
      }

      const obj = await env.MEDIA_BUCKET.get(mediaKey);
      if (!obj) {
        return new Response('Not Found', {
          status: 404,
          headers: {
            ...SECURITY_HEADERS,
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }

      const headers = new Headers();
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        headers.set(k, v);
      }
      headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
      headers.set('Content-Disposition', obj.httpMetadata?.contentDisposition || 'inline');
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Content-Length', obj.size.toString());
      if (obj.httpEtag) {
        headers.set('ETag', obj.httpEtag);
      }

      return new Response(obj.body, { status: 200, headers });
    }

    // 2. Static Assets (React SPA + static assets with single-page-application fallback)
    const assetResponse = await env.ASSETS.fetch(request);

    // Create a new response with injected security and cache headers
    const newHeaders = new Headers(assetResponse.headers);

    // Apply standard web application security headers
    for (const [headerName, headerValue] of Object.entries(SECURITY_HEADERS)) {
      newHeaders.set(headerName, headerValue);
    }

    // Dynamic cache control policy for static assets
    const contentType = newHeaders.get('content-type') || '';
    if (url.pathname.startsWith('/assets/')) {
      // Hashed Vite static assets (immutable)
      newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (contentType.includes('text/html')) {
      // HTML shell (must revalidate to guarantee instant delivery of fresh releases)
      newHeaders.set('Cache-Control', 'public, max-age=0, must-revalidate');
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers: newHeaders,
    });
  },
};
