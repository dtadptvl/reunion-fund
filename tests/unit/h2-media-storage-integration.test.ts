import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildApp } from '../../server/src/app.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { AttachmentService } from '../../server/src/services/attachment.service.js';
import { LotteryService } from '../../server/src/services/lottery.service.js';
import { LocalStorageProvider, MirroredStorageProvider, ObjectStorage } from '../../server/src/storage/index.js';
import { MockBankSyncProvider } from '../../server/src/providers/bank-sync/mock-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';

describe('H2 Media Storage & Service Integration Tests', () => {
  let db: Database.Database;
  let tempDir: string;
  let localStorage: LocalStorageProvider;
  let attachmentService: AttachmentService;
  let lotteryService: LotteryService;
  let authService: AuthService;
  let app: any;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf_h2_test_'));
    db = new Database(':memory:');

    // Run migrations
    const migrationsDir = path.resolve(__dirname, '../../server/src/db/migrations');
    const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf-8');
      db.exec(sql);
    }

    localStorage = new LocalStorageProvider(tempDir, '/media');
    authService = new AuthService(db);
    attachmentService = new AttachmentService(db, localStorage, tempDir);
    lotteryService = new LotteryService(db, tempDir, localStorage);

    // Insert default bank transaction and expense for receipt tests
    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source, is_excluded)
      VALUES ('tx-1', 12345, 'MBBank', '2026-08-19 12:00:00', '0123456789', 'out', 500000, 'Chi phi lien hoan', '{}', 'WEBHOOK', 0)
    `).run();

    db.prepare(`
      INSERT INTO expenses (id, bank_transaction_id, category, amount, classification_source, is_settlement_transfer, created_at, updated_at)
      VALUES ('exp-1', 'tx-1', 'FOOD', 500000, 'MANUAL_OVERRIDE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();

    app = buildApp({
      db,
      authService,
      attachmentService,
      lotteryService,
      storage: localStorage,
      bankSyncProvider: new MockBankSyncProvider(),
      aiProvider: new MockAIProvider(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (db && db.open) db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Receipt Uploads & Compensation', () => {
    it('writes storage object before creating DB row on successful upload', async () => {
      const validPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);

      const attachment = await attachmentService.saveAttachment('exp-1', 'receipt.png', validPng, 'admin');
      expect(attachment).toBeDefined();
      expect(attachment.id).toBeDefined();
      expect(attachment.storage_key).toBe(`receipts/${attachment.file_name}`);
      expect(attachment.storage_provider).toBe('LOCAL');

      // Verify object exists in storage
      const stored = await localStorage.get(attachment.storage_key!);
      expect(stored).not.toBeNull();
      expect(stored?.size).toBe(validPng.length);

      // Verify DB row exists
      const dbRow = attachmentService.getAttachmentById(attachment.id);
      expect(dbRow).toBeDefined();
      expect(dbRow?.file_name).toBe(attachment.file_name);
    });

    it('creates no DB row if storage put fails', async () => {
      const failingStorage: ObjectStorage = {
        providerName: 'FAILING',
        put: async () => {
          throw new Error('Disk full / R2 network error');
        },
        get: async () => null,
        getStream: async () => null,
        head: async () => null,
        delete: async () => {},
        getPublicUrl: (k) => `/media/${k}`,
      };

      const failingService = new AttachmentService(db, failingStorage, tempDir);
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      await expect(
        failingService.saveAttachment('exp-1', 'receipt.png', validPng, 'admin')
      ).rejects.toThrow('Disk full / R2 network error');

      const count = (db.prepare('SELECT COUNT(*) as count FROM attachments').get() as any).count;
      expect(count).toBe(0);
    });

    it('compensates and deletes storage object if DB insert fails', async () => {
      const deletedKeys: string[] = [];
      const spyStorage: ObjectStorage = {
        providerName: 'SPY',
        put: async (key, data) => {
          await localStorage.put(key, data);
        },
        get: (k) => localStorage.get(k),
        getStream: (k) => localStorage.getStream(k),
        head: (k) => localStorage.head(k),
        delete: async (key) => {
          deletedKeys.push(key);
          await localStorage.delete(key);
        },
        getPublicUrl: (k) => `/media/${k}`,
      };

      const service = new AttachmentService(db, spyStorage, tempDir);
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      // Cause DB error by referencing non-existent foreign key if enforced or inserting invalid SQL
      // In SQLite without foreign keys enforced by default, let's close db or simulate error
      const originalPrepare = db.prepare.bind(db);
      db.prepare = (sql: string) => {
        if (sql.includes('INSERT INTO attachments')) {
          throw new Error('SQLite DB Lock Failure');
        }
        return originalPrepare(sql);
      };

      await expect(
        service.saveAttachment('exp-1', 'receipt.png', validPng, 'admin')
      ).rejects.toThrow('SQLite DB Lock Failure');

      // Verify compensation deleted the uploaded storage object
      expect(deletedKeys.length).toBeGreaterThan(0);
      const stored = await localStorage.get(deletedKeys[0]);
      expect(stored).toBeNull();
    });

    it('GET /api/v1/public/attachments/:id redirects to /media/* when backed by R2', async () => {
      // Insert an R2-backed attachment
      const r2Key = 'receipts/exp_r2_test.jpg';
      db.prepare(`
        INSERT INTO attachments (
          id, expense_id, file_name, original_name, mime_type, file_size, sha256_hash, storage_path, storage_provider, storage_key, uploaded_by, created_at
        ) VALUES ('att-r2-1', 'exp-1', 'exp_r2_test.jpg', 'r2_bill.jpg', 'image/jpeg', 1234, 'sha256fake', 'path', 'R2', ?, 'admin', CURRENT_TIMESTAMP)
      `).run(r2Key);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/attachments/att-r2-1',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`/media/${r2Key}`);
    });

    it('GET /api/v1/public/attachments/:id streams safely in local mode', async () => {
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const att = await attachmentService.saveAttachment('exp-1', 'local_receipt.png', validPng, 'admin');

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/attachments/${att.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.rawPayload.equals(validPng)).toBe(true);
    });

    it('deleteAttachment removes object from storage and DB record', async () => {
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const att = await attachmentService.saveAttachment('exp-1', 'delete_me.png', validPng, 'admin');

      expect(await localStorage.get(att.storage_key!)).not.toBeNull();

      const deleted = await attachmentService.deleteAttachment(att.id);
      expect(deleted).toBe(true);

      expect(await localStorage.get(att.storage_key!)).toBeNull();
      expect(attachmentService.getAttachmentById(att.id)).toBeUndefined();
    });
  });

  describe('Background Music & Safe Replacement', () => {
    it('uploads background music and persists metadata across lottery reset', async () => {
      const mp3Header = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00Test MP3 Payload Audio');
      const meta = await lotteryService.saveBackgroundMusic(mp3Header, 'anthem.mp3', 'admin');

      expect(meta.storageKey).toMatch(/^lottery\/background\/lottery_bgm_/);
      expect(meta.publicUrl).toBe(`/media/${meta.storageKey}`);

      // Verify stored object exists
      const stored = await localStorage.get(meta.storageKey!);
      expect(stored).not.toBeNull();

      // Reset lottery state
      lotteryService.resetLotteryState('admin');

      // Music metadata must remain preserved!
      const afterResetMeta = lotteryService.getBackgroundMusicMetadata();
      expect(afterResetMeta).not.toBeNull();
      expect(afterResetMeta?.storageKey).toBe(meta.storageKey);
    });

    it('safe replacement: replacing music creates new key and deletes old key after metadata switch', async () => {
      const music1 = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00Track 1 Audio');
      const meta1 = await lotteryService.saveBackgroundMusic(music1, 'track1.mp3', 'admin');

      const music2 = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00Track 2 Audio');
      const meta2 = await lotteryService.saveBackgroundMusic(music2, 'track2.mp3', 'admin');

      expect(meta2.storageKey).not.toBe(meta1.storageKey);

      // Old music object is removed
      expect(await localStorage.get(meta1.storageKey!)).toBeNull();
      // New music object is present
      expect(await localStorage.get(meta2.storageKey!)).not.toBeNull();
    });

    it('public background-music route redirects to /media/* when in R2 mode', async () => {
      // Set R2 mode metadata
      const music = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00R2 Track');
      const meta = await lotteryService.saveBackgroundMusic(music, 'r2_track.mp3', 'admin');

      // Simulate R2 metadata
      db.prepare(`
        UPDATE system_state
        SET value = json_set(value, '$.storageProvider', 'R2')
        WHERE key = 'lottery_background_music'
      `).run();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/lottery/background-music',
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`/media/${meta.storageKey}`);
    });
  });
});
