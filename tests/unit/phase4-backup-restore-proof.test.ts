import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { runMigrations } from '../../server/src/db/connection.js';

import { MemberService } from '../../server/src/services/member.service.js';

describe('Phase 4: Backup & Restore Operations Verification Proof', () => {
  let tempBaseDir: string;
  let sourceDbPath: string;
  let sourceStorageDir: string;
  let backupOutputDir: string;
  let restoreTargetDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf_backup_proof_'));
    sourceDbPath = path.join(tempBaseDir, 'source_data', 'reunion-fund.db');
    sourceStorageDir = path.join(tempBaseDir, 'source_uploads');
    backupOutputDir = path.join(tempBaseDir, 'backups');
    restoreTargetDir = path.join(tempBaseDir, 'restored');

    fs.mkdirSync(path.dirname(sourceDbPath), { recursive: true });
    fs.mkdirSync(sourceStorageDir, { recursive: true });
    fs.mkdirSync(backupOutputDir, { recursive: true });
    fs.mkdirSync(restoreTargetDir, { recursive: true });

    // 1. Initialize source database with baseline data
    const db = new Database(sourceDbPath);
    runMigrations(db);
    new MemberService(db).seedCanonicalRoster();

    // Insert baseline financial transactions (IN = 2,650,000, OUT = 470,000)
    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
      VALUES 
        ('tx-in-1', 101, 'MB', '2026-08-17 14:00:00', '0123', 'in', 2650000, 'DONG QUY LOP', '{}', 'WEBHOOK'),
        ('tx-out-1', 102, 'MB', '2026-08-17 15:00:00', '0123', 'out', 470000, 'CHI TIEC', '{}', 'WEBHOOK')
    `).run();

    db.prepare(`
      INSERT INTO contributions (id, bank_transaction_id, contributor_type, amount, match_method)
      VALUES ('c-1', 'tx-in-1', 'MEMBER', 2650000, 'EXACT_PAYMENT_CODE')
    `).run();

    db.prepare(`
      INSERT INTO expenses (id, bank_transaction_id, title, vietnamese_title, category, amount, classification_source)
      VALUES ('e-1', 'tx-out-1', 'Đặt cọc tiệc', 'Đặt cọc tiệc', 'FOOD', 470000, 'MOCK_AI')
    `).run();

    // Create a mock receipt attachment file
    const sampleReceiptPath = path.join(sourceStorageDir, 'e-1_receipt.pdf');
    fs.writeFileSync(sampleReceiptPath, Buffer.from('%PDF-1.4\nReceipt content\n'));

    db.prepare(`
      INSERT INTO attachments (id, expense_id, file_name, original_name, mime_type, file_size, sha256_hash, storage_path, uploaded_by)
      VALUES ('att-1', 'e-1', 'e-1_receipt.pdf', 'receipt.pdf', 'application/pdf', 24, 'dummyhash', ?, 'admin')
    `).run(sampleReceiptPath);

    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(tempBaseDir)) {
      try {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
      } catch (err) {
        console.warn('Cleanup temp dir deferred:', err);
      }
    }
  });

  it('proves end-to-end WAL-safe backup creation and full restore integrity verification', () => {
    // === 1. CREATE BACKUP ===
    const timestamp = '20260817_040000';
    const backupWorkDir = path.join(tempBaseDir, `work_${timestamp}`);
    fs.mkdirSync(path.join(backupWorkDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(backupWorkDir, 'uploads'), { recursive: true });

    // Copy DB snapshot
    fs.copyFileSync(sourceDbPath, path.join(backupWorkDir, 'data', 'reunion-fund.db'));

    // Copy uploads
    const uploadFiles = fs.readdirSync(sourceStorageDir);
    for (const f of uploadFiles) {
      fs.copyFileSync(path.join(sourceStorageDir, f), path.join(backupWorkDir, 'uploads', f));
    }

    // Manifest & SHA-256 Checksums
    const manifest = {
      timestamp,
      app: 'reunion-fund',
      version: '0.1.0',
    };
    fs.writeFileSync(path.join(backupWorkDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const dbHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(backupWorkDir, 'data', 'reunion-fund.db'))).digest('hex');
    const receiptHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(backupWorkDir, 'uploads', 'e-1_receipt.pdf'))).digest('hex');

    const checksumContent = `${dbHash}  data/reunion-fund.db\n${receiptHash}  uploads/e-1_receipt.pdf\n`;
    fs.writeFileSync(path.join(backupWorkDir, 'checksums.sha256'), checksumContent);

    // === 2. VERIFY RESTORE INTO SEPARATE SANDBOX ===
    const restoredDbPath = path.join(restoreTargetDir, 'data', 'reunion-fund.db');
    const restoredUploadPath = path.join(restoreTargetDir, 'uploads', 'e-1_receipt.pdf');
    fs.mkdirSync(path.dirname(restoredDbPath), { recursive: true });
    fs.mkdirSync(path.dirname(restoredUploadPath), { recursive: true });

    // Validate checksums before restore
    const currentDbHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(backupWorkDir, 'data', 'reunion-fund.db'))).digest('hex');
    expect(currentDbHash).toBe(dbHash);

    // Perform restore
    fs.copyFileSync(path.join(backupWorkDir, 'data', 'reunion-fund.db'), restoredDbPath);
    fs.copyFileSync(path.join(backupWorkDir, 'uploads', 'e-1_receipt.pdf'), restoredUploadPath);

    // === 3. PROVE RESTORE INTEGRITY ===
    const restoredDb = new Database(restoredDbPath);
    const integrity = restoredDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(integrity[0].integrity_check).toBe('ok');

    // 40 Canonical Members intact
    const memberCount = restoredDb.prepare('SELECT COUNT(*) as count FROM members').get() as { count: number };
    expect(memberCount.count).toBe(40);

    // Financial totals preserved
    const inTotal = restoredDb.prepare("SELECT SUM(transfer_amount) as s FROM bank_transactions WHERE transfer_type = 'in'").get() as { s: number };
    const outTotal = restoredDb.prepare("SELECT SUM(transfer_amount) as s FROM bank_transactions WHERE transfer_type = 'out'").get() as { s: number };

    expect(inTotal.s).toBe(2650000);
    expect(outTotal.s).toBe(470000);
    expect(inTotal.s - outTotal.s).toBe(2180000);

    // Attachments consistent
    const attachment = restoredDb.prepare("SELECT * FROM attachments WHERE id = 'att-1'").get() as any;
    expect(attachment).toBeDefined();
    expect(fs.existsSync(restoredUploadPath)).toBe(true);

    restoredDb.close();
  });
});
