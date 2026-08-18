export interface Env {
  ASSETS: Fetcher;
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
