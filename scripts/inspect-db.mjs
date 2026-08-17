import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/data/reunion-fund/stage/data/reunion-fund.db');
console.log('--- DB SUMMARY ---');
const countTx = db.prepare('SELECT count(*) as c FROM bank_transactions').get();
console.log('bank_transactions count:', countTx.c);

const countContrib = db.prepare('SELECT count(*) as c FROM contributions').get();
console.log('contributions count:', countContrib.c);

const latestIntent = db.prepare('SELECT payment_code, member_id, expected_amount, status, created_at FROM payment_intents ORDER BY created_at DESC LIMIT 1').get();
console.log('latest payment_intent:', latestIntent);
