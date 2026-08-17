const Database = require('better-sqlite3');
const db = new Database('/app/data/reunion.db');
console.log('--- DB SUMMARY ---');
console.log('bank_transactions count:', db.prepare('SELECT count(*) as c FROM bank_transactions').get().c);
console.log('contributions count:', db.prepare('SELECT count(*) as c FROM contributions').get().c);
console.log('latest payment_intent:', db.prepare('SELECT payment_code, member_id, expected_amount, status, created_at FROM payment_intents ORDER BY created_at DESC LIMIT 1').get());
