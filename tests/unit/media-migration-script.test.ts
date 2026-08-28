import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { runMediaMigration } from '../../server/src/scripts/migrate-media-to-r2.js';
import { LocalStorageProvider, ObjectStorage } from '../../server/src/storage/index.js';

describe('Media Migration to R2 Script Tests', () => {
  let db: Database.Database;
  let tempDir: string;
  let dbPath: string;
  let uploadDir: string;
  let mockR2Store: Map<string, { body: Buffer; metadata: any }>;
  let mockR2Storage: ObjectStorage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf_migration_test_'));
    dbPath = path.join(tempDir, 'reunion_test.db');
    uploadDir = path.join(tempDir, 'uploads');
    fs.mkdirSync(uploadDir, { recursive: true });

    db = new Database(dbPath);

    // Run migrations
    const migrationsDir = path.resolve(__dirname, '../../server/src/db/migrations');
    const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf-8');
      db.exec(sql);
    }

    // Seed test bank transaction and expense
    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source, is_excluded)
      VALUES ('tx-1', 12345, 'MBBank', '2026-08-19 12:00:00', '0123456789', 'out', 500000, 'Chi phi lien hoan', '{}', 'WEBHOOK', 0)
    `).run();

    db.prepare(`
      INSERT INTO expenses (id, bank_transaction_id, category, amount, classification_source, is_settlement_transfer, created_at, updated_at)
      VALUES ('exp-1', 'tx-1', 'FOOD', 500000, 'MANUAL_OVERRIDE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();

    // Create 2 local receipt files on disk
    const receipt1Content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
    const receipt1File = 'exp-1_att1.png';
    fs.writeFileSync(path.join(uploadDir, receipt1File), receipt1Content);

    db.prepare(`
      INSERT INTO attachments (id, expense_id, file_name, original_name, mime_type, file_size, sha256_hash, storage_path, storage_provider, storage_key, uploaded_by, created_at)
      VALUES ('att-1', 'exp-1', ?, 'Receipt_1.png', 'image/png', ?, ?, ?, 'LOCAL', ?, 'admin', CURRENT_TIMESTAMP)
    `).run(
      receipt1File,
      receipt1Content.length,
      crypto.createHash('sha256').update(receipt1Content).digest('hex'),
      path.join(uploadDir, receipt1File),
      `receipts/${receipt1File}`
    );

    const receipt2Content = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const receipt2File = 'exp-1_att2.jpg';
    fs.writeFileSync(path.join(uploadDir, receipt2File), receipt2Content);

    db.prepare(`
      INSERT INTO attachments (id, expense_id, file_name, original_name, mime_type, file_size, sha256_hash, storage_path, storage_provider, storage_key, uploaded_by, created_at)
      VALUES ('att-2', 'exp-1', ?, 'Bill_2.jpg', 'image/jpeg', ?, ?, ?, 'LOCAL', ?, 'admin', CURRENT_TIMESTAMP)
    `).run(
      receipt2File,
      receipt2Content.length,
      crypto.createHash('sha256').update(receipt2Content).digest('hex'),
      path.join(uploadDir, receipt2File),
      `receipts/${receipt2File}`
    );

    // Create local lottery background music
    const audioDir = path.join(uploadDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const musicContent = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00Test MP3 Audio Music');
    const musicFile = 'lottery_bgm_test.mp3';
    fs.writeFileSync(path.join(audioDir, musicFile), musicContent);

    const musicMeta = {
      filename: musicFile,
      originalName: 'Theme.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: musicContent.length,
      uploadedAt: new Date().toISOString(),
      actor: 'admin',
      storageProvider: 'LOCAL',
      storageKey: `lottery/background/${musicFile}`,
    };

    db.prepare(`
      INSERT INTO system_state (key, value)
      VALUES ('lottery_background_music', ?)
    `).run(JSON.stringify(musicMeta));

    db.close();

    // Mock R2 storage
    mockR2Store = new Map();
    mockR2Storage = {
      providerName: 'R2',
      put: async (key, data, meta) => {
        mockR2Store.set(key, { body: data, metadata: meta });
      },
      get: async (key) => {
        const item = mockR2Store.get(key);
        if (!item) return null;
        return {
          key,
          size: item.body.length,
          contentType: item.metadata?.contentType,
          contentDisposition: item.metadata?.contentDisposition,
          sha256: item.metadata?.sha256,
          body: item.body,
        };
      },
      getStream: async () => null,
      head: async (key) => {
        const item = mockR2Store.get(key);
        if (!item) return null;
        return {
          key,
          size: item.body.length,
          contentType: item.metadata?.contentType,
          contentDisposition: item.metadata?.contentDisposition,
          sha256: item.metadata?.sha256,
        };
      },
      delete: async (key) => {
        mockR2Store.delete(key);
      },
      getPublicUrl: (k) => `/media/${k}`,
    };
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1. Dry-run inventories media files without uploading to storage or modifying DB', async () => {
    const summary = await runMediaMigration({
      dryRun: true,
      dbPath,
      storageDir: uploadDir,
      storageOverride: mockR2Storage,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.attachmentsScanned).toBe(2);
    expect(summary.attachmentsMigrated).toBe(2);
    expect(summary.musicScanned).toBe(1);
    expect(summary.musicMigrated).toBe(1);
    expect(summary.totalBytes).toBeGreaterThan(0);
    expect(summary.errors).toHaveLength(0);

    // Mock R2 store remains empty
    expect(mockR2Store.size).toBe(0);

    // DB remains with storage_provider = 'LOCAL'
    const verifyDb = new Database(dbPath);
    const row = verifyDb.prepare('SELECT storage_provider FROM attachments WHERE id = ?').get('att-1') as any;
    expect(row.storage_provider).toBe('LOCAL');
    verifyDb.close();
  });

  it('2. Execute mode uploads objects to R2, verifies SHA-256, and updates DB metadata', async () => {
    const summary = await runMediaMigration({
      dryRun: false,
      dbPath,
      storageDir: uploadDir,
      storageOverride: mockR2Storage,
    });

    expect(summary.dryRun).toBe(false);
    expect(summary.attachmentsMigrated).toBe(2);
    expect(summary.musicMigrated).toBe(1);
    expect(summary.errors).toHaveLength(0);

    // Objects are written to R2 storage
    expect(mockR2Store.has('receipts/exp-1_att1.png')).toBe(true);
    expect(mockR2Store.has('receipts/exp-1_att2.jpg')).toBe(true);
    expect(mockR2Store.has('lottery/background/lottery_bgm_test.mp3')).toBe(true);

    // DB rows are updated with storage_provider = 'R2'
    const verifyDb = new Database(dbPath);
    const row1 = verifyDb.prepare('SELECT storage_provider, storage_key FROM attachments WHERE id = ?').get('att-1') as any;
    expect(row1.storage_provider).toBe('R2');
    expect(row1.storage_key).toBe('receipts/exp-1_att1.png');

    const musicRow = verifyDb.prepare("SELECT value FROM system_state WHERE key = 'lottery_background_music'").get() as any;
    const musicMeta = JSON.parse(musicRow.value);
    expect(musicMeta.storageProvider).toBe('R2');
    expect(musicMeta.publicUrl).toBe('/media/lottery/background/lottery_bgm_test.mp3');
    verifyDb.close();
  });

  it('3. Idempotency: re-running migration skips already migrated & verified objects', async () => {
    // 1st run: Execute
    await runMediaMigration({
      dryRun: false,
      dbPath,
      storageDir: uploadDir,
      storageOverride: mockR2Storage,
    });

    // 2nd run: Execute again
    const summary2 = await runMediaMigration({
      dryRun: false,
      dbPath,
      storageDir: uploadDir,
      storageOverride: mockR2Storage,
    });

    expect(summary2.attachmentsScanned).toBe(2);
    expect(summary2.attachmentsSkipped).toBe(2);
    expect(summary2.attachmentsMigrated).toBe(0);
    expect(summary2.musicSkipped).toBe(1);
    expect(summary2.musicMigrated).toBe(0);
  });

  describe('Architect Review Fixes: B1 SHA-256 verification, B2 zero-byte/size guard, B4 music inventory', () => {
    it('4. B1: SHA-256 mismatch on post-upload head fails the record and leaves DB untouched', async () => {
      // Corrupting R2 mock: put stores the object, but head reports a different SHA-256
      const corruptStore = new Map<string, { body: Buffer; metadata: any }>();
      const corruptR2: ObjectStorage = {
        providerName: 'R2',
        put: async (key, data, meta) => {
          corruptStore.set(key, { body: data, metadata: meta });
        },
        get: async () => null,
        getStream: async () => null,
        head: async (key) => {
          const item = corruptStore.get(key);
          if (!item) return null;
          return {
            key,
            size: item.body.length,
            contentType: item.metadata?.contentType,
            contentDisposition: item.metadata?.contentDisposition,
            sha256: 'corrupted-' + (item.metadata?.sha256 || 'sha'),
          };
        },
        delete: async (key) => {
          corruptStore.delete(key);
        },
        getPublicUrl: (k) => `/media/${k}`,
      };

      const summary = await runMediaMigration({
        dryRun: false,
        dbPath,
        storageDir: uploadDir,
        storageOverride: corruptR2,
      });

      // All records fail verification BEFORE DB update
      expect(summary.attachmentsMigrated).toBe(0);
      expect(summary.attachmentsFailed).toBe(2);
      expect(summary.musicMigrated).toBe(0);
      expect(summary.musicFailed).toBe(1);
      expect(summary.errors.length).toBeGreaterThanOrEqual(3);
      expect(summary.errors.some((e) => e.includes('SHA-256 mismatch'))).toBe(true);

      // DB remains untouched (still LOCAL provenance)
      const verifyDb = new Database(dbPath);
      const row1 = verifyDb.prepare('SELECT storage_provider FROM attachments WHERE id = ?').get('att-1') as any;
      expect(row1.storage_provider).toBe('LOCAL');
      const musicRow = verifyDb.prepare("SELECT value FROM system_state WHERE key = 'lottery_background_music'").get() as any;
      const musicMeta = JSON.parse(musicRow.value);
      expect(musicMeta.storageProvider).toBe('LOCAL');
      verifyDb.close();
    });

    it('5. B2: zero-byte and size-mismatched local buffers are rejected per-record without upload or DB update', async () => {
      const seedDb = new Database(dbPath);

      // Zero-byte local file (misleading host-like path content)
      const zeroFile = 'exp-1_att_zero.png';
      fs.writeFileSync(path.join(uploadDir, zeroFile), Buffer.alloc(0));
      seedDb.prepare(`
        INSERT INTO attachments (id, expense_id, file_name, original_name, mime_type, file_size, sha256_hash, storage_path, storage_provider, storage_key, uploaded_by, created_at)
        VALUES ('att-zero', 'exp-1', ?, 'zero.png', 'image/png', 0, 'x', ?, 'LOCAL', ?, 'admin', CURRENT_TIMESTAMP)
      `).run(zeroFile, path.join(uploadDir, zeroFile), `receipts/${zeroFile}`);

      // Non-zero buffer whose size differs from DB file_size (misleading metadata)
      const mismatchContent = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22]);
      const mismatchFile = 'exp-1_att_mismatch.jpg';
      fs.writeFileSync(path.join(uploadDir, mismatchFile), mismatchContent);
      seedDb.prepare(`
        INSERT INTO attachments (id, expense_id, file_name, original_name, mime_type, file_size, sha256_hash, storage_path, storage_provider, storage_key, uploaded_by, created_at)
        VALUES ('att-mismatch', 'exp-1', ?, 'mismatch.jpg', 'image/jpeg', 999999, 'x', ?, 'LOCAL', ?, 'admin', CURRENT_TIMESTAMP)
      `).run(mismatchFile, path.join(uploadDir, mismatchFile), `receipts/${mismatchFile}`);
      seedDb.close();

      const summary = await runMediaMigration({
        dryRun: false,
        dbPath,
        storageDir: uploadDir,
        storageOverride: mockR2Storage,
      });

      // Rejected records: never uploaded, never updated
      expect(mockR2Store.has(`receipts/${zeroFile}`)).toBe(false);
      expect(mockR2Store.has(`receipts/${mismatchFile}`)).toBe(false);
      expect(summary.attachmentsFailed).toBe(2);
      expect(summary.errors.some((e) => e.includes('att-zero') && e.includes('zero-byte/size guard'))).toBe(true);
      expect(summary.errors.some((e) => e.includes('att-mismatch') && e.includes('zero-byte/size guard'))).toBe(true);

      // Valid records still migrate
      expect(summary.attachmentsMigrated).toBe(2);
      expect(mockR2Store.has('receipts/exp-1_att1.png')).toBe(true);

      // Rejected rows keep LOCAL provenance
      const verifyDb = new Database(dbPath);
      const zeroRow = verifyDb.prepare('SELECT storage_provider FROM attachments WHERE id = ?').get('att-zero') as any;
      expect(zeroRow.storage_provider).toBe('LOCAL');
      const mismatchRow = verifyDb.prepare('SELECT storage_provider FROM attachments WHERE id = ?').get('att-mismatch') as any;
      expect(mismatchRow.storage_provider).toBe('LOCAL');
      verifyDb.close();
    });

    it('6. B4: inventories metadata-less music via SHARED_MEDIA_PATH and migrates with synthesized metadata (idempotent rerun)', async () => {
      // Remove metadata row: music exists only on disk in SHARED_MEDIA_PATH
      const rmDb = new Database(dbPath);
      rmDb.prepare("DELETE FROM system_state WHERE key = 'lottery_background_music'").run();
      rmDb.close();

      const sharedDir = path.join(tempDir, 'shared_media');
      fs.mkdirSync(sharedDir, { recursive: true });
      const sharedMusic = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00Shared Persistent BGM');
      fs.writeFileSync(path.join(sharedDir, 'lottery_bgm.mp3'), sharedMusic);
      process.env.SHARED_MEDIA_PATH = sharedDir;

      try {
        // Dry-run: inventory only
        const dry = await runMediaMigration({ dryRun: true, dbPath, storageDir: uploadDir, storageOverride: mockR2Storage });
        expect(dry.musicScanned).toBe(1);
        expect(dry.musicMigrated).toBe(1);
        expect(dry.errors).toHaveLength(0);
        expect(mockR2Store.size).toBe(0);
        let checkDb = new Database(dbPath);
        expect(checkDb.prepare("SELECT value FROM system_state WHERE key = 'lottery_background_music'").get()).toBeUndefined();
        checkDb.close();

        // Execute: upload + synthesized metadata row
        const exec = await runMediaMigration({ dryRun: false, dbPath, storageDir: uploadDir, storageOverride: mockR2Storage });
        expect(exec.musicScanned).toBe(1);
        expect(exec.musicMigrated).toBe(1);
        expect(exec.musicFailed).toBe(0);
        expect(exec.errors).toHaveLength(0);

        const musicKeys = [...mockR2Store.keys()].filter((k) => k.startsWith('lottery/background/lottery_bgm_'));
        expect(musicKeys).toHaveLength(1);
        const storedSha = (mockR2Store.get(musicKeys[0]) as any).metadata.sha256;
        expect(storedSha).toBe(crypto.createHash('sha256').update(sharedMusic).digest('hex'));

        checkDb = new Database(dbPath);
        const row = checkDb.prepare("SELECT value FROM system_state WHERE key = 'lottery_background_music'").get() as any;
        expect(row).toBeDefined();
        const meta = JSON.parse(row.value);
        expect(meta.storageProvider).toBe('R2');
        expect(meta.storageKey).toBe(musicKeys[0]);
        expect(meta.sha256).toBe(storedSha);
        checkDb.close();

        // Idempotent rerun: verified object is skipped, not duplicated
        const rerun = await runMediaMigration({ dryRun: false, dbPath, storageDir: uploadDir, storageOverride: mockR2Storage });
        expect(rerun.musicMigrated).toBe(0);
        expect(rerun.musicSkipped).toBe(1);
        expect(rerun.musicFailed).toBe(0);
        expect(rerun.errors).toHaveLength(0);
      } finally {
        delete process.env.SHARED_MEDIA_PATH;
      }
    });
  });
});
