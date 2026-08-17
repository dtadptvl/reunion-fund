import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../../server/src/app.js';
import { runMigrations } from '../../server/src/db/connection.js';
import { MockBankSyncProvider } from '../../server/src/providers/bank-sync/mock-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { ExpenseService } from '../../server/src/services/expense.service.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { BankTransactionRow } from '../../server/src/db/schema.js';

describe('Phase 4: Security Hardening, Data Minimization & Readability Fixes', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    app = buildApp({
      db,
      bankSyncProvider: new MockBankSyncProvider(),
      aiProvider: new MockAIProvider(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (db && db.open) db.close();
  });

  // 1. Security Headers Verification
  it('serves critical HTTP security headers on all responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/overview',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('sets no-store Cache-Control on authenticated admin endpoints', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  // 2. Login Abuse Protection & Rate Limiting
  it('enforces login rate limiting after 5 failed attempts with generic error', async () => {
    const payload = { username: 'admin', password: 'wrong_password' };

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/login',
        payload,
      });
      expect(res.statusCode).toBe(401);
      const data = JSON.parse(res.body);
      expect(data.error).toBe('Tên đăng nhập hoặc mật khẩu không chính xác');
    }

    // 6th attempt should receive 429 Too Many Requests
    const lockedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload,
    });
    expect(lockedRes.statusCode).toBe(429);
    const lockedData = JSON.parse(lockedRes.body);
    expect(lockedData.error).toContain('Quá nhiều lần đăng nhập không thành công');
  });

  // 3. Input Validation
  it('validates contribution amounts strictly as positive integers without arbitrary 10k minimum', async () => {
    const members = db.prepare('SELECT id FROM members LIMIT 1').all() as any[];
    const memberId = members[0].id;

    // Valid small positive integer (e.g. 5000 VND is now accepted)
    const resValidSmall = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: { memberId, amount: 5000 },
    });
    expect(resValidSmall.statusCode).toBe(200);

    // Zero rejected
    const resZero = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: { memberId, amount: 0 },
    });
    expect(resZero.statusCode).toBe(400);

    // Negative rejected
    const resNegative = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: { memberId, amount: -50000 },
    });
    expect(resNegative.statusCode).toBe(400);

    // Non-integer / float rejected
    const resFloat = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: { memberId, amount: 500000.5 },
    });
    expect(resFloat.statusCode).toBe(400);

    // Unreasonably huge value rejected
    const resTooHigh = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: { memberId, amount: 2000000000 },
    });
    expect(resTooHigh.statusCode).toBe(400);
  });

  // 4. Public Data Minimization
  it('does not leak secrets, session tokens, or sensitive internal fields in public APIs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/overview',
    });
    const body = res.body;
    expect(body).not.toContain('password_hash');
    expect(body).not.toContain('SESSION_SECRET');
    expect(body).not.toContain('SEPAY_API_TOKEN');
    expect(body).not.toContain('SEPAY_WEBHOOK_SECRET');

    const resExport = await app.inject({
      method: 'GET',
      url: '/api/v1/public/export/csv/contributions',
    });
    expect(resExport.statusCode).toBe(200);
    const csv = resExport.body;
    expect(csv).not.toContain('password');
    expect(csv).not.toContain('secret');
  });

  // 5. Fix 5A: UNKNOWN expense title does not duplicate memo
  it('Fix 5A: ensures UNKNOWN expense title avoids duplicating memo when content and description match', async () => {
    const expenseService = new ExpenseService(db, new MockAIProvider());
    const mockTx: BankTransactionRow = {
      id: 'tx-unknown-memo-1',
      sepay_id: 99999,
      gateway: 'MBBank',
      transaction_date: '2026-08-17 15:02:30',
      account_number: '0123456789',
      sub_account: null,
      transfer_type: 'out',
      transfer_amount: 120000,
      accumulated: null,
      code: null,
      content: 'QR839281923',
      description: 'QR839281923',
      reference_code: 'REF_99999',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      exclusion_reason: null,
      excluded_by: null,
      created_at: '2026-08-17 08:02:32',
    };

    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, description, raw_payload, ingestion_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(mockTx.id, mockTx.sepay_id, mockTx.gateway, mockTx.transaction_date, mockTx.account_number, mockTx.transfer_type, mockTx.transfer_amount, mockTx.content, mockTx.description, mockTx.raw_payload, mockTx.ingestion_source);

    const expense = await expenseService.processOutgoingTransaction(mockTx);
    expect(expense.title).toBe('QR839281923');
    expect(expense.title).not.toContain('QR839281923 QR839281923');
  });

  // 6. Fix 5B: ASSIGN_CONTRIBUTION audit includes member disambiguator in memberName
  it('Fix 5B: records member disambiguator in ASSIGN_CONTRIBUTION audit log', async () => {
    // 1. Create staff login session
    const authService = new AuthService(db);
    const hash = await authService.hashPassword('123456');
    db.prepare(`
      INSERT OR REPLACE INTO staff_users (id, username, password_hash, full_name, role)
      VALUES ('u1', 'admin_phase4', ?, 'Thủ Quỹ Test', 'TREASURER')
    `).run(hash);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'admin_phase4', password: '123456' },
    });
    expect(login.statusCode).toBe(200);
    const cookieHeader = login.headers['set-cookie'] as string;

    // Insert an unresolved incoming contribution
    const txId = 'tx-test-unresolved-1';
    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
      VALUES (?, 88881, 'MB', '2026-08-17 14:00:00', '0123', 'in', 500000, 'NGUYEN THI HUE DONGQUY', '{}', 'WEBHOOK')
    `).run(txId);

    const contribId = 'contrib-unresolved-1';
    db.prepare(`
      INSERT INTO contributions (id, bank_transaction_id, contributor_type, amount, match_method, unresolved_name)
      VALUES (?, ?, 'UNRESOLVED', 500000, 'UNRESOLVED', 'NGUYEN THI HUE DONGQUY')
    `).run(contribId, txId);

    // Find Nguyễn Thị Huế (Lương Tài)
    const targetMember = db.prepare("SELECT * FROM members WHERE full_name = 'Nguyễn Thị Huế' AND disambiguator = 'Lương Tài'").get() as any;
    expect(targetMember).toBeDefined();

    const assignRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/contributions/${contribId}/assign`,
      headers: { cookie: cookieHeader },
      payload: { memberId: targetMember.id, notes: 'Chỉ định thủ quỹ' },
    });

    expect(assignRes.statusCode).toBe(200);
    const auditLog = db.prepare("SELECT * FROM audit_logs WHERE action = 'ASSIGN_CONTRIBUTION' ORDER BY timestamp DESC LIMIT 1").get() as any;
    expect(auditLog).toBeDefined();
    const afterState = JSON.parse(auditLog.after_state);
    expect(afterState.memberName).toBe('Nguyễn Thị Huế (Lương Tài)');

    // 7. GET /api/v1/admin/financials returns totalIncome, totalExpense, balance, and transaction lists
    const finRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/financials',
      headers: { cookie: cookieHeader },
    });
    expect(finRes.statusCode).toBe(200);
    const finData = JSON.parse(finRes.payload);
    expect(finData.totalIncome).toBe(500000);
    expect(finData.contributions.length).toBeGreaterThan(0);
    expect(finData.contributions[0].contributor_name).toBe('Nguyễn Thị Huế (Lương Tài)');
  });
});
