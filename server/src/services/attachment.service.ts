import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { AttachmentRow } from '../db/schema.js';
import { ObjectStorage, LocalStorageProvider } from '../storage/index.js';

export interface ValidatedFile {
  isValid: boolean;
  mimeType: string | null;
  error?: string;
}

/**
 * Validates file buffer by inspecting magic bytes (header signatures).
 * Allowed MIME types:
 * - image/jpeg (FF D8 FF)
 * - image/png (89 50 4E 47 0D 0A 1A 0A)
 * - image/webp (RIFF .... WEBP)
 * - application/pdf (%PDF-)
 */
export function validateAttachmentMagicBytes(buffer: Buffer): ValidatedFile {
  if (!buffer || buffer.length < 4) {
    return { isValid: false, mimeType: null, error: 'Tập tin rỗng hoặc kích thước không hợp lệ' };
  }

  // Check JPEG (FF D8 FF)
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { isValid: true, mimeType: 'image/jpeg' };
  }

  // Check PNG (89 50 4E 47 0D 0A 1A 0A)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { isValid: true, mimeType: 'image/png' };
  }

  // Check WebP (RIFF .... WEBP)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  ) {
    return { isValid: true, mimeType: 'image/webp' };
  }

  // Check PDF (%PDF-)
  if (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 // F
  ) {
    return { isValid: true, mimeType: 'application/pdf' };
  }

  // Reject executable or malicious signatures explicitly
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { isValid: false, mimeType: null, error: 'Định dạng tập tin bị cấm (DOS/Windows Executable)' };
  }
  if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return { isValid: false, mimeType: null, error: 'Định dạng tập tin bị cấm (ELF Binary)' };
  }

  return { isValid: false, mimeType: null, error: 'Định dạng chứng từ không hợp lệ. Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc PDF.' };
}

export class AttachmentService {
  private storage: ObjectStorage;
  private uploadDir: string;

  constructor(
    private db: Database.Database,
    storageOrUploadDir: ObjectStorage | string,
    uploadDirFallback?: string
  ) {
    if (typeof storageOrUploadDir === 'string') {
      this.uploadDir = storageOrUploadDir;
      this.storage = new LocalStorageProvider(storageOrUploadDir);
    } else {
      this.storage = storageOrUploadDir;
      this.uploadDir = uploadDirFallback || './data/uploads';
    }

    if (this.uploadDir && !fs.existsSync(this.uploadDir)) {
      try {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  getStorage(): ObjectStorage {
    return this.storage;
  }

  async saveAttachment(
    expenseId: string,
    originalFilename: string,
    buffer: Buffer,
    uploadedBy = 'system'
  ): Promise<AttachmentRow> {
    const validation = validateAttachmentMagicBytes(buffer);
    if (!validation.isValid || !validation.mimeType) {
      throw new Error(validation.error || 'Tập tin không hợp lệ');
    }

    // Check size limit: 10MB
    const MAX_SIZE = 10 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      throw new Error('Kích thước chứng từ vượt quá giới hạn 10MB');
    }

    const id = crypto.randomUUID();
    const ext = path.extname(originalFilename) || (validation.mimeType === 'application/pdf' ? '.pdf' : '.jpg');
    const storedFilename = `${expenseId}_${id}${ext}`;
    const storageKey = `receipts/${storedFilename}`;
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const storagePath = path.join(this.uploadDir, storedFilename);

    // 1. Write to storage abstraction first
    await this.storage.put(storageKey, buffer, {
      contentType: validation.mimeType,
      contentDisposition: `inline; filename="${encodeURIComponent(path.basename(originalFilename))}"`,
      sha256: sha256Hash,
    });

    const attachment: AttachmentRow = {
      id,
      expense_id: expenseId,
      file_name: storedFilename,
      original_name: originalFilename,
      mime_type: validation.mimeType,
      file_size: buffer.length,
      sha256_hash: sha256Hash,
      storage_path: storagePath,
      storage_provider: this.storage.providerName,
      storage_key: storageKey,
      uploaded_by: uploadedBy,
      created_at: new Date().toISOString(),
    };

    // 2. Commit metadata to database with compensation if DB write fails
    try {
      this.db.prepare(`
        INSERT INTO attachments (
          id, expense_id, file_name, original_name, mime_type, file_size, sha256_hash, storage_path, storage_provider, storage_key, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        attachment.id,
        attachment.expense_id,
        attachment.file_name,
        attachment.original_name,
        attachment.mime_type,
        attachment.file_size,
        attachment.sha256_hash,
        attachment.storage_path,
        attachment.storage_provider,
        attachment.storage_key,
        attachment.uploaded_by
      );
    } catch (dbErr) {
      // Compensation: remove written object from storage so no orphan remains
      try {
        await this.storage.delete(storageKey);
      } catch (storageDelErr) {
        console.warn('[AttachmentService] Failed to compensate storage object on DB error:', storageDelErr);
      }
      throw dbErr;
    }

    return attachment;
  }

  getAttachmentsForExpense(expenseId: string): AttachmentRow[] {
    return this.db
      .prepare('SELECT * FROM attachments WHERE expense_id = ? ORDER BY created_at ASC')
      .all(expenseId) as AttachmentRow[];
  }

  getAttachmentById(id: string): AttachmentRow | undefined {
    return this.db
      .prepare('SELECT * FROM attachments WHERE id = ?')
      .get(id) as AttachmentRow | undefined;
  }

  async deleteAttachment(id: string): Promise<boolean> {
    const attachment = this.getAttachmentById(id);
    if (!attachment) return false;

    const key = attachment.storage_key || `receipts/${attachment.file_name}`;

    // 1. Delete from storage abstraction
    await this.storage.delete(key);

    // 2. Delete legacy local file if present
    const safePath = this.getSafeFilePath(attachment);
    if (safePath && fs.existsSync(safePath)) {
      try {
        fs.unlinkSync(safePath);
      } catch (err) {
        console.warn('Failed to delete file from disk:', err);
      }
    }

    // 3. Delete metadata from DB
    this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    return true;
  }

  getSafeFilePath(attachment: AttachmentRow): string | null {
    const resolvedUploadDir = path.resolve(this.uploadDir);
    const candidates = [
      path.resolve(resolvedUploadDir, path.basename(attachment.file_name)),
      path.resolve(resolvedUploadDir, 'receipts', path.basename(attachment.file_name)),
      attachment.storage_key ? path.resolve(resolvedUploadDir, attachment.storage_key) : null,
    ].filter(Boolean) as string[];

    for (const c of candidates) {
      if (c.startsWith(resolvedUploadDir) && fs.existsSync(c)) {
        return c;
      }
    }

    const defaultPath = path.resolve(resolvedUploadDir, 'receipts', path.basename(attachment.file_name));
    if (defaultPath.startsWith(resolvedUploadDir)) {
      return defaultPath;
    }

    return null;
  }
}
