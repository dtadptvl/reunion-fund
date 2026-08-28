import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { config } from '../config/env.js';
import { StorageFactory, ObjectStorage } from '../storage/index.js';
import { AttachmentRow } from '../db/schema.js';
import { BackgroundMusicMetadata, validateAudioMagicBytes } from '../services/lottery.service.js';

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
  musicFailed: number;
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
    musicFailed: 0,
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

    // B2 guard: reject zero-byte local buffers or buffers whose size differs from the
    // DB file_size BEFORE any upload/update (never trust misleading host-like paths).
    if (localBuffer.length === 0 || localBuffer.length !== att.file_size) {
      const err = `Attachment ${att.id} (${att.original_name}): REJECTED local buffer of ${localBuffer.length} bytes vs DB file_size ${att.file_size} (zero-byte/size guard). No upload, no DB update.`;
      console.warn(`[MediaMigration] ⚠️  ${err}`);
      summary.errors.push(err);
      summary.attachmentsFailed++;
      continue;
    }

    const localSha256 = crypto.createHash('sha256').update(localBuffer).digest('hex');

    // Check if already migrated to R2 and verified (size AND SHA-256)
    if (att.storage_provider === 'R2' || att.storage_provider === 'R2_MIRRORED') {
      try {
        const header = await storage.head(targetKey);
        if (header && header.size === localBuffer.length && header.sha256 === localSha256) {
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

      // B1: verify uploaded object size AND SHA-256 (from storage head metadata)
      // BEFORE any DB update. Mismatch or missing SHA-256 -> record failed, no DB update.
      const verifiedHeader = await storage.head(targetKey);
      if (!verifiedHeader || verifiedHeader.size !== localBuffer.length) {
        throw new Error(`Verification failed: uploaded object size mismatch for ${targetKey} (expected ${localBuffer.length}, got ${verifiedHeader ? verifiedHeader.size : 'null'})`);
      }
      if (!verifiedHeader.sha256 || verifiedHeader.sha256 !== localSha256) {
        throw new Error(`Verification failed: uploaded object SHA-256 mismatch for ${targetKey} (expected ${localSha256.substring(0, 8)}..., got ${verifiedHeader.sha256 ? verifiedHeader.sha256.substring(0, 8) + '...' : 'missing'})`);
      }

      // Update DB record only after successful size + SHA-256 verification
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
  // B4: candidate paths aligned with LotteryService.getBackgroundMusicFilePath
  // resolution order: SHARED_MEDIA_PATH first, then container shared path, then
  // local audio dir, then metadata-backed paths. Music present on disk without a
  // system_state metadata row is inventoried and migrated with synthesized metadata.
  const musicRow = db.prepare("SELECT value FROM system_state WHERE key = 'lottery_background_music'").get() as { value: string } | undefined;

  let musicMeta: BackgroundMusicMetadata | null = null;
  if (musicRow && musicRow.value) {
    try {
      musicMeta = JSON.parse(musicRow.value) as BackgroundMusicMetadata;
    } catch {
      musicMeta = null;
    }
  }

  const sharedMediaPath = process.env.SHARED_MEDIA_PATH;
  const musicCandidates = [
    sharedMediaPath ? path.join(sharedMediaPath, 'lottery_bgm.mp3') : null,
    '/data/reunion-fund/shared/media/lottery_bgm.mp3',
    path.join(storageDir, 'audio', 'lottery_bgm.mp3'),
    path.join(storageDir, 'audio', 'lottery.mp3'),
    musicMeta?.filename ? path.join(storageDir, 'audio', musicMeta.filename) : null,
    musicMeta?.filename ? path.join(storageDir, musicMeta.filename) : null,
    musicMeta?.storageKey ? path.join(storageDir, musicMeta.storageKey) : null,
  ].filter(Boolean) as string[];

  // Deduplicate while preserving resolution order
  const uniqueMusicCandidates = [...new Set(musicCandidates.map((p) => path.resolve(p)))];

  let localMusicPath: string | null = null;
  for (const p of uniqueMusicCandidates) {
    if (fs.existsSync(p)) {
      localMusicPath = p;
      break;
    }
  }

  if (musicMeta || localMusicPath) {
    summary.musicScanned = 1;
    try {
      if (!localMusicPath) {
        const err = 'Background music: system_state metadata exists but no local music file was found in any candidate path.';
        console.warn(`[MediaMigration] ⚠️  ${err}`);
        summary.errors.push(err);
        summary.musicFailed++;
      } else {
        const musicBuffer = fs.readFileSync(localMusicPath);

        // B2 guard (music): reject zero-byte or metadata size-mismatched local buffers
        if (musicBuffer.length === 0 || (musicMeta?.sizeBytes !== undefined && musicBuffer.length !== musicMeta.sizeBytes)) {
          const err = `Background music (${localMusicPath}): REJECTED zero-byte/size-mismatched local buffer (got ${musicBuffer.length} bytes${musicMeta?.sizeBytes !== undefined ? `, metadata expects ${musicMeta.sizeBytes}` : ''}). No upload, no metadata update.`;
          console.warn(`[MediaMigration] ⚠️  ${err}`);
          summary.errors.push(err);
          summary.musicFailed++;
        } else {
          const audioValidation = validateAudioMagicBytes(musicBuffer, localMusicPath);
          if (!audioValidation.isValid) {
            const err = `Background music (${localMusicPath}): REJECTED invalid audio format (${audioValidation.error || 'unknown'}). No upload, no metadata update.`;
            console.warn(`[MediaMigration] ⚠️  ${err}`);
            summary.errors.push(err);
            summary.musicFailed++;
          } else {
            const musicSha256 = crypto.createHash('sha256').update(musicBuffer).digest('hex');

            // B4: synthesize immutable/versioned key for metadata-less music
            const synthesizedExt = path.extname(localMusicPath).toLowerCase() || '.mp3';
            const synthesizedFilename = `lottery_bgm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${synthesizedExt}`;
            const targetMusicKey =
              musicMeta?.storageKey ||
              (musicMeta?.filename ? `lottery/background/${musicMeta.filename}` : `lottery/background/${synthesizedFilename}`);

            let isAlreadyMigrated = false;
            // Check if already migrated to R2 and verified (size AND SHA-256)
            if (musicMeta && (musicMeta.storageProvider === 'R2' || musicMeta.storageProvider === 'R2_MIRRORED')) {
              try {
                const header = await storage.head(targetMusicKey);
                if (header && header.size === musicBuffer.length && header.sha256 === musicSha256) {
                  summary.musicSkipped++;
                  isAlreadyMigrated = true;
                }
              } catch {
                // re-upload if check fails
              }
            }

            if (!isAlreadyMigrated) {
              summary.totalBytes += musicBuffer.length;

              // Authoritative metadata; synthesized for disk-only music with no system_state row
              const baseMeta: BackgroundMusicMetadata = musicMeta || {
                filename: synthesizedFilename,
                originalName: path.basename(localMusicPath),
                mimeType: audioValidation.mimeType || 'audio/mpeg',
                sizeBytes: musicBuffer.length,
                uploadedAt: new Date().toISOString(),
                actor: 'SYSTEM_MIGRATION',
                storageProvider: 'LOCAL',
              };

              if (options.dryRun) {
                console.log(`[DRY-RUN] Would upload background music -> ${targetMusicKey} (${musicBuffer.length} bytes, SHA256: ${musicSha256.substring(0, 8)}...)${musicMeta ? '' : ' [metadata-less source: metadata will be synthesized]'}`);
                summary.musicMigrated++;
              } else {
                await storage.put(targetMusicKey, musicBuffer, {
                  contentType: baseMeta.mimeType || 'audio/mpeg',
                  contentDisposition: `inline; filename="${encodeURIComponent(baseMeta.originalName)}"`,
                  sha256: musicSha256,
                });

                // B1: verify size AND SHA-256 BEFORE any DB/metadata update
                const verifiedMusic = await storage.head(targetMusicKey);
                if (!verifiedMusic || verifiedMusic.size !== musicBuffer.length) {
                  throw new Error(`Verification failed: background music size mismatch for ${targetMusicKey}`);
                }
                if (!verifiedMusic.sha256 || verifiedMusic.sha256 !== musicSha256) {
                  throw new Error(`Verification failed: background music SHA-256 mismatch for ${targetMusicKey}`);
                }

                const updatedMeta: BackgroundMusicMetadata = {
                  ...baseMeta,
                  storageProvider: 'R2',
                  storageKey: targetMusicKey,
                  sha256: musicSha256,
                  publicUrl: storage.getPublicUrl(targetMusicKey),
                };

                // Upsert covers both existing metadata rows and metadata-less synthesis
                db.prepare(`
                  INSERT INTO system_state (key, value)
                  VALUES ('lottery_background_music', ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value
                `).run(JSON.stringify(updatedMeta));

                console.log(`[EXECUTE] Migrated background music -> ${targetMusicKey} (Verified: ${musicBuffer.length} bytes, SHA256: ${musicSha256.substring(0, 8)}...)${musicMeta ? '' : ' [metadata synthesized]'}`);
                summary.musicMigrated++;
              }
            }
          }
        }
      }
    } catch (err: any) {
      const errMsg = `Failed to migrate background music: ${err?.message || err}`;
      console.error(`[MediaMigration] ❌ ${errMsg}`);
      summary.errors.push(errMsg);
      summary.musicFailed++;
    }
  }

  db.close();

  console.log(`==================================================`);
  console.log(`[MediaMigration] Migration Completed`);
  console.log(`Attachments: ${summary.attachmentsMigrated} migrated, ${summary.attachmentsSkipped} skipped, ${summary.attachmentsFailed} failed (Total: ${summary.attachmentsScanned})`);
  console.log(`Background Music: ${summary.musicMigrated} migrated, ${summary.musicSkipped} skipped, ${summary.musicFailed} failed (Total: ${summary.musicScanned})`);
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
