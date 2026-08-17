import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { ContributionService } from '../../server/src/services/contribution.service.js';
import { BankTransactionRow } from '../../server/src/db/schema.js';

describe('Deterministic Contributor Matching (AI Strictly Forbidden)', () => {
  let db: Database.Database;
  let service: ContributionService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    service = new ContributionService(db);

    // Insert canonical members
    db.prepare(`
      INSERT INTO members (id, full_name, normalized_name, bank_display_name)
      VALUES
        ('m1', 'Vũ Trí Thắng', 'VU TRI THANG', 'TRI THANG'),
        ('m2', 'Nguyễn Văn An', 'NGUYEN VAN AN', 'VAN AN'),
        ('m3', 'Trần Minh Đức', 'TRAN MINH DUC', 'MINH DUC')
    `).run();
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

  it('matches exactly by unique payment code (Case A)', () => {
    db.prepare(`
      INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
      VALUES ('pi-1', 'K8P4X', 'm1', 500000, 'TRI THANG DONGQUY K8P4X', 'PENDING')
    `).run();

    const bankTx: BankTransactionRow = {
      id: 'tx-1',
      sepay_id: 1001,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'VU TRI THANG DONGQUY K8P4X',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = service.processIncomingTransaction(bankTx);
    expect(result.contributorType).toBe('MEMBER');
    expect(result.memberId).toBe('m1');
    expect(result.matchMethod).toBe('EXACT_PAYMENT_CODE');
    expect(result.isAmountMismatch).toBe(false);
  });

  it('matches when user modifies transfer content but unique code survives', () => {
    db.prepare(`
      INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
      VALUES ('pi-2', 'K8P4X', 'm1', 500000, 'TRI THANG DONGQUY K8P4X', 'PENDING')
    `).run();

    const bankTx: BankTransactionRow = {
      id: 'tx-2',
      sepay_id: 1002,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'ABC K8P4X XYZ CHUYEN TIEN',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = service.processIncomingTransaction(bankTx);
    expect(result.contributorType).toBe('MEMBER');
    expect(result.memberId).toBe('m1');
    expect(result.matchMethod).toBe('EXACT_PAYMENT_CODE');
  });

  it('falls back to deterministic exact name matching when code is missing (Case B)', () => {
    const bankTx: BankTransactionRow = {
      id: 'tx-3',
      sepay_id: 1003,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'VU TRI THANG DONGQUY',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = service.processIncomingTransaction(bankTx);
    expect(result.contributorType).toBe('MEMBER');
    expect(result.memberId).toBe('m1');
    expect(result.matchMethod).toBe('DETERMINISTIC_NAME_FALLBACK');
  });

  it('marks transaction UNRESOLVED when content is destroyed (Case C)', () => {
    const bankTx: BankTransactionRow = {
      id: 'tx-4',
      sepay_id: 1004,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'TIEN HOP LOP 10 NAM',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = service.processIncomingTransaction(bankTx);
    expect(result.contributorType).toBe('UNRESOLVED');
    expect(result.memberId).toBeNull();
    expect(result.matchMethod).toBe('UNRESOLVED');
  });

  it('flags amount mismatch when actual paid amount differs from intent', () => {
    db.prepare(`
      INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
      VALUES ('pi-3', 'M7N2Q', 'm2', 500000, 'VAN AN DONGQUY M7N2Q', 'PENDING')
    `).run();

    const bankTx: BankTransactionRow = {
      id: 'tx-5',
      sepay_id: 1005,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 300000, // 300k instead of 500k
      content: 'VAN AN DONGQUY M7N2Q',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    insertBankTx(bankTx);
    const result = service.processIncomingTransaction(bankTx);
    expect(result.contributorType).toBe('MEMBER');
    expect(result.memberId).toBe('m2');
    expect(result.amount).toBe(300000);
    expect(result.isAmountMismatch).toBe(true);
  });
});
