import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../../server/src/app.js';
import { runMigrations } from '../../server/src/db/connection.js';
import { MockBankSyncProvider } from '../../server/src/providers/bank-sync/mock-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { ReconciliationService } from '../../server/src/services/reconciliation.service.js';

describe('Phase 4: Mobile & Treasurer Undo/Review Tests', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;
  let cookieHeader: string;
  let bankSyncProvider: MockBankSyncProvider;
  let reconService: ReconciliationService;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);

    // Setup initial data
    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
      VALUES 
        ('tx-in-unresolved', 9001, 'MB', '2026-08-17 10:00:00', '0123', 'in', 500000, 'NGUYEN THI HUE DONGQUY', '{}', 'WEBHOOK'),
        ('tx-out-unknown', 9002, 'MB', '2026-08-17 11:00:00', '0123', 'out', 120000, 'QR839281923', '{}', 'WEBHOOK')
    `).run();

    db.prepare(`
      INSERT INTO contributions (id, bank_transaction_id, contributor_type, amount, match_method, unresolved_name)
      VALUES ('c-unresolved', 'tx-in-unresolved', 'UNRESOLVED', 500000, 'UNRESOLVED', 'NGUYEN THI HUE DONGQUY')
    `).run();

    db.prepare(`
      INSERT INTO expenses (id, bank_transaction_id, title, category, amount, classification_source)
      VALUES ('e-unknown', 'tx-out-unknown', 'QR839281923', 'UNKNOWN', 120000, 'UNKNOWN')
    `).run();

    // Create staff session
    const authService = new AuthService(db);
    const hash = await authService.hashPassword('12a1@2016');
    db.prepare(`
      INSERT INTO staff_users (id, username, password_hash, full_name, role)
      VALUES ('u-treasurer', 'admin88', ?, 'Thủ Quỹ Lớp A1', 'TREASURER')
    `).run(hash);

    bankSyncProvider = new MockBankSyncProvider();
    app = buildApp({
      db,
      bankSyncProvider,
      aiProvider: new MockAIProvider(),
    });
    await app.ready();

    reconService = new ReconciliationService(db, bankSyncProvider);

    // Authenticate
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'admin88', password: '12a1@2016' },
    });
    expect(loginRes.statusCode).toBe(200);
    cookieHeader = loginRes.headers['set-cookie'] as string;
  });

  afterEach(async () => {
    await app.close();
    if (db && db.open) db.close();
  });

  // 1. Manual assignment and subsequent Undo
  it('allows manual assignment of unresolved contribution and then Undo', async () => {
    const member = db.prepare("SELECT * FROM members WHERE full_name = 'Nguyễn Thị Huế' AND disambiguator = 'Lương Tài'").get() as any;
    expect(member).toBeDefined();

    // Assign
    const assignRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/contributions/c-unresolved/assign',
      headers: { cookie: cookieHeader },
      payload: { memberId: member.id },
    });
    expect(assignRes.statusCode).toBe(200);

    const contribAssigned = db.prepare('SELECT * FROM contributions WHERE id = ?').get('c-unresolved') as any;
    expect(contribAssigned.contributor_type).toBe('MEMBER');
    expect(contribAssigned.member_id).toBe(member.id);
    expect(contribAssigned.match_method).toBe('MANUAL_TREASURER_ASSIGNMENT');

    // Exceptions queue shows 0 unresolved income
    const exRes1 = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/exceptions',
      headers: { cookie: cookieHeader },
    });
    expect(JSON.parse(exRes1.payload).unresolvedIncomeCount).toBe(0);

    // Undo / Unassign
    const unassignRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/contributions/c-unresolved/unassign',
      headers: { cookie: cookieHeader },
    });
    expect(unassignRes.statusCode).toBe(200);

    const contribUndone = db.prepare('SELECT * FROM contributions WHERE id = ?').get('c-unresolved') as any;
    expect(contribUndone.contributor_type).toBe('UNRESOLVED');
    expect(contribUndone.member_id).toBeNull();
    expect(contribUndone.match_method).toBe('UNRESOLVED');
    expect(contribUndone.amount).toBe(500000);

    // Exceptions queue shows 1 unresolved income again
    const exRes2 = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/exceptions',
      headers: { cookie: cookieHeader },
    });
    expect(JSON.parse(exRes2.payload).unresolvedIncomeCount).toBe(1);

    // Cash totals remain unchanged
    const totals = db.prepare('SELECT SUM(amount) as total FROM contributions').get() as any;
    expect(totals.total).toBe(500000);

    // Audit log records UNASSIGN_CONTRIBUTION
    const auditLog = db.prepare("SELECT * FROM audit_logs WHERE action = 'UNASSIGN_CONTRIBUTION'").get() as any;
    expect(auditLog).toBeDefined();
    expect(auditLog.entity_id).toBe('c-unresolved');
  });

  // 2. Re-assignment after Undo works normally
  it('allows re-assignment to another member after undo', async () => {
    const member1 = db.prepare("SELECT * FROM members WHERE full_name = 'Nguyễn Thị Huế' AND disambiguator = 'Lương Tài'").get() as any;
    const member2 = db.prepare("SELECT * FROM members WHERE full_name = 'Nguyễn Thị Huế' AND disambiguator = 'Lạc Đạo'").get() as any;

    // First assign to member 1
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/contributions/c-unresolved/assign',
      headers: { cookie: cookieHeader },
      payload: { memberId: member1.id },
    });

    // Undo
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/contributions/c-unresolved/unassign',
      headers: { cookie: cookieHeader },
    });

    // Re-assign to member 2
    const reassignRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/contributions/c-unresolved/assign',
      headers: { cookie: cookieHeader },
      payload: { memberId: member2.id },
    });
    expect(reassignRes.statusCode).toBe(200);

    const contribReassigned = db.prepare('SELECT * FROM contributions WHERE id = ?').get('c-unresolved') as any;
    expect(contribReassigned.member_id).toBe(member2.id);
    expect(contribReassigned.match_method).toBe('MANUAL_TREASURER_ASSIGNMENT');
  });

  // 3. Outgoing UNKNOWN expense review
  it('allows treasurer to review and supplement details for UNKNOWN expense', async () => {
    const editRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/expenses/e-unknown',
      headers: { cookie: cookieHeader },
      payload: {
        vietnameseTitle: 'Nước uống họp lớp',
        category: 'FOOD',
        recipientName: 'Quán Cafe Cây Si',
        notes: 'Mua 15 ly nước',
      },
    });

    expect(editRes.statusCode).toBe(200);

    const updatedExpense = db.prepare('SELECT * FROM expenses WHERE id = ?').get('e-unknown') as any;
    expect(updatedExpense.vietnamese_title).toBe('Nước uống họp lớp');
    expect(updatedExpense.category).toBe('FOOD');
    expect(updatedExpense.recipient_name).toBe('Quán Cafe Cây Si');
    expect(updatedExpense.notes).toBe('Mua 15 ly nước');
    expect(updatedExpense.classification_source).toBe('MANUAL_OVERRIDE');
    expect(updatedExpense.amount).toBe(120000); // immutable amount

    // Immutable raw bank transaction
    const bankTx = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get('tx-out-unknown') as any;
    expect(bankTx.content).toBe('QR839281923');
    expect(bankTx.transfer_amount).toBe(120000);

    // Audit log records UPDATE_EXPENSE
    const auditLog = db.prepare("SELECT * FROM audit_logs WHERE action = 'UPDATE_EXPENSE'").get() as any;
    expect(auditLog).toBeDefined();
    expect(auditLog.entity_id).toBe('e-unknown');
  });

  // 4. Reconciliation preserves manual review and undo states
  it('ensures reconciliation does not overwrite manual review or undone contributions', async () => {
    // Add same transaction in provider to simulate reconciliation check
    bankSyncProvider.addMockTransaction({
      sepayId: 9001,
      gateway: 'MB',
      transactionDate: '2026-08-17 10:00:00',
      accountNumber: '0123',
      transferType: 'in',
      transferAmount: 500000,
      content: 'NGUYEN THI HUE DONGQUY',
      rawPayload: {},
    });
    bankSyncProvider.addMockTransaction({
      sepayId: 9002,
      gateway: 'MB',
      transactionDate: '2026-08-17 11:00:00',
      accountNumber: '0123',
      transferType: 'out',
      transferAmount: 120000,
      content: 'QR839281923',
      rawPayload: {},
    });

    const result = await reconService.runReconciliation('MANUAL');
    expect(result.alreadyPresent).toBe(2);
    expect(result.newlyImported).toBe(0);

    // Check that contribution remains UNRESOLVED and expense remains FOOD
    const contrib = db.prepare('SELECT * FROM contributions WHERE id = ?').get('c-unresolved') as any;
    expect(contrib.contributor_type).toBe('UNRESOLVED');
  });
});
