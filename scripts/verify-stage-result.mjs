import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/data/data/com.termux/files/home/check_db/reunion-fund.db');

console.log('=== BANK TRANSACTIONS ===');
const txs = db.prepare("SELECT id, sepay_id, gateway, transaction_date, transfer_type, transfer_amount, content, ingestion_source, is_excluded, created_at FROM bank_transactions WHERE content LIKE '%SGZV8%'").all();
console.log(JSON.stringify(txs, null, 2));

console.log('=== CONTRIBUTIONS ===');
const contribs = db.prepare(`
  SELECT c.*, m.full_name, m.disambiguator
  FROM contributions c
  LEFT JOIN members m ON c.member_id = m.id
  WHERE c.amount = 500000
`).all();
console.log(JSON.stringify(contribs, null, 2));

console.log('=== PAYMENT INTENTS ===');
const intents = db.prepare(`
  SELECT pi.id, pi.payment_code, pi.member_id, m.full_name, m.disambiguator, pi.expected_amount, pi.status, pi.created_at
  FROM payment_intents pi
  LEFT JOIN members m ON pi.member_id = m.id
  WHERE pi.payment_code = 'SGZV8'
`).all();
console.log(JSON.stringify(intents, null, 2));

console.log('=== UNRESOLVED TRANSACTIONS ===');
const unresolved = db.prepare("SELECT * FROM unresolved_transactions WHERE bank_transaction_id IN (SELECT id FROM bank_transactions WHERE content LIKE '%SGZV8%')").all();
console.log(JSON.stringify(unresolved, null, 2));
