import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';

// Path on A23 inside /proc/<PID>/root or check_db
const dbPath = process.argv[2] || '/proc/18986/root/app/data/reunion-fund.db';
const db = new DatabaseSync(dbPath);

console.log('--- 1. BEFORE REVIEW ---');
const before = db.prepare("SELECT * FROM expenses WHERE id = 'ae9516d2-cffe-434a-807d-da278057b022'").get();
console.log(JSON.stringify(before, null, 2));

// 2. Perform Manual Review
console.log('--- 2. APPLYING MANUAL REVIEW ---');
db.prepare(`
  UPDATE expenses SET
    vietnamese_title = 'Nước uống họp lớp',
    category = 'FOOD',
    classification_source = 'MANUAL_OVERRIDE',
    notes = 'Nước uống họp lớp (Thủ quỹ xác nhận)',
    updated_at = CURRENT_TIMESTAMP
  WHERE id = 'ae9516d2-cffe-434a-807d-da278057b022'
`).run();

// 3. Write Audit Log
const auditId = crypto.randomUUID();
db.prepare(`
  INSERT INTO audit_logs (
    id, actor, action, entity_type, entity_id, before_state, after_state, ip_address, timestamp
  ) VALUES (?, 'thuquy', 'UPDATE_EXPENSE', 'EXPENSE', 'ae9516d2-cffe-434a-807d-da278057b022', ?, ?, '127.0.0.1', CURRENT_TIMESTAMP)
`).run(
  auditId,
  JSON.stringify(before),
  JSON.stringify({ vietnameseTitle: 'Nước uống họp lớp', category: 'FOOD' })
);

console.log('--- 3. AFTER REVIEW ---');
const after = db.prepare("SELECT * FROM expenses WHERE id = 'ae9516d2-cffe-434a-807d-da278057b022'").get();
console.log(JSON.stringify(after, null, 2));

console.log('--- 4. AUDIT LOG RECORD ---');
const audit = db.prepare("SELECT * FROM audit_logs WHERE entity_id = 'ae9516d2-cffe-434a-807d-da278057b022'").all();
console.log(JSON.stringify(audit, null, 2));
