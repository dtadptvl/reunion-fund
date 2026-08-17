import Database from 'better-sqlite3';
const db = new Database('/data/reunion-fund/stage/data/reunion.db');
console.log('bank_transactions count:', db.prepare('SELECT count(*) as c FROM bank_transactions').get().c);
console.log('contributions count:', db.prepare('SELECT count(*) as c FROM contributions').get().c);
console.log('payment_intents for AWP9L:', db.prepare("SELECT * FROM payment_intents WHERE payment_code = 'AWP9L'").get());
