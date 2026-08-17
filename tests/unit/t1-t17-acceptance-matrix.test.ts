import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { ContributionService } from '../../server/src/services/contribution.service.js';
import { ExpenseService } from '../../server/src/services/expense.service.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { ReconciliationService } from '../../server/src/services/reconciliation.service.js';
import { ExportService } from '../../server/src/services/export.service.js';
import { validateAttachmentMagicBytes } from '../../server/src/services/attachment.service.js';
import { MockBankSyncProvider } from '../../server/src/providers/bank-sync/mock-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { BankTransactionRow } from '../../server/src/db/schema.js';
import * as XLSX from 'xlsx';

describe('T1–T17 Comprehensive Functional Acceptance Matrix', () => {
  let db: Database.Database;
  let memberService: MemberService;
  let contributionService: ContributionService;
  let expenseService: ExpenseService;
  let reconciliationService: ReconciliationService;
  let exportService: ExportService;
  let mockBankProvider: MockBankSyncProvider;
  let mockAIProvider: MockAIProvider;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    contributionService = new ContributionService(db);
    mockAIProvider = new MockAIProvider();
    expenseService = new ExpenseService(db, mockAIProvider);
    mockBankProvider = new MockBankSyncProvider();
    reconciliationService = new ReconciliationService(
      db,
      mockBankProvider,
      contributionService,
      expenseService
    );
    exportService = new ExportService(db);
  });

  afterEach(() => {
    db.close();
  });

  const insertBankTx = (tx: BankTransactionRow) => {
    db.prepare(`
      INSERT INTO bank_transactions (
        id, sepay_id, gateway, transaction_date, account_number,
        transfer_type, transfer_amount, content, raw_payload,
        ingestion_source, is_excluded
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tx.id,
      tx.sepay_id,
      tx.gateway,
      tx.transaction_date,
      tx.account_number,
      tx.transfer_type,
      tx.transfer_amount,
      tx.content,
      tx.raw_payload,
      tx.ingestion_source,
      tx.is_excluded
    );
  };

  // T1: Standard contribution with exact payment code (Case A)
  it('T1: Standard contribution flow with exact payment code', () => {
    const member = memberService.searchMembers('Dương Tuấn Anh', 1)[0]!;
    db.prepare(`
      INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
      VALUES ('pi-t1', 'K8P4X', ?, 500000, 'TUAN ANH DONGQUY K8P4X', 'PENDING')
    `).run(member.id);

    const bankTx: BankTransactionRow = {
      id: 'tx-t1',
      sepay_id: 101,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'TUAN ANH DONGQUY K8P4X',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = contributionService.processIncomingTransaction(bankTx);

    expect(result.contributorType).toBe('MEMBER');
    expect(result.memberId).toBe(member.id);
    expect(result.matchMethod).toBe('EXACT_PAYMENT_CODE');
    expect(result.isAmountMismatch).toBe(false);

    // Intent is marked COMPLETED
    const intent = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get('pi-t1') as any;
    expect(intent.status).toBe('COMPLETED');
  });

  // T2: Vietnamese roster search with disambiguators
  it('T2: Vietnamese roster search with disambiguators', () => {
    const results = memberService.searchMembers('Huế', 10);
    expect(results.length).toBe(3); // Đặng Thị Huế, Nguyễn Thị Huế (Lạc Đạo), Nguyễn Thị Huế (Lương Tài)

    const lacDao = results.find((r) => r.disambiguator === 'Lạc Đạo');
    expect(lacDao).toBeDefined();
    expect(lacDao?.full_name).toBe('Nguyễn Thị Huế');
    expect(lacDao?.bank_display_name).toBe('THI HUE');
  });

  // T3: Modified transfer content where 5-char code survives
  it('T3: Modified transfer content where unique payment code survives', () => {
    const member = memberService.searchMembers('Nguyễn Vân Anh', 1)[0]!;
    db.prepare(`
      INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
      VALUES ('pi-t3', 'V9M2K', ?, 1000000, 'VAN ANH DONGQUY V9M2K', 'PENDING')
    `).run(member.id);

    const bankTx: BankTransactionRow = {
      id: 'tx-t3',
      sepay_id: 103,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 1000000,
      content: 'NGUYEN VAN ANH CHUYEN TIEN LOP V9M2K THANKS',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = contributionService.processIncomingTransaction(bankTx);
    expect(result.contributorType).toBe('MEMBER');
    expect(result.memberId).toBe(member.id);
    expect(result.matchMethod).toBe('EXACT_PAYMENT_CODE');
  });

  // T4: Deterministic name fallback (Case B)
  it('T4: Deterministic name fallback without AI when code is missing', () => {
    const member = memberService.searchMembers('Lê Thiết Giáp', 1)[0]!;
    const bankTx: BankTransactionRow = {
      id: 'tx-t4',
      sepay_id: 104,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'LE THIET GIAP DONG QUY',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = contributionService.processIncomingTransaction(bankTx);
    expect(result.contributorType).toBe('MEMBER');
    expect(result.memberId).toBe(member.id);
    expect(result.matchMethod).toBe('DETERMINISTIC_NAME_FALLBACK');
  });

  // T5: Destroyed transfer content -> UNRESOLVED (Case C)
  it('T5: Destroyed transfer content queued as UNRESOLVED', () => {
    const bankTx: BankTransactionRow = {
      id: 'tx-t5',
      sepay_id: 105,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'TIEN NHA THANG BAN',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = contributionService.processIncomingTransaction(bankTx);
    expect(result.contributorType).toBe('UNRESOLVED');
    expect(result.memberId).toBeNull();
    expect(result.matchMethod).toBe('UNRESOLVED');

    const contribution = db.prepare('SELECT * FROM contributions WHERE id = ?').get(result.contributionId) as any;
    expect(contribution.contributor_type).toBe('UNRESOLVED');
  });

  // T6: Amount mismatch flagging
  it('T6: Amount mismatch flagging when paid amount differs from intent', () => {
    const member = memberService.searchMembers('Sái Văn Độ', 1)[0]!;
    db.prepare(`
      INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
      VALUES ('pi-t6', 'D7X3P', ?, 1000000, 'VAN DO DONGQUY D7X3P', 'PENDING')
    `).run(member.id);

    const bankTx: BankTransactionRow = {
      id: 'tx-t6',
      sepay_id: 106,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000, // 500k instead of 1000k
      content: 'VAN DO DONGQUY D7X3P',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = contributionService.processIncomingTransaction(bankTx);
    expect(result.memberId).toBe(member.id);
    expect(result.amount).toBe(500000);
    expect(result.isAmountMismatch).toBe(true);

    const contrib = db.prepare('SELECT * FROM contributions WHERE id = ?').get(result.contributionId) as any;
    expect(contrib.is_amount_mismatch).toBe(1);
  });

  // T7: Multiple contributions from the same member
  it('T7: Multiple contributions aggregated correctly for a single member', () => {
    const member = memberService.searchMembers('Trịnh Thị Hân', 1)[0]!;

    const tx1: BankTransactionRow = {
      id: 'tx-t7-1',
      sepay_id: 1071,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'TRINH THI HAN DONGQUY',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };
    const tx2: BankTransactionRow = {
      id: 'tx-t7-2',
      sepay_id: 1072,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 1000000,
      content: 'TRINH THI HAN DONGQUY',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(tx1);
    contributionService.processIncomingTransaction(tx1);

    insertBankTx(tx2);
    contributionService.processIncomingTransaction(tx2);

    const totalRow = db
      .prepare('SELECT SUM(amount) as total, COUNT(*) as count FROM contributions WHERE member_id = ?')
      .get(member.id) as any;

    expect(totalRow.count).toBe(2);
    expect(totalRow.total).toBe(1500000);
  });

  // T8: Webhook idempotency (exact duplicate transaction ignored)
  it('T8: Webhook idempotency ignores duplicate transactions', () => {
    memberService.searchMembers('Dương Thành Bích', 1)[0]!;
    const tx: BankTransactionRow = {
      id: 'tx-t8',
      sepay_id: 108,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'DUONG THANH BICH DONGQUY',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(tx);
    const res1 = contributionService.processIncomingTransaction(tx);
    const res2 = contributionService.processIncomingTransaction(tx);

    expect(res1.contributionId).toBe(res2.contributionId);

    const count = db
      .prepare('SELECT COUNT(*) as c FROM contributions WHERE bank_transaction_id = ?')
      .get('tx-t8') as any;
    expect(count.c).toBe(1);
  });

  // T9: Outgoing transaction -> Expense creation
  it('T9: Outgoing transaction generates expense entry', async () => {
    const outTx: BankTransactionRow = {
      id: 'tx-t9',
      sepay_id: 109,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'out',
      transfer_amount: 3500000,
      content: 'DAT COC NHA HANG TIEC CUOI',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(outTx);
    const expense = await expenseService.processOutgoingTransaction(outTx);

    expect(expense.id).toBeDefined();
    expect(expense.amount).toBe(3500000);
    expect(expense.bank_transaction_id).toBe('tx-t9');
  });

  // T10: Learned deterministic classification rules execute before AI
  it('T10: Learned deterministic rules classify expense before AI is consulted', async () => {
    // Add rule for "NHA HANG SEN" with category FOOD
    db.prepare(`
      INSERT INTO classification_rules (id, recipient_pattern, assigned_category, suggested_title)
      VALUES ('r1', 'NHA HANG SEN', 'FOOD', 'Đặt cọc nhà hàng buffet Sen')
    `).run();

    const outTx: BankTransactionRow = {
      id: 'tx-t10',
      sepay_id: 110,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'out',
      transfer_amount: 5000000,
      content: 'CHUYEN TIEN NHA HANG SEN TAY HO',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(outTx);
    const expense = await expenseService.processOutgoingTransaction(outTx);

    expect(expense.category).toBe('FOOD');
    expect(expense.classification_source).toBe('LEARNED_RULE');
    expect(expense.vietnamese_title).toBe('Đặt cọc nhà hàng buffet Sen');
  });

  // T11: Ambiguous merchant QR expense -> UNKNOWN (needs review) & Clear transaction -> FOOD
  it('T11: Ambiguous merchant QR expense returns UNKNOWN (does not hallucinate) while clear transaction classifies properly', async () => {
    // 1. Ambiguous transaction: insufficient evidence to guess purpose
    const ambiguousTx: BankTransactionRow = {
      id: 'tx-t11-ambiguous',
      sepay_id: 1111,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'out',
      transfer_amount: 720000,
      content: 'QR839281923 NGUYEN VAN HUNG',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(ambiguousTx);
    const ambiguousExpense = await expenseService.processOutgoingTransaction(ambiguousTx);

    // Must be UNKNOWN and needs treasurer review - NO AI HALLUCINATION
    expect(ambiguousExpense.category).toBe('UNKNOWN');
    expect(ambiguousExpense.classification_source).toBe('UNKNOWN');
    expect(ambiguousExpense.vietnamese_title).toBeNull();

    // Appears in treasurer review queue
    const pendingExpenses = db
      .prepare("SELECT * FROM expenses WHERE category = 'UNKNOWN'")
      .all();
    expect(pendingExpenses.length).toBeGreaterThanOrEqual(1);

    // 2. Clear transaction: provides explicit evidence
    const clearTx: BankTransactionRow = {
      id: 'tx-t11-clear',
      sepay_id: 1112,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'out',
      transfer_amount: 3000000,
      content: 'DAT COC TIEC NHA HANG HUONG QUE',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(clearTx);
    const clearExpense = await expenseService.processOutgoingTransaction(clearTx);
    expect(clearExpense.category).toBe('FOOD');
    expect(clearExpense.classification_source).toBe('GEMINI_AI');
    expect(clearExpense.ai_confidence).toBeGreaterThanOrEqual(0.8);

    // 3. Manual Treasurer classification overrides and is preserved
    const manuallyUpdated = expenseService.updateExpenseManual(ambiguousExpense.id, {
      category: 'FLOWERS',
      title: 'Hoa tươi tặng cô giáo chủ nhiệm',
      notes: 'Thủ quỹ xác nhận hóa đơn hoa',
      recipientName: 'Nguyễn Văn Hùng (Cửa hàng hoa)',
    });

    expect(manuallyUpdated.category).toBe('FLOWERS');
    expect(manuallyUpdated.classification_source).toBe('MANUAL_OVERRIDE');
    expect(manuallyUpdated.vietnamese_title).toBe('Hoa tươi tặng cô giáo chủ nhiệm');
  });

  // T12: Treasurer manual assignment of unresolved transaction
  it('T12: Treasurer manual assignment of unresolved transaction', () => {
    const member = memberService.searchMembers('Nguyễn Minh Hoàng', 1)[0]!;
    const unresTx: BankTransactionRow = {
      id: 'tx-t12',
      sepay_id: 112,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'CK TIEN GAP NHAU',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(unresTx);
    const unresResult = contributionService.processIncomingTransaction(unresTx);
    expect(unresResult.contributorType).toBe('UNRESOLVED');

    // Treasurer manually assigns to Nguyễn Minh Hoàng
    db.prepare(`
      UPDATE contributions SET
        member_id = ?,
        contributor_type = 'MEMBER',
        match_method = 'MANUAL_TREASURER_ASSIGNMENT',
        notes = 'Xác nhận qua tin nhắn Zalo'
      WHERE id = ?
    `).run(member.id, unresResult.contributionId);

    const updated = db.prepare('SELECT * FROM contributions WHERE id = ?').get(unresResult.contributionId) as any;
    expect(updated.member_id).toBe(member.id);
    expect(updated.contributor_type).toBe('MEMBER');
    expect(updated.match_method).toBe('MANUAL_TREASURER_ASSIGNMENT');
  });

  // T13: Name correction review and approval
  it('T13: Name correction review updates canonical name while preserving immutable ID', () => {
    const member = memberService.searchMembers('Hoàng Thị Hiền', 1)[0]!;

    const req = memberService.createNameCorrectionRequest(
      member.id,
      'Hoàng Thị Thu Hiền'
    );

    const res = memberService.reviewNameCorrectionRequest(req.id, 'APPROVE', 'treasurer_admin');
    expect(res.success).toBe(true);

    const updatedMember = db.prepare('SELECT * FROM members WHERE id = ?').get(member.id) as any;
    expect(updatedMember.full_name).toBe('Hoàng Thị Thu Hiền');
    expect(updatedMember.id).toBe(member.id);
  });

  // T14: Receipt voucher attachment magic bytes validation
  it('T14: Attachment magic bytes validation accepts valid images/PDF and rejects executables', () => {
    // Valid JPEG header
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(validateAttachmentMagicBytes(jpegBuffer).isValid).toBe(true);
    expect(validateAttachmentMagicBytes(jpegBuffer).mimeType).toBe('image/jpeg');

    // Valid PNG header
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateAttachmentMagicBytes(pngBuffer).isValid).toBe(true);
    expect(validateAttachmentMagicBytes(pngBuffer).mimeType).toBe('image/png');

    // Valid PDF header
    const pdfBuffer = Buffer.from('%PDF-1.4 sample content');
    expect(validateAttachmentMagicBytes(pdfBuffer).isValid).toBe(true);
    expect(validateAttachmentMagicBytes(pdfBuffer).mimeType).toBe('application/pdf');

    // Reject executable (MZ)
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(validateAttachmentMagicBytes(exeBuffer).isValid).toBe(false);

    // Reject random binary
    const badBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(validateAttachmentMagicBytes(badBuffer).isValid).toBe(false);
  });

  // T15: Public CSV and XLSX export generation
  it('T15: Export service produces valid Excel XLSX and CSV with UTF-8 BOM', () => {
    memberService.searchMembers('Dương Tuấn Anh', 1)[0]!;
    const tx: BankTransactionRow = {
      id: 'tx-t15',
      sepay_id: 115,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'TUAN ANH DONGQUY',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };
    insertBankTx(tx);
    contributionService.processIncomingTransaction(tx);

    const xlsxBuffer = exportService.generatePublicXLSX();
    expect(xlsxBuffer).toBeInstanceOf(Buffer);
    expect(xlsxBuffer.length).toBeGreaterThan(100);

    const workbook = XLSX.read(xlsxBuffer, { type: 'buffer' });
    expect(workbook.SheetNames).toContain('Tổng quan');
    expect(workbook.SheetNames).toContain('Đóng góp');

    const csvContent = exportService.generatePublicCSV('contributions');
    expect(typeof csvContent).toBe('string');
    expect(csvContent).toContain('Dương Tuấn Anh');
    expect(csvContent).toContain('500000');
  });

  // T16: Financial totals & settlement calculations
  it('T16: Financial calculations correctly compute income, expenses, balance, and per-member share', async () => {
    memberService.searchMembers('Dương Tuấn Anh', 1)[0]!;
    memberService.searchMembers('Nguyễn Vân Anh', 1)[0]!;

    // 2 contributions: 500k + 1000k = 1500k
    const txIn1: BankTransactionRow = {
      id: 'tx-t16-1',
      sepay_id: 1161,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'TUAN ANH DONGQUY',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };
    const txIn2: BankTransactionRow = {
      id: 'tx-t16-2',
      sepay_id: 1162,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 1000000,
      content: 'VAN ANH DONGQUY',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };
    insertBankTx(txIn1);
    contributionService.processIncomingTransaction(txIn1);
    insertBankTx(txIn2);
    contributionService.processIncomingTransaction(txIn2);

    // 1 expense: 600k
    const txOut: BankTransactionRow = {
      id: 'tx-t16-out',
      sepay_id: 1163,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'out',
      transfer_amount: 600000,
      content: 'MUA HOA VA QUA LOP',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };
    insertBankTx(txOut);
    await expenseService.processOutgoingTransaction(txOut);

    const totalIn = (db.prepare('SELECT SUM(amount) as t FROM contributions').get() as any).t;
    const totalOut = (db.prepare('SELECT SUM(amount) as t FROM expenses WHERE is_settlement_transfer = 0').get() as any).t;
    const balance = totalIn - totalOut;

    expect(totalIn).toBe(1500000);
    expect(totalOut).toBe(600000);
    expect(balance).toBe(900000);

    const participatingMembers = (
      db.prepare('SELECT COUNT(DISTINCT member_id) as c FROM contributions').get() as any
    ).c;
    expect(participatingMembers).toBe(2);

    const perMemberShare = Math.round(totalOut / participatingMembers);
    expect(perMemberShare).toBe(300000);
  });

  // T17: Reconciliation catch-up & daily sync
  it('T17: Reconciliation engine syncs missing transactions idempotently', async () => {
    mockBankProvider.addMockTransaction({
      sepayId: 9901,
      gateway: 'MBBank',
      accountNumber: '0123456789',
      transactionDate: new Date().toISOString(),
      transferType: 'in',
      transferAmount: 500000,
      content: 'VU TRI THANG DONGQUY',
      referenceCode: 'REF9901',
      code: null,
    });

    const runResult = await reconciliationService.runReconciliation('MANUAL');
    expect(runResult.status).toBe('SUCCESS');
    expect(runResult.totalChecked).toBe(1);
    expect(runResult.newlyImported).toBe(1);

    // Second run should be idempotent (0 newly imported)
    const runResult2 = await reconciliationService.runReconciliation('MANUAL');
    expect(runResult2.status).toBe('SUCCESS');
    expect(runResult2.newlyImported).toBe(0);
  });
});
