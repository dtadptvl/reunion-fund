import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../../server/src/app.js';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { FastifyInstance } from 'fastify';

describe('Rate Limit Architecture & Route Segmentation', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    new MemberService(db).seedCanonicalRoster();
    app = buildApp({ db });
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (db) {
      db.close();
    }
  });

  it('1. Lucky Wheel Polling supports high-volume requests from shared NAT IP (>120 reqs without 429)', async () => {
    // 40 attendees x 30 req/min = 1200 req/min.
    // The route is configured with max: 3000.
    // We send 150 consecutive polling requests from a single client IP (192.168.1.100).
    const clientIp = '192.168.1.100';

    for (let i = 0; i < 150; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/lottery/wheel-state',
        remoteAddress: clientIp,
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json).toHaveProperty('status');
      expect(json).toHaveProperty('wheelSegments');
    }
  });

  it('2. Contribution Intent Polling route has independent high-capacity rate limit', async () => {
    const clientIp = '192.168.1.101';

    // Send 130 consecutive requests from the same IP (exceeding the global 120 limit)
    for (let i = 0; i < 130; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/intent/NONEXISTENT_CODE',
        remoteAddress: clientIp,
      });

      // Route returns 404 (Not Found) for nonexistent code, but NEVER 429 (Too Many Requests)
      expect(res.statusCode).toBe(404);
    }
  });

  it('3. Public Read Overview has independent high-capacity limit (max: 600)', async () => {
    const clientIp = '192.168.1.102';

    // Send 130 consecutive requests to /api/v1/public/overview (exceeding the global 120 limit)
    for (let i = 0; i < 130; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/overview',
        remoteAddress: clientIp,
      });

      expect(res.statusCode).toBe(200);
    }
  });

  it('4. Login endpoint enforces 5-failed-attempts lockout with HTTP 429', async () => {
    const clientIp = '192.168.1.103';

    // 5 invalid login attempts
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: clientIp,
        payload: {
          username: 'invalid_user',
          password: 'wrong_password',
        },
      });
      expect(res.statusCode).toBe(401);
    }

    // 6th attempt must be locked out with HTTP 429
    const lockoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: clientIp,
      payload: {
        username: 'invalid_user',
        password: 'wrong_password',
      },
    });

    expect(lockoutRes.statusCode).toBe(429);
    const json = JSON.parse(lockoutRes.payload);
    expect(json.error).toContain('Quá nhiều lần đăng nhập không thành công');
  });

  it('5. SePay Webhook is exempt from generic IP rate limiting (rateLimit: false)', async () => {
    const clientIp = '192.168.1.104';

    // Send 130 requests without hitting IP rate limit 429
    for (let i = 0; i < 130; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        remoteAddress: clientIp,
        payload: {
          id: i,
          gateway: 'MBBank',
          transactionDate: '2026-08-18 10:00:00',
          accountNumber: '0123456789',
          transferType: 'in',
          transferAmount: 100000,
          accumulated: 100000,
          code: null,
          content: 'TEST',
          referenceCode: `REF-${i}`,
          description: 'TEST',
        },
      });

      // Without webhook secret configured in test env, it returns 200 or 401 (signature verification), never 429
      expect(res.statusCode).not.toBe(429);
    }
  });
});
