import { describe, it, expect } from 'vitest';
import worker from '../../edge/src/index.js';

describe('Edge Worker Media Routing & Security Tests', () => {
  const fakeMediaStore = new Map<string, { body: Uint8Array; contentType: string; contentDisposition: string; etag: string }>();

  fakeMediaStore.set('receipts/exp_123_bill.jpg', {
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    contentType: 'image/jpeg',
    contentDisposition: 'inline; filename="receipt.jpg"',
    etag: '"etag-receipt-123"',
  });

  fakeMediaStore.set('lottery/background/bgm_123.mp3', {
    body: new Uint8Array([0x49, 0x44, 0x33, 0x03]),
    contentType: 'audio/mpeg',
    contentDisposition: 'inline; filename="anthem.mp3"',
    etag: '"etag-bgm-123"',
  });

  const mockBucket: any = {
    get: async (key: string) => {
      const item = fakeMediaStore.get(key);
      if (!item) return null;
      return {
        body: item.body,
        size: item.body.length,
        httpEtag: item.etag,
        httpMetadata: {
          contentType: item.contentType,
          contentDisposition: item.contentDisposition,
        },
      };
    },
    head: async (key: string) => {
      const item = fakeMediaStore.get(key);
      if (!item) return null;
      return {
        size: item.body.length,
        httpEtag: item.etag,
        httpMetadata: {
          contentType: item.contentType,
          contentDisposition: item.contentDisposition,
        },
      };
    },
  };

  const mockAssets: any = {
    fetch: async (req: Request) => {
      return new Response('<html>SPA Shell</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  };

  const env = {
    ASSETS: mockAssets,
    MEDIA_BUCKET: mockBucket,
    UPSTREAM_ORIGIN: 'http://localhost:3000',
  };

  it('1. GET /media/* streams object directly from R2 with immutable cache header and nosniff', async () => {
    const request = new Request('https://12a1-stage.tuananhdg.eu.org/media/receipts/exp_123_bill.jpg', {
      method: 'GET',
    });

    const response = await worker.fetch(request, env, {} as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="receipt.jpg"');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('ETag')).toBe('"etag-receipt-123"');

    const bodyBytes = new Uint8Array(await response.arrayBuffer());
    expect(bodyBytes).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  });

  it('2. HEAD /media/* returns headers with 200 and no body', async () => {
    const request = new Request('https://12a1-stage.tuananhdg.eu.org/media/lottery/background/bgm_123.mp3', {
      method: 'HEAD',
    });

    const response = await worker.fetch(request, env, {} as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('ETag')).toBe('"etag-bgm-123"');
  });

  it('3. GET /media/* returns 404 with security headers when object does not exist', async () => {
    const request = new Request('https://12a1-stage.tuananhdg.eu.org/media/receipts/non_existent.jpg', {
      method: 'GET',
    });

    const response = await worker.fetch(request, env, {} as any);
    expect(response.status).toBe(404);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('4. Rejects path traversal and malformed media keys with 400 Bad Request', async () => {
    const badKeys = [
      'https://12a1-stage.tuananhdg.eu.org/media/receipts%2F..%2Fsecret.txt',
      'https://12a1-stage.tuananhdg.eu.org/media/receipts%5Cmalicious.jpg',
      'https://12a1-stage.tuananhdg.eu.org/media/receipts%00malicious.jpg',
      'https://12a1-stage.tuananhdg.eu.org/media/',
      'https://12a1-stage.tuananhdg.eu.org/media',
    ];

    for (const url of badKeys) {
      const request = new Request(url, { method: 'GET' });
      const response = await worker.fetch(request, env, {} as any);
      expect(response.status).toBe(400);
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('5. Rejects non GET/HEAD methods on /media/* with 405 Method Not Allowed', async () => {
    const postReq = new Request('https://12a1-stage.tuananhdg.eu.org/media/receipts/test.jpg', {
      method: 'POST',
      body: 'test',
    });
    const postRes = await worker.fetch(postReq, env, {} as any);
    expect(postRes.status).toBe(405);
    expect(postRes.headers.get('Allow')).toBe('GET, HEAD');

    const delReq = new Request('https://12a1-stage.tuananhdg.eu.org/media/receipts/test.jpg', {
      method: 'DELETE',
    });
    const delRes = await worker.fetch(delReq, env, {} as any);
    expect(delRes.status).toBe(405);
  });

  it('6. Returns 503 if MEDIA_BUCKET is not bound in env', async () => {
    const envWithoutBucket = {
      ASSETS: mockAssets,
      UPSTREAM_ORIGIN: 'http://localhost:3000',
    };

    const request = new Request('https://12a1-stage.tuananhdg.eu.org/media/receipts/test.jpg', {
      method: 'GET',
    });

    const response = await worker.fetch(request, envWithoutBucket as any, {} as any);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('Media bucket not configured');
  });
});
