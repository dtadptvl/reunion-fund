import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/data/data/com.termux/files/home/check_db/reunion-fund.db');

console.log('================= 1. OUT BANK TRANSACTIONS =================');
const outTxs = db.prepare(`
  SELECT id, sepay_id, gateway, transaction_date, transfer_type, transfer_amount, content, raw_payload, created_at
  FROM bank_transactions
  WHERE transfer_type = 'out'
  ORDER BY created_at ASC
`).all();
console.log(JSON.stringify(outTxs, null, 2));

console.log('================= 2. ALL EXPENSES =================');
const expenses = db.prepare(`
  SELECT id, bank_transaction_id, title, vietnamese_title, category, recipient_name, recipient_account, recipient_bank, amount, classification_source, ai_confidence, is_settlement_transfer, created_at
  FROM expenses
  ORDER BY created_at ASC
`).all();
console.log(JSON.stringify(expenses, null, 2));

console.log('================= 3. RECONCILIATION TOTALS =================');
const countIn = db.prepare("SELECT COALESCE(SUM(transfer_amount), 0) as total FROM bank_transactions WHERE transfer_type = 'in'").get();
const countOut = db.prepare("SELECT COALESCE(SUM(transfer_amount), 0) as total FROM bank_transactions WHERE transfer_type = 'out'").get();
const expenseTotal = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM expenses").get();
const contribTotal = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM contributions").get();

console.log({
  bankIn: countIn.total,
  bankOut: countOut.total,
  expenseTotal: expenseTotal.total,
  contribTotal: contribTotal.total,
  balance: countIn.total - expenseTotal.total
});
