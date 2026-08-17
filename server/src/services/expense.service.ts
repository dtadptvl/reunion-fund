import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  BankTransactionRow,
  ExpenseRow,
  ExpenseCategory,
  ClassificationRuleRow,
} from '../db/schema.js';
import { AIProvider } from '../providers/ai/types.js';
import { removeVietnameseDiacritics } from './vietqr.service.js';

export class ExpenseService {
  constructor(
    private db: Database.Database,
    private aiProvider: AIProvider
  ) {}

  /**
   * Process an outgoing bank transaction and create an expense record.
   * Priority:
   * 1. Manual override (never overwritten)
   * 2. Learned deterministic rules
   * 3. Gemini suggestion
   * 4. UNKNOWN
   */
  async processOutgoingTransaction(bankTx: BankTransactionRow): Promise<ExpenseRow> {
    const existing = this.db
      .prepare('SELECT * FROM expenses WHERE bank_transaction_id = ?')
      .get(bankTx.id) as ExpenseRow | undefined;

    if (existing) {
      return existing;
    }

    const description = `${bankTx.content || ''} ${bankTx.description || ''}`.trim();
    const normalizedDesc = removeVietnameseDiacritics(description);

    let category: ExpenseCategory = 'UNKNOWN';
    let title: string | null = null;
    let classificationSource: ExpenseRow['classification_source'] = 'UNKNOWN';
    let confidence: number | null = null;
    let isSettlement = 0;

    // Check Priority 2: Learned deterministic rules
    const rules = this.db
      .prepare('SELECT * FROM classification_rules')
      .all() as ClassificationRuleRow[];

    for (const rule of rules) {
      if (normalizedDesc.includes(removeVietnameseDiacritics(rule.recipient_pattern))) {
        category = rule.assigned_category;
        title = rule.suggested_title || null;
        classificationSource = 'LEARNED_RULE';
        confidence = 1.0;
        break;
      }
    }

    // Check Priority 3: Gemini AI Classification (if rule not matched)
    if (classificationSource === 'UNKNOWN') {
      try {
        const aiResult = await this.aiProvider.classifyExpense(
          description,
          null,
          bankTx.transfer_amount
        );
        if (aiResult && aiResult.category !== 'UNKNOWN') {
          category = aiResult.category;
          title = aiResult.title;
          classificationSource = 'GEMINI_AI';
          confidence = aiResult.confidence;
        }
      } catch (err) {
        console.warn('AI classification skipped:', err);
      }
    }

    if (category === 'FUND_TRANSFER') {
      isSettlement = 1;
    }

    const expenseId = crypto.randomUUID();
    const newExpense: ExpenseRow = {
      id: expenseId,
      bank_transaction_id: bankTx.id,
      title: title || description,
      vietnamese_title: title,
      category,
      recipient_name: null,
      recipient_account: null,
      recipient_bank: null,
      amount: bankTx.transfer_amount,
      classification_source: classificationSource,
      ai_confidence: confidence,
      is_settlement_transfer: isSettlement,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.db
      .prepare(`
        INSERT INTO expenses (
          id, bank_transaction_id, title, vietnamese_title, category,
          recipient_name, recipient_account, recipient_bank, amount,
          classification_source, ai_confidence, is_settlement_transfer,
          notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
      .run(
        newExpense.id,
        newExpense.bank_transaction_id,
        newExpense.title,
        newExpense.vietnamese_title,
        newExpense.category,
        newExpense.recipient_name,
        newExpense.recipient_account,
        newExpense.recipient_bank,
        newExpense.amount,
        newExpense.classification_source,
        newExpense.ai_confidence,
        newExpense.is_settlement_transfer,
        newExpense.notes
      );

    return newExpense;
  }

  /**
   * Manual Treasurer classification override.
   * Sets classification_source = 'MANUAL_OVERRIDE' and marks settlement status if applicable.
   */
  updateExpenseManual(
    expenseId: string,
    data: {
      category: ExpenseCategory;
      title: string;
      notes?: string | null;
      recipientName?: string | null;
    }
  ): ExpenseRow {
    const isSettlement = data.category === 'FUND_TRANSFER' ? 1 : 0;

    this.db.prepare(`
      UPDATE expenses SET
        category = ?,
        title = ?,
        vietnamese_title = ?,
        notes = ?,
        recipient_name = COALESCE(?, recipient_name),
        classification_source = 'MANUAL_OVERRIDE',
        is_settlement_transfer = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      data.category,
      data.title,
      data.title,
      data.notes || null,
      data.recipientName || null,
      isSettlement,
      expenseId
    );

    return this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as ExpenseRow;
  }
}
