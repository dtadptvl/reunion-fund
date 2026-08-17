import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/data/data/com.termux/files/home/check_db/reunion-fund.db');

const expensesNeedingReview = db.prepare(`
  SELECT e.id, e.amount, e.category, e.title, e.recipient_name, e.created_at, bt.content, bt.description
  FROM expenses e
  JOIN bank_transactions bt ON e.bank_transaction_id = bt.id
  WHERE e.category = 'UNKNOWN' OR e.vietnamese_title IS NULL
  ORDER BY e.created_at DESC
`).all();

console.log('Expenses needing review in Treasurer queue:');
console.log(JSON.stringify(expensesNeedingReview, null, 2));
