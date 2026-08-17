import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { runMigrations } from '../../server/src/db/connection.js';
import { SePayProvider } from '../../server/src/providers/bank-sync/sepay-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { ContributionService } from '../../server/src/services/contribution.service.js';
import { ExpenseService } from '../../server/src/services/expense.service.js';
import { ReconciliationService } from '../../server/src/services/reconciliation.service.js';
import { BankTransactionRow } from '../../server/src/db/schema.js';

describe('Phase 3B — SePay Test Mode Verification Suite', () => {
  let db: Database.Database;
  let memberService: MemberService;
  let contributionService: ContributionService;
  let expenseService: ExpenseService;
  let mockAIProvider: MockAIProvider;
  let reconciliationService: ReconciliationService;
  const webhookSecret = 'sepay_test_mode_webhook_secret_xyz';
  let sepayProvider: SePayProvider;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    contributionService = new ContributionService(db);
    mockAIProvider = new MockAIProvider();
    expenseService = new ExpenseService(db, mockAIProvider);

    sepayProvider = new SePayProvider({
      baseUrl: 'https://userapi-sandbox.sepay.vn/v2',
      apiToken: 'sandbox_api_token_test_123',
      webhookSecret,
    });

    reconciliationService = new ReconciliationService(
      db,
      sepayProvider,
      contributionService,
      expenseService
    );
  });

  afterEach(() => {
    db.close();
  });

  const insertAndProcessTx = async (txData: Partial<BankTransactionRow> & { id: string; sepay_id: number }) => {
    const rawPayload = JSON.stringify(txData);
    const stmt = db.prepare(`
      INSERT INTO bank_transactions (
        id, sepay_id, gateway, transaction_date, account_number,
        sub_account, transfer_type, transfer_amount, accumulated,
        code, content, description, reference_code, raw_payload,
        ingestion_source, is_excluded, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WEBHOOK', 0, CURRENT_TIMESTAMP)
    `);

    stmt.run(
      txData.id,
      txData.sepay_id,
      txData.gateway || 'MBBank',
      txData.transaction_date || new Date().toISOString(),
      txData.account_number || '0123456789',
      txData.sub_account || null,
      txData.transfer_type || 'in',
      txData.transfer_amount || 500000,
      txData.accumulated || 1000000,
      txData.code || null,
      txData.content || '',
      txData.description || null,
      txData.reference_code || null,
      rawPayload
    );

    const row = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(txData.id) as BankTransactionRow;
    if (row.transfer_type === 'in') {
      return contributionService.processIncomingTransaction(row);
    } else {
      return await expenseService.processOutgoingTransaction(row);
    }
  };

  // 1. Webhook Signature & Idempotency
  describe('1. Webhook HMAC & Idempotency', () => {
    it('accepts valid HMAC-SHA256 signature with X-SePay-Timestamp', () => {
      const payload = JSON.stringify({ id: 1001, transferAmount: 500000, content: 'TEST' });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const message = `${timestamp}.${payload}`;
      const signature = crypto.createHmac('sha256', webhookSecret).update(message, 'utf8').digest('hex');
      const valid = sepayProvider.verifyWebhook({
        'x-sepay-timestamp': timestamp,
        'x-sepay-signature': `sha256=${signature}`,
      }, payload);
      expect(valid).toBe(true);
    });

    it('rejects invalid HMAC-SHA256 signature or missing timestamp', () => {
      const payload = JSON.stringify({ id: 1001, transferAmount: 500000, content: 'TEST' });
      const validWithoutTs = sepayProvider.verifyWebhook({ 'x-sepay-signature': '0000000000000000000000000000000000000000000000000000000000000000' }, payload);
      expect(validWithoutTs).toBe(false);
    });

    it('enforces idempotency via UNIQUE constraint on sepay_id', async () => {
      await insertAndProcessTx({
        id: 'tx-001',
        sepay_id: 88001,
        content: 'DONG QUY LOP',
        transfer_amount: 500000,
        transfer_type: 'in',
      });

      // Attempt second insert with same sepay_id
      expect(() => {
        db.prepare(`
          INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
          VALUES ('tx-002', 88001, 'MBBank', CURRENT_TIMESTAMP, '0123456789', 'in', 500000, 'DUPLICATE', '{}', 'WEBHOOK')
        `).run();
      }).toThrow(/UNIQUE constraint failed/);
    });

    it('preserves raw source payload verbatim', async () => {
      const complexPayload = { id: 88002, extraKey: 'abc', nested: { field: 123 } };
      db.prepare(`
        INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
        VALUES ('tx-003', 88002, 'MBBank', CURRENT_TIMESTAMP, '0123456789', 'in', 500000, 'RAW CHECK', ?, 'WEBHOOK')
      `).run(JSON.stringify(complexPayload));

      const row = db.prepare('SELECT raw_payload FROM bank_transactions WHERE sepay_id = 88002').get() as any;
      expect(JSON.parse(row.raw_payload)).toEqual(complexPayload);
    });
  });

  // 2. Contribution Recognition Matrix (Cases A-F)
  describe('2. Contribution Recognition Matrix (Cases A-F)', () => {
    it('Case A: recognizes exact payment code', async () => {
      const member = memberService.searchMembers('Dương Tuấn Anh', 1)[0]!;
      db.prepare(`
        INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
        VALUES ('pi-a', 'K8P4X', ?, 500000, 'TUAN ANH K8P4X', 'PENDING')
      `).run(member.id);

      const result: any = await insertAndProcessTx({
        id: 'tx-case-a',
        sepay_id: 90001,
        content: 'CHUYEN TIEN DONG QUY K8P4X',
        transfer_amount: 500000,
        transfer_type: 'in',
      });

      expect(result.contributorType).toBe('MEMBER');
      expect(result.memberId).toBe(member.id);
      expect(result.matchMethod).toBe('EXACT_PAYMENT_CODE');
    });

    it('Case B: matches canonical member name in content with DONGQUY keyword', async () => {
      const member = memberService.searchMembers('Nguyễn Thị Bích', 1)[0]!;
      const result: any = await insertAndProcessTx({
        id: 'tx-case-b',
        sepay_id: 90002,
        content: 'NGUYEN THI BICH DONGQUY HOB KHOA 10 NAM',
        transfer_amount: 500000,
        transfer_type: 'in',
      });

      expect(result.contributorType).toBe('MEMBER');
      expect(result.memberId).toBe(member.id);
      expect(result.matchMethod).toBe('DETERMINISTIC_NAME_FALLBACK');
    });

    it('Case C: handles unrecognized contribution without matched intent or clear member', async () => {
      const result: any = await insertAndProcessTx({
        id: 'tx-case-c',
        sepay_id: 90003,
        content: 'TIEN NHA THANG BAN',
        transfer_amount: 500000,
        transfer_type: 'in',
      });

      expect(result.contributorType).toBe('UNRESOLVED');
      expect(result.memberId).toBeNull();
      expect(result.matchMethod).toBe('UNRESOLVED');
    });

    it('Case D: recognizes external / guest contributor via external payment intent', async () => {
      const extId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO external_contributors (id, raw_name, normalized_name, display_name, status)
        VALUES (?, 'Cô Giáo Chủ Nhiệm', 'CO GIAO CHU NHIEM', 'Cô Giáo Chủ Nhiệm', 'CONFIRMED_EXTERNAL')
      `).run(extId);

      db.prepare(`
        INSERT INTO payment_intents (id, payment_code, external_contributor_id, expected_amount, transfer_content, status)
        VALUES ('pi-ext', 'EXT92', ?, 1000000, 'CO GIAO EXT92', 'PENDING')
      `).run(extId);

      const result: any = await insertAndProcessTx({
        id: 'tx-case-d',
        sepay_id: 90004,
        content: 'CO GIAO CHU NHIEM DONGQUY EXT92',
        transfer_amount: 1000000,
        transfer_type: 'in',
      });

      expect(result.contributorType).toBe('EXTERNAL');
      expect(result.matchMethod).toBe('EXACT_PAYMENT_CODE');
    });

    it('Case E: handles multiple/excess payments correctly aggregating balance', async () => {
      const member = memberService.searchMembers('Sái Văn Độ', 1)[0]!;
      await insertAndProcessTx({
        id: 'tx-case-e-1',
        sepay_id: 90005,
        content: 'SAI VAN DO DONGQUY LAN 1',
        transfer_amount: 500000,
        transfer_type: 'in',
      });

      await insertAndProcessTx({
        id: 'tx-case-e-2',
        sepay_id: 90006,
        content: 'SAI VAN DO DONGQUY LAN 2 UNG HO',
        transfer_amount: 1500000,
        transfer_type: 'in',
      });

      const total = db.prepare('SELECT SUM(amount) as s FROM contributions WHERE member_id = ?').get(member.id) as any;
      expect(total.s).toBe(2000000);
    });

    it('Case F: flags unmatched transaction as UNRESOLVED in database', async () => {
      const result: any = await insertAndProcessTx({
        id: 'tx-case-f',
        sepay_id: 90007,
        content: '1234567890',
        description: 'QR1238902',
        transfer_amount: 500000,
        transfer_type: 'in',
      });

      expect(result.contributorType).toBe('UNRESOLVED');
      expect(result.matchMethod).toBe('UNRESOLVED');

      const saved = db.prepare('SELECT * FROM contributions WHERE id = ?').get(result.contributionId) as any;
      expect(saved.contributor_type).toBe('UNRESOLVED');
    });
  });

  // 3. Outgoing Expenses (Clear vs Ambiguous QR)
  describe('3. Outgoing Expenses & AI Categorization Rules', () => {
    it('categorizes clear expense description (Flowers / Hoa tuoi)', async () => {
      const expense: any = await insertAndProcessTx({
        id: 'tx-exp-clear',
        sepay_id: 91001,
        content: 'Thanh toan tien hoa tuoi tang thay co 20-11',
        description: 'Tiem hoa Ha Noi',
        transfer_amount: 800000,
        transfer_type: 'out',
      });

      expect(expense.category).toBe('FLOWERS');
      expect(expense.vietnamese_title).toBe('Hoa tươi tặng thầy cô');
    });

    it('flags ambiguous QR merchant expense as UNKNOWN with review required', async () => {
      const expense: any = await insertAndProcessTx({
        id: 'tx-exp-ambiguous',
        sepay_id: 91002,
        content: 'QR839281923',
        description: 'NGUYEN VAN HUNG',
        transfer_amount: 720000,
        transfer_type: 'out',
      });

      expect(expense.category).toBe('UNKNOWN');
      expect(expense.classification_source).toBe('UNKNOWN');
      expect(expense.vietnamese_title).toBeNull();
    });
  });
});
