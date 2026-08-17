import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('/data/data/com.termux/files/home/check_db/reunion-fund.db');
const staff = db.prepare('SELECT id, username, full_name, role FROM staff_users').all();
console.log('Staff users:', JSON.stringify(staff, null, 2));
