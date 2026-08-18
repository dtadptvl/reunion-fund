import { describe, it, expect, vi } from 'vitest';
import worker, { Env } from '../../edge/src/index';

describe('Edge Worker Routing & Security (H1 Hybrid Staging)', () => {
  it('passes /api/* routes directly to upstream origin without touching ASSETS', async () => {
    const mockAssets: any = {
      fetch: vi.fn(),
    };
    const env: Env = {
      ASSETS: mockAssets,
      UPSTREAM_ORIGIN: 'http://127.0.0.1:3000',
    };

    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ total_raised: 5000000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const request = new Request('https://12a1-stage.tuananhdg.eu.org/api/v1/public/overview', {
      method: 'GET',
      headers: { 'X-Custom-Header': 'test-val' },
    });

    const response = await worker.fetch(request, env, {} as any);

    expect(mockAssets.fetch).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const forwardedReq = mockFetch.mock.calls[0][0] as Request;
    expect(forwardedReq.url).toBe('http://127.0.0.1:3000/api/v1/public/overview');
    expect(await response.json()).toEqual({ total_raised: 5000000 });

    vi.unstubAllGlobals();
  });

  it('passes /health/* routes directly to upstream origin', async () => {
    const mockAssets: any = {
      fetch: vi.fn(),
    };
    const env: Env = {
      ASSETS: mockAssets,
      UPSTREAM_ORIGIN: 'http://127.0.0.1:3000',
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', mockFetch);

    const request = new Request('https://12a1-stage.tuananhdg.eu.org/health/live', {
      method: 'GET',
    });

    const response = await worker.fetch(request, env, {} as any);

    expect(mockAssets.fetch).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ status: 'ok' });

    vi.unstubAllGlobals();
  });

  it('serves SPA HTML shell with security headers and must-revalidate cache policy', async () => {
    const mockAssets: any = {
      fetch: vi.fn().mockResolvedValue(
        new Response('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      ),
    };
    const env: Env = { ASSETS: mockAssets };

    const request = new Request('https://12a1-stage.tuananhdg.eu.org/login', {
      method: 'GET',
    });

    const response = await worker.fetch(request, env, {} as any);

    expect(mockAssets.fetch).toHaveBeenCalledTimes(1);
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
  });

  it('serves hashed assets with immutable long-lived cache headers', async () => {
    const mockAssets: any = {
      fetch: vi.fn().mockResolvedValue(
        new Response('console.log("app");', {
          status: 200,
          headers: { 'Content-Type': 'application/javascript' },
        })
      ),
    };
    const env: Env = { ASSETS: mockAssets };

    const request = new Request('https://12a1-stage.tuananhdg.eu.org/assets/index-D0xVpM6X.js', {
      method: 'GET',
    });

    const response = await worker.fetch(request, env, {} as any);

    expect(mockAssets.fetch).toHaveBeenCalledTimes(1);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('preserves raw webhook request body and headers without mutation for SePay HMAC integrity', async () => {
    const rawWebhookPayload = JSON.stringify({
      id: 12345,
      gateway: 'Vietcombank',
      transactionDate: '2026-08-18 15:30:00',
      accountNumber: '123456789',
      subAccount: null,
      code: 'DONGQUY 10A1',
      content: 'NGUYEN VAN A DONGQUY 10A1',
      transferType: 'in',
      description: 'DONG QUY',
      transferAmount: 500000,
      referenceCode: 'MBVCB.123456789',
      accumulated: 5000000,
    });

    const mockAssets: any = { fetch: vi.fn() };
    const env: Env = {
      ASSETS: mockAssets,
      UPSTREAM_ORIGIN: 'http://127.0.0.1:3000',
    };

    let receivedBodyText = '';
    const mockFetch = vi.fn().mockImplementation(async (req: Request) => {
      receivedBodyText = await req.text();
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const webhookRequest = new Request('https://12a1-stage.tuananhdg.eu.org/api/v1/webhook/sepay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SePay-Timestamp': '1787042000',
        'X-SePay-Signature': 'mocked_signature_abc123',
      },
      body: rawWebhookPayload,
    });

    const response = await worker.fetch(webhookRequest, env, {} as any);

    expect(mockAssets.fetch).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(receivedBodyText).toBe(rawWebhookPayload);
    expect(response.status).toBe(200);

    vi.unstubAllGlobals();
  });
});
