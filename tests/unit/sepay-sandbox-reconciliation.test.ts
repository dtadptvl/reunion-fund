import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { SePayProvider } from '../../server/src/providers/bank-sync/sepay-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { ContributionService } from '../../server/src/services/contribution.service.js';
import { ExpenseService } from '../../server/src/services/expense.service.js';
import { ReconciliationService } from '../../server/src/services/reconciliation.service.js';
import { AuditService } from '../../server/src/services/audit.service.js';

describe('SePay Sandbox API Reconciliation Catch-Up & Idempotency', () => {
  let db: Database.Database;
  let memberService: MemberService;
  let contributionService: ContributionService;
  let expenseService: ExpenseService;
  let auditService: AuditService;
  let sepayProvider: SePayProvider;
  let reconciliationService: ReconciliationService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    contributionService = new ContributionService(db);
    const mockAIProvider = new MockAIProvider();
    expenseService = new ExpenseService(db, mockAIProvider);
    auditService = new AuditService(db);

    sepayProvider = new SePayProvider({
      baseUrl: 'https://userapi-sandbox.sepay.vn/v2',
      apiToken: 'test_token',
      webhookSecret: 'test_secret',
    });

    reconciliationService = new ReconciliationService(
      db,
      sepayProvider,
      contributionService,
      expenseService,
      auditService
    );
  });

  afterEach(() => {
    db.close();
  });

  it('performs catch-up reconciliation and idempotently handles overlapping transactions', async () => {
    const member = memberService.searchMembers('Dương Tuấn Anh', 1)[0]!;
    db.prepare(`
      INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
      VALUES ('pi-recon-1', 'K8P4X', ?, 500000, 'TUAN ANH K8P4X', 'PENDING')
    `).run(member.id);

    // Mock API response from SePay Sandbox
    const mockTransactions = [
      {
        id: 7001,
        gateway: 'MBBank',
        transactionDate: '2026-08-17 08:00:00',
        accountNumber: '0123456789',
        transferType: 'in',
        transferAmount: 500000,
        content: 'TUAN ANH DONGQUY K8P4X',
      },
      {
        id: 7002,
        gateway: 'MBBank',
        transactionDate: '2026-08-17 08:30:00',
        accountNumber: '0123456789',
        transferType: 'out',
        transferAmount: 1200000,
        content: 'DAT COC NHA HANG TIEC KHOA',
      },
    ];

    vi.spyOn(sepayProvider, 'listTransactions').mockResolvedValue({
      transactions: mockTransactions.map((m) => sepayProvider.normalizeWebhookTransaction(m)),
      hasMore: false,
      total: 2,
    });

    // Run reconciliation 1
    const run1 = await reconciliationService.runReconciliation('MANUAL');
    expect(run1.totalChecked).toBe(2);
    expect(run1.newlyImported).toBe(2);
    expect(run1.alreadyPresent).toBe(0);

    // Check contribution and expense created
    const contrib = db.prepare('SELECT * FROM contributions WHERE member_id = ?').get(member.id) as any;
    expect(contrib).toBeDefined();
    expect(contrib.amount).toBe(500000);

    const expense = db.prepare('SELECT * FROM expenses WHERE category = ?').get('FOOD') as any;
    expect(expense).toBeDefined();
    expect(expense.amount).toBe(1200000);

    // Run reconciliation 2 (Idempotency check: 0 newly imported, 2 already present)
    const run2 = await reconciliationService.runReconciliation('CRON');
    expect(run2.totalChecked).toBe(2);
    expect(run2.newlyImported).toBe(0);
    expect(run2.alreadyPresent).toBe(2);
  });
});
