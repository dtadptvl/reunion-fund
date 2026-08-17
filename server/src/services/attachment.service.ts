import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { AttachmentRow } from '../db/schema.js';

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
  constructor(
    private db: Database.Database,
    private uploadDir: string
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  saveAttachment(
    expenseId: string,
    originalFilename: string,
    buffer: Buffer
  ): AttachmentRow {
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
    const storagePath = path.join(this.uploadDir, storedFilename);
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

    fs.writeFileSync(storagePath, buffer);

    const attachment: AttachmentRow = {
      id,
      expense_id: expenseId,
      file_name: storedFilename,
      original_name: originalFilename,
      mime_type: validation.mimeType,
      file_size: buffer.length,
      sha256_hash: sha256Hash,
      storage_path: storagePath,
      uploaded_by: 'system',
      created_at: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO attachments (
        id, expense_id, file_name, original_name, mime_type, file_size, sha256_hash, storage_path, uploaded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      attachment.id,
      attachment.expense_id,
      attachment.file_name,
      attachment.original_name,
      attachment.mime_type,
      attachment.file_size,
      attachment.sha256_hash,
      attachment.storage_path,
      attachment.uploaded_by
    );

    return attachment;
  }

  getAttachmentsForExpense(expenseId: string): AttachmentRow[] {
    return this.db
      .prepare('SELECT * FROM attachments WHERE expense_id = ? ORDER BY created_at ASC')
      .all(expenseId) as AttachmentRow[];
  }
}
