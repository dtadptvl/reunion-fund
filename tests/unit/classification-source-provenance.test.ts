import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { ExpenseService } from '../../server/src/services/expense.service.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { GeminiAIProvider } from '../../server/src/providers/ai/gemini-provider.js';
import { BankTransactionRow } from '../../server/src/db/schema.js';
import { AIProvider } from '../../server/src/providers/ai/types.js';

describe('Classification Source Provenance and Truthfulness', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    if (db && db.open) db.close();
  });

  const insertTx = (id: string, content: string, amount = 350000): BankTransactionRow => {
    const tx: BankTransactionRow = {
      id,
      sepay_id: Math.floor(Math.random() * 1000000),
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      sub_account: null,
      transfer_type: 'out',
      transfer_amount: amount,
      accumulated: null,
      code: null,
      content,
      description: null,
      reference_code: `REF_${id}`,
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      exclusion_reason: null,
      excluded_by: null,
      created_at: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tx.id, tx.sepay_id, tx.gateway, tx.transaction_date, tx.account_number, tx.transfer_type, tx.transfer_amount, tx.content, tx.raw_payload, tx.ingestion_source);

    return tx;
  };

  it('assigns MOCK_AI when MockAIProvider processes an outgoing expense', async () => {
    const mockAI = new MockAIProvider();
    expect(mockAI.source).toBe('MOCK_AI');

    const expenseService = new ExpenseService(db, mockAI);
    const tx = insertTx('tx-mock-1', 'DAT COC NHA HANG TIEC HOP LOP');
    const expense = await expenseService.processOutgoingTransaction(tx);

    expect(expense.classification_source).toBe('MOCK_AI');
    expect(expense.category).toBe('FOOD');
    expect(expense.vietnamese_title).toBe('Đặt cọc nhà hàng');
  });

  it('assigns GEMINI_AI when GeminiAIProvider is active', async () => {
    const geminiMock: AIProvider = {
      source: 'GEMINI_AI',
      classifyExpense: async () => ({
        title: 'Đặt cọc nhà hàng tiệc',
        category: 'FOOD',
        confidence: 0.96,
      }),
    };

    const expenseService = new ExpenseService(db, geminiMock);
    const tx = insertTx('tx-gemini-1', 'DAT COC NHA HANG TIEC');
    const expense = await expenseService.processOutgoingTransaction(tx);

    expect(expense.classification_source).toBe('GEMINI_AI');
    expect(expense.category).toBe('FOOD');
    expect(expense.vietnamese_title).toBe('Đặt cọc nhà hàng tiệc');
  });

  it('ensures MANUAL_OVERRIDE permanently overrides any AI or Mock classification', async () => {
    const mockAI = new MockAIProvider();
    const expenseService = new ExpenseService(db, mockAI);
    const tx = insertTx('tx-override-1', 'QR839281923', 120000);
    const expense = await expenseService.processOutgoingTransaction(tx);

    expect(expense.classification_source).toBe('UNKNOWN');

    const updated = expenseService.updateExpenseManual(expense.id, {
      title: 'Nước uống họp lớp',
      category: 'FOOD',
      notes: 'Thủ quỹ xác nhận hóa đơn',
    });

    expect(updated.classification_source).toBe('MANUAL_OVERRIDE');
    expect(updated.vietnamese_title).toBe('Nước uống họp lớp');
    expect(updated.category).toBe('FOOD');
  });
});
