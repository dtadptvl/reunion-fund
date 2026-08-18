import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { AuthService, isDefaultAdminMember } from '../../server/src/services/auth.service.js';
import { MockEmailProvider } from '../../server/src/providers/email/mock-email-provider.js';
import { buildApp } from '../../server/src/app.js';
import supertest from 'supertest';

describe('V2 Phase 1 — Member Accounts & Admin Roles', () => {
  let db: Database.Database;
  let mockEmailProvider: MockEmailProvider;
  let authService: AuthService;
  let memberService: MemberService;
  let app: any;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    mockEmailProvider = new MockEmailProvider();
    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    authService = new AuthService(db, mockEmailProvider);
    await authService.seedInitialStaff('admin', undefined, 'Admin Lớp A1');

    app = buildApp({
      db,
      emailProvider: mockEmailProvider,
    });
    await app.ready();
  });

  it('verifies canonical roster has exactly 40 members including Nguyễn Thị Bích', () => {
    const members = memberService.searchMembers('', 100);
    expect(members).toHaveLength(40);

    const bich = members.find((m) => m.full_name === 'Nguyễn Thị Bích');
    expect(bich).toBeDefined();
    expect(bich?.normalized_name.toLowerCase()).toBe('nguyen thi bich');
  });

  it('correctly identifies default ADMIN identities (Dương Tuấn Anh, Hoàng Thị Nhàn)', () => {
    expect(isDefaultAdminMember('Dương Tuấn Anh')).toBe(true);
    expect(isDefaultAdminMember('Hoàng Thị Nhàn')).toBe(true);
    expect(isDefaultAdminMember('Nguyễn Thị Bích')).toBe(false);
    expect(isDefaultAdminMember('Đỗ Thuỳ Dương')).toBe(false);
  });

  it('registers a member account, enforces 1-account-per-member, and sends mock verification email', async () => {
    const members = memberService.searchMembers('Bích', 10);
    const memberBich = members.find((m) => m.full_name === 'Nguyễn Thị Bích')!;
    expect(memberBich).toBeDefined();

    // 1. Register account for Nguyễn Thị Bích
    const regResult = await authService.registerMember({
      memberId: memberBich.id,
      username: 'bich_nguyen',
      email: 'bich.nguyen@example.com',
      password: 'password123',
    });

    expect(regResult.user.username).toBe('bich_nguyen');
    expect(regResult.user.role).toBe('MEMBER');
    expect(regResult.user.status).toBe('PENDING_VERIFICATION');
    expect(regResult.user.email_verified).toBe(0);

    // Verify email was sent via MockEmailProvider
    expect(mockEmailProvider.sentEmails).toHaveLength(1);
    const sent = mockEmailProvider.sentEmails[0];
    expect(sent.to).toBe('bich.nguyen@example.com');
    expect(sent.code).toBe(regResult.verification.code);
    expect(sent.token).toBe(regResult.verification.token);

    // 2. Enforce 1-account-per-member constraint
    await expect(
      authService.registerMember({
        memberId: memberBich.id,
        username: 'bich_second_acc',
        email: 'another_bich@example.com',
        password: 'password123',
      })
    ).rejects.toThrow(/đã đăng ký tài khoản/i);

    // 3. Login attempt before email verification must fail with PENDING_VERIFICATION
    const authAttempt = await authService.authenticate('bich_nguyen', 'password123');
    expect(authAttempt.status).toBe('PENDING_VERIFICATION');
    expect(authAttempt.session).toBeUndefined();

    // 4. Verify email using 6-digit code
    const verifyResult = await authService.verifyEmail({
      email: 'bich.nguyen@example.com',
      code: sent.code!,
    });
    expect(verifyResult.success).toBe(true);
    expect(verifyResult.user.email_verified).toBe(1);
    expect(verifyResult.user.status).toBe('ACTIVE');

    // 5. Login after verification succeeds with MEMBER role
    const loginResult = await authService.authenticate('bich_nguyen', 'password123');
    expect(loginResult.status).toBe('SUCCESS');
    expect(loginResult.session?.role).toBe('MEMBER');
    expect(loginResult.session?.memberId).toBe(memberBich.id);
  });

  it('registers default ADMIN member (Hoàng Thị Nhàn) with ADMIN role automatically', async () => {
    const members = memberService.searchMembers('Hoàng Thị Nhàn', 10);
    const nhan = members.find((m) => m.full_name === 'Hoàng Thị Nhàn')!;
    expect(nhan).toBeDefined();

    const regResult = await authService.registerMember({
      memberId: nhan.id,
      username: 'nhan_admin',
      email: 'nhan_adm@example.com',
      password: 'adminpassword123',
    });

    expect(regResult.user.role).toBe('ADMIN');

    // Verify email via link token
    const verifyResult = await authService.verifyEmail({
      token: regResult.verification.token,
    });
    expect(verifyResult.success).toBe(true);
    expect(verifyResult.user.role).toBe('ADMIN');

    // Authenticate
    const loginResult = await authService.authenticate('nhan_admin', 'adminpassword123');
    expect(loginResult.status).toBe('SUCCESS');
    expect(loginResult.session?.role).toBe('ADMIN');
  });

  it('HTTP flow: register → verify-email → login → role-based authorization', async () => {
    const nhanMember = memberService.searchMembers('Hoàng Thị Nhàn', 10).find((m) => m.full_name === 'Hoàng Thị Nhàn')!;
    const duongMember = memberService.searchMembers('Đỗ Thuỳ Dương', 10).find((m) => m.full_name === 'Đỗ Thuỳ Dương')!;

    // 1. Register Member (Đỗ Thuỳ Dương)
    const regRes = await supertest(app.server)
      .post('/api/v1/auth/register')
      .send({
        memberId: duongMember.id,
        username: 'thuyduong',
        email: 'duong@example.com',
        password: 'mypassword',
      });
    expect(regRes.status).toBe(200);
    expect(regRes.body.requiresVerification).toBe(true);

    // 2. Verify Email via POST
    const sentEmail = mockEmailProvider.getLatestEmailFor('duong@example.com')!;
    expect(sentEmail).toBeDefined();

    const verifyRes = await supertest(app.server)
      .post('/api/v1/auth/verify-email')
      .send({
        email: 'duong@example.com',
        code: sentEmail.code,
      });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);

    // 3. Login as MEMBER (Đỗ Thuỳ Dương)
    const memberLoginRes = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({
        username: 'thuyduong',
        password: 'mypassword',
      });
    expect(memberLoginRes.status).toBe(200);
    expect(memberLoginRes.body.user.role).toBe('MEMBER');

    const memberCookie = memberLoginRes.headers['set-cookie'];
    expect(memberCookie).toBeDefined();

    // 4. Member accesses /api/v1/auth/me -> 200 OK
    const memberMeRes = await supertest(app.server)
      .get('/api/v1/auth/me')
      .set('Cookie', memberCookie);
    expect(memberMeRes.status).toBe(200);
    expect(memberMeRes.body.user.role).toBe('MEMBER');
    expect(memberMeRes.body.member.full_name).toBe('Đỗ Thuỳ Dương');

    // 5. MEMBER attempts to access Admin Exception Queue -> 403 FORBIDDEN
    const forbiddenRes = await supertest(app.server)
      .get('/api/v1/admin/exceptions')
      .set('Cookie', memberCookie);
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.error).toContain('Bạn không có quyền quản trị');

    // 6. Register & Login as ADMIN (Hoàng Thị Nhàn)
    await supertest(app.server)
      .post('/api/v1/auth/register')
      .send({
        memberId: nhanMember.id,
        username: 'nhanhoang',
        email: 'nhan@example.com',
        password: 'nhanpassword',
      });

    const nhanEmail = mockEmailProvider.getLatestEmailFor('nhan@example.com')!;
    await supertest(app.server)
      .post('/api/v1/auth/verify-email')
      .send({
        token: nhanEmail.token,
      });

    const adminLoginRes = await supertest(app.server)
      .post('/api/v1/auth/login')
      .send({
        username: 'nhanhoang',
        password: 'nhanpassword',
      });
    expect(adminLoginRes.status).toBe(200);
    expect(adminLoginRes.body.user.role).toBe('ADMIN');

    const adminCookie = adminLoginRes.headers['set-cookie'];

    // 7. ADMIN accesses /api/v1/admin/exceptions -> 200 OK
    const adminExceptionsRes = await supertest(app.server)
      .get('/api/v1/admin/exceptions')
      .set('Cookie', adminCookie);
    expect(adminExceptionsRes.status).toBe(200);
    expect(adminExceptionsRes.body.unresolvedIncomeCount).toBeDefined();

    // 8. ADMIN accesses /api/v1/admin/financials -> 200 OK
    const adminFinRes = await supertest(app.server)
      .get('/api/v1/admin/financials')
      .set('Cookie', adminCookie);
    expect(adminFinRes.status).toBe(200);
    expect(adminFinRes.body.totalIncome).toBeDefined();
  });
});
