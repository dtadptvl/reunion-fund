import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/data/data/com.termux/files/home/check_db/reunion-fund.db');
const row = db.prepare("SELECT * FROM bank_transactions WHERE content LIKE '%SGZV8%'").get();
console.log('Stored Bank Transaction:');
console.log('id:', row.id);
console.log('sepay_id:', row.sepay_id);
console.log('gateway:', row.gateway);
console.log('transaction_date:', row.transaction_date);
console.log('transfer_type:', row.transfer_type);
console.log('transfer_amount:', row.transfer_amount);
console.log('content:', row.content);
console.log('raw_payload:', row.raw_payload);
