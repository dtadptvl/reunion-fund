import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { config } from '../config/env.js';
import { StorageFactory, ObjectStorage } from '../storage/index.js';
import { AttachmentRow } from '../db/schema.js';
import { BackgroundMusicMetadata } from '../services/lottery.service.js';

export interface MigrationOptions {
  dryRun: boolean;
  dbPath?: string;
  storageDir?: string;
  storageOverride?: ObjectStorage;
}

export interface MigrationSummary {
  dryRun: boolean;
  attachmentsScanned: number;
  attachmentsMigrated: number;
  attachmentsSkipped: number;
  attachmentsFailed: number;
  musicScanned: number;
  musicMigrated: number;
  musicSkipped: number;
  totalBytes: number;
  errors: string[];
}

export async function runMediaMigration(options: MigrationOptions): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    dryRun: options.dryRun,
    attachmentsScanned: 0,
    attachmentsMigrated: 0,
    attachmentsSkipped: 0,
    attachmentsFailed: 0,
    musicScanned: 0,
    musicMigrated: 0,
    musicSkipped: 0,
    totalBytes: 0,
    errors: [],
  };

  const dbPath = options.dbPath || config.DATABASE_PATH;
  const storageDir = options.storageDir || config.STORAGE_PATH;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Tập tin cơ sở dữ liệu không tồn tại: ${dbPath}`);
  }

  const db = new Database(dbPath);

  // Initialize R2 storage provider
  const storage =
    options.storageOverride ||
    StorageFactory.createStorage({
      STORAGE_PROVIDER: 'R2',
      STORAGE_PATH: storageDir,
      R2_ACCOUNT_ID: config.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: config.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: config.R2_SECRET_ACCESS_KEY,
      R2_BUCKET: config.R2_BUCKET,
      R2_PUBLIC_BASE_URL: config.R2_PUBLIC_BASE_URL,
    });

  console.log(`[MediaMigration] Starting migration (Mode: ${options.dryRun ? 'DRY-RUN (Inventory only)' : 'EXECUTE (Live upload)'})`);
  console.log(`[MediaMigration] Database: ${dbPath}`);
  console.log(`[MediaMigration] Local Storage Dir: ${storageDir}`);

  // 1. Migrate Attachments
  const attachments = db.prepare('SELECT * FROM attachments').all() as AttachmentRow[];
  summary.attachmentsScanned = attachments.length;
  console.log(`[MediaMigration] Found ${attachments.length} attachment records in database.`);

  for (const att of attachments) {
    const targetKey = att.storage_key || `receipts/${att.file_name}`;

    // Determine local file path
    const candidatePaths = [
      att.storage_path,
      path.join(storageDir, att.file_name),
      path.join(storageDir, 'receipts', att.file_name),
      path.join(storageDir, path.basename(targetKey)),
    ].filter(Boolean) as string[];

    let localPath: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        localPath = p;
        break;
      }
    }

    if (!localPath) {
      const err = `Attachment ${att.id} (${att.original_name}): Local file not found on disk.`;
      console.warn(`[MediaMigration] ⚠️  ${err}`);
      summary.errors.push(err);
      summary.attachmentsFailed++;
      continue;
    }

    const localBuffer = fs.readFileSync(localPath);
    const localSha256 = crypto.createHash('sha256').update(localBuffer).digest('hex');

    // Check if already migrated to R2 and verified
    if (att.storage_provider === 'R2' || att.storage_provider === 'R2_MIRRORED') {
      try {
        const header = await storage.head(targetKey);
        if (header && header.size === localBuffer.length) {
          summary.attachmentsSkipped++;
          continue;
        }
      } catch {
        // re-upload if check fails
      }
    }

    summary.totalBytes += localBuffer.length;

    if (options.dryRun) {
      console.log(`[DRY-RUN] Would upload attachment ${att.id} -> ${targetKey} (${localBuffer.length} bytes, SHA256: ${localSha256.substring(0, 8)}...)`);
      summary.attachmentsMigrated++;
      continue;
    }

    // Live upload
    try {
      await storage.put(targetKey, localBuffer, {
        contentType: att.mime_type,
        contentDisposition: `inline; filename="${encodeURIComponent(att.original_name)}"`,
        sha256: localSha256,
      });

      // Verify uploaded object
      const verifiedHeader = await storage.head(targetKey);
      if (!verifiedHeader || verifiedHeader.size !== localBuffer.length) {
        throw new Error(`Verification failed: Uploaded object size mismatch for ${targetKey}`);
      }

      // Update DB record
      db.prepare(`
        UPDATE attachments
        SET storage_provider = 'R2',
            storage_key = ?,
            sha256_hash = ?
        WHERE id = ?
      `).run(targetKey, localSha256, att.id);

      console.log(`[EXECUTE] Migrated attachment ${att.id} -> ${targetKey} (Verified: ${localBuffer.length} bytes, SHA256: ${localSha256.substring(0, 8)}...)`);
      summary.attachmentsMigrated++;
    } catch (err: any) {
      const errMsg = `Failed to migrate attachment ${att.id}: ${err?.message || err}`;
      console.error(`[MediaMigration] ❌ ${errMsg}`);
      summary.errors.push(errMsg);
      summary.attachmentsFailed++;
    }
  }

  // 2. Migrate Lottery Background Music
  const musicRow = db.prepare("SELECT value FROM system_state WHERE key = 'lottery_background_music'").get() as { value: string } | undefined;
  if (musicRow && musicRow.value) {
    summary.musicScanned = 1;
    try {
      const musicMeta = JSON.parse(musicRow.value) as BackgroundMusicMetadata;
      const targetMusicKey = musicMeta.storageKey || `lottery/background/${musicMeta.filename}`;

      const musicCandidates = [
        path.join(storageDir, 'audio', musicMeta.filename),
        path.join(storageDir, musicMeta.filename),
        path.join(storageDir, 'audio', 'lottery_bgm.mp3'),
        path.join(storageDir, 'audio', 'lottery.mp3'),
      ];

      let localMusicPath: string | null = null;
      for (const p of musicCandidates) {
        if (fs.existsSync(p)) {
          localMusicPath = p;
          break;
        }
      }

      if (localMusicPath) {
        const musicBuffer = fs.readFileSync(localMusicPath);
        const musicSha256 = crypto.createHash('sha256').update(musicBuffer).digest('hex');

        let isAlreadyMigrated = false;
        // Check if already migrated to R2 and verified
        if (musicMeta.storageProvider === 'R2' || musicMeta.storageProvider === 'R2_MIRRORED') {
          try {
            const header = await storage.head(targetMusicKey);
            if (header && header.size === musicBuffer.length) {
              summary.musicSkipped++;
              isAlreadyMigrated = true;
            }
          } catch {
            // re-upload if check fails
          }
        }

        if (!isAlreadyMigrated) {
          summary.totalBytes += musicBuffer.length;

          if (options.dryRun) {
            console.log(`[DRY-RUN] Would upload background music -> ${targetMusicKey} (${musicBuffer.length} bytes, SHA256: ${musicSha256.substring(0, 8)}...)`);
            summary.musicMigrated++;
          } else {
            await storage.put(targetMusicKey, musicBuffer, {
              contentType: musicMeta.mimeType || 'audio/mpeg',
              contentDisposition: `inline; filename="${encodeURIComponent(musicMeta.originalName)}"`,
              sha256: musicSha256,
            });

            const verifiedMusic = await storage.head(targetMusicKey);
            if (!verifiedMusic || verifiedMusic.size !== musicBuffer.length) {
              throw new Error(`Verification failed for background music ${targetMusicKey}`);
            }

            const updatedMeta: BackgroundMusicMetadata = {
              ...musicMeta,
              storageProvider: 'R2',
              storageKey: targetMusicKey,
              sha256: musicSha256,
              publicUrl: storage.getPublicUrl(targetMusicKey),
            };

            db.prepare(`
              UPDATE system_state
              SET value = ?
              WHERE key = 'lottery_background_music'
            `).run(JSON.stringify(updatedMeta));

            console.log(`[EXECUTE] Migrated background music -> ${targetMusicKey} (Verified: ${musicBuffer.length} bytes)`);
            summary.musicMigrated++;
          }
        }
      }
    } catch (err: any) {
      const errMsg = `Failed to migrate background music: ${err?.message || err}`;
      console.error(`[MediaMigration] ❌ ${errMsg}`);
      summary.errors.push(errMsg);
    }
  }

  db.close();

  console.log(`==================================================`);
  console.log(`[MediaMigration] Migration Completed`);
  console.log(`Attachments: ${summary.attachmentsMigrated} migrated, ${summary.attachmentsSkipped} skipped, ${summary.attachmentsFailed} failed (Total: ${summary.attachmentsScanned})`);
  console.log(`Background Music: ${summary.musicMigrated} migrated (Total: ${summary.musicScanned})`);
  console.log(`Total Bytes Transferred: ${summary.totalBytes} bytes`);
  console.log(`==================================================`);

  return summary;
}

// CLI Execution entry point
if (process.argv[1] && process.argv[1].endsWith('migrate-media-to-r2.ts')) {
  const isExecute = process.argv.includes('--execute');
  const dryRun = !isExecute;

  runMediaMigration({ dryRun })
    .then((summary) => {
      if (summary.errors.length > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MediaMigration] Fatal error:', err);
      process.exit(1);
    });
}
