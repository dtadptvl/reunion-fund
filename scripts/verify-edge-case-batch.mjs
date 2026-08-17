import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/data/data/com.termux/files/home/check_db/reunion-fund.db');

console.log('================= 1. ALL BANK TRANSACTIONS =================');
const txs = db.prepare('SELECT id, sepay_id, gateway, transaction_date, transfer_type, transfer_amount, content, ingestion_source, created_at FROM bank_transactions ORDER BY created_at ASC').all();
console.log(JSON.stringify(txs, null, 2));

console.log('================= 2. ALL CONTRIBUTIONS =================');
const contribs = db.prepare(`
  SELECT c.id, c.bank_transaction_id, c.payment_intent_id, c.contributor_type, c.member_id, m.full_name, m.disambiguator, c.amount, c.is_amount_mismatch, c.match_method, c.unresolved_name, c.created_at
  FROM contributions c
  LEFT JOIN members m ON c.member_id = m.id
  ORDER BY c.created_at ASC
`).all();
console.log(JSON.stringify(contribs, null, 2));

console.log('================= 3. UNRESOLVED TRANSACTIONS =================');
const unresolved = db.prepare(`
  SELECT * FROM unresolved_transactions ORDER BY created_at ASC
`).all();
console.log(JSON.stringify(unresolved, null, 2));

console.log('================= 4. PAYMENT INTENTS =================');
const intents = db.prepare(`
  SELECT pi.id, pi.payment_code, pi.member_id, m.full_name, m.disambiguator, pi.expected_amount, pi.status, pi.created_at
  FROM payment_intents pi
  LEFT JOIN members m ON pi.member_id = m.id
  WHERE pi.payment_code IN ('SGZV8', '3E5TZ', 'FKBA7', 'BX6KJ', 'N7MSQ')
`).all();
console.log(JSON.stringify(intents, null, 2));
