import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../../server/src/app.js';
import { runMigrations } from '../../server/src/db/connection.js';
import { MockBankSyncProvider } from '../../server/src/providers/bank-sync/mock-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { AuthService } from '../../server/src/services/auth.service.js';

describe('Account-Bound Contribution Identity & Tamper Protection', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;
  let authService: AuthService;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    authService = new AuthService(db);
    app = buildApp({
      db,
      authService,
      bankSyncProvider: new MockBankSyncProvider(),
      aiProvider: new MockAIProvider(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (db && db.open) db.close();
  });

  it('creates payment intent automatically bound to authenticated session member_id', async () => {
    // 1. Find member 1 (Dương Tuấn Anh)
    const member1 = db.prepare("SELECT id, full_name, bank_display_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;
    expect(member1).toBeDefined();

    // 2. Create session for member1
    const sessionToken = authService.createSession({
      userId: 'user-1',
      username: 'tuananh',
      fullName: member1.full_name,
      role: 'ADMIN',
      memberId: member1.id,
      email: 'tuananh@reunion.local',
    });

    // 3. Post intent with amount only (no memberId specified)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      cookies: { session_token: sessionToken },
      payload: {
        amount: 1200000,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.paymentCode).toBeDefined();
    expect(data.memberId).toBe(member1.id);
    expect(data.transferContent).toContain(member1.bank_display_name);

    // Check DB record
    const intent = db.prepare('SELECT * FROM payment_intents WHERE payment_code = ?').get(data.paymentCode) as any;
    expect(intent).toBeDefined();
    expect(intent.member_id).toBe(member1.id);
    expect(intent.expected_amount).toBe(1200000);
  });

  it('rejects client tampering when authenticated member A tries to submit member B id', async () => {
    const memberA = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;
    const memberB = db.prepare("SELECT id, full_name FROM members WHERE full_name != 'Dương Tuấn Anh' LIMIT 1").get() as any;

    const sessionToken = authService.createSession({
      userId: 'user-A',
      username: 'tuananh',
      fullName: memberA.full_name,
      role: 'ADMIN',
      memberId: memberA.id,
      email: 'tuananh@reunion.local',
    });

    // Member A attempts to pass memberB's ID in payload
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      cookies: { session_token: sessionToken },
      payload: {
        memberId: memberB.id,
        amount: 600000,
      },
    });

    expect(res.statusCode).toBe(403);
    const data = JSON.parse(res.body);
    expect(data.error).toContain('Không thể tạo mã đóng quỹ dưới danh tính thành viên khác');
  });

  it('allows guest contribution with customName when unauthenticated without creating an account', async () => {
    const userCountBefore = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: {
        customName: 'Bác Nguyễn Văn A (Phụ huynh)',
        amount: 600000,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.paymentCode).toBeDefined();
    expect(data.externalContributorId).toBeDefined();
    expect(data.memberId).toBeNull();
    expect(data.expectedAmount).toBe(600000);

    // Verify DB intent state
    const intent = db.prepare('SELECT * FROM payment_intents WHERE payment_code = ?').get(data.paymentCode) as any;
    expect(intent.member_id).toBeNull();
    expect(intent.external_contributor_id).toBe(data.externalContributorId);

    // Verify NO user account was created in users table
    const userCountAfter = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    expect(userCountAfter).toBe(userCountBefore);
  });

  it('rejects anonymous request attempting to submit a canonical memberId without session', async () => {
    const member = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: {
        memberId: member.id,
        amount: 500000,
      },
    });

    expect(res.statusCode).toBe(403);
    const data = JSON.parse(res.body);
    expect(data.error).toContain('Vui lòng đăng nhập tài khoản để đóng quỹ dưới danh nghĩa thành viên lớp');
  });

  it('rejects guest attempting to impersonate a canonical roster member by name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: {
        customName: 'Dương Tuấn Anh',
        amount: 500000,
      },
    });

    expect(res.statusCode).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error).toContain('là thành viên trong danh sách lớp');
  });

  it('rejects intent with non-positive integer amounts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: {
        customName: 'Khách',
        amount: -50000,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});
