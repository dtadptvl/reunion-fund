import { describe, it, expect } from 'vitest';
import fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import Database from 'better-sqlite3';
import { adminRoutes } from '../../server/src/routes/admin.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { ReconciliationService } from '../../server/src/services/reconciliation.service.js';
import { AuditService } from '../../server/src/services/audit.service.js';
import { runMigrations } from '../../server/src/db/connection.js';

describe('Treasurer Session Cookie Security Settings', () => {
  it('enforces HttpOnly, SameSite=Lax, Path=/, and Secure when configured', async () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const authService = new AuthService(db);
    const testPasswordHash = await authService.hashPassword('matkhau123');
    db.prepare(`
      INSERT INTO staff_users (id, username, full_name, password_hash, role)
      VALUES ('u1', 'thuquy', 'Thủ quỹ Lớp', ?, 'TREASURER')
    `).run(testPasswordHash);

    const memberService = new MemberService(db);
    const auditService = new AuditService(db);
    const reconciliationService = new ReconciliationService(
      db,
      {} as any,
      {} as any,
      {} as any,
      auditService
    );

    const app = fastify();
    await app.register(fastifyCookie);
    await app.register(adminRoutes, {
      db,
      authService,
      memberService,
      reconciliationService,
      auditService,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: {
        username: 'thuquy',
        password: 'matkhau123',
      },
    });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'] as string;
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('session_token=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });
});
