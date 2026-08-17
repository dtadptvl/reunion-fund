import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runMigrations } from '../../server/src/db/connection.js';
import {
  AttachmentService,
  validateAttachmentMagicBytes,
} from '../../server/src/services/attachment.service.js';

describe('Phase 4: Adversarial Receipt Upload Hardening & Magic-Byte Validation', () => {
  let db: Database.Database;
  let tempStorageDir: string;
  let attachmentService: AttachmentService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf_test_uploads_'));
    attachmentService = new AttachmentService(db, tempStorageDir);

    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
      VALUES 
        ('tx-1', 991, 'MB', '2026-08-17 14:00:00', '0123', 'out', 120000, 'CHI 1', '{}', 'WEBHOOK'),
        ('tx-safe-1', 992, 'MB', '2026-08-17 14:00:00', '0123', 'out', 120000, 'CHI 2', '{}', 'WEBHOOK')
    `).run();

    db.prepare(`
      INSERT INTO expenses (id, bank_transaction_id, title, category, amount, classification_source)
      VALUES 
        ('exp-1', 'tx-1', 'Chi 1', 'FOOD', 120000, 'MOCK_AI'),
        ('exp-safe-1', 'tx-safe-1', 'Chi 2', 'FOOD', 120000, 'MOCK_AI')
    `).run();
  });

  afterEach(() => {
    if (db && db.open) db.close();
    if (fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
  });

  // 1. Valid Supported Formats
  it('accepts authentic JPEG magic bytes', () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const res = validateAttachmentMagicBytes(jpegBuffer);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/jpeg');
  });

  it('accepts authentic PNG magic bytes', () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const res = validateAttachmentMagicBytes(pngBuffer);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/png');
  });

  it('accepts authentic WebP magic bytes', () => {
    const webpBuffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    const res = validateAttachmentMagicBytes(webpBuffer);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('image/webp');
  });

  it('accepts authentic PDF magic bytes', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n%...\n');
    const res = validateAttachmentMagicBytes(pdfBuffer);
    expect(res.isValid).toBe(true);
    expect(res.mimeType).toBe('application/pdf');
  });

  // 2. Adversarial Rejection Tests
  it('rejects renamed Windows PE / DOS Executable disguised as JPG', () => {
    // Starts with MZ header
    const fakeJpg = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const res = validateAttachmentMagicBytes(fakeJpg);
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Định dạng tập tin bị cấm');

    expect(() => {
      attachmentService.saveAttachment('exp-1', 'receipt.jpg', fakeJpg);
    }).toThrow();
  });

  it('rejects renamed ELF Linux Binary disguised as PNG', () => {
    // Starts with 0x7F 'E' 'L' 'F'
    const fakePng = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const res = validateAttachmentMagicBytes(fakePng);
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Định dạng tập tin bị cấm');
  });

  it('rejects plain text script / HTML with fake MIME type', () => {
    const fakeHtml = Buffer.from('<script>alert("xss")</script>');
    const res = validateAttachmentMagicBytes(fakeHtml);
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Định dạng chứng từ không hợp lệ');
  });

  it('rejects empty or tiny buffers', () => {
    const emptyBuf = Buffer.alloc(0);
    const res = validateAttachmentMagicBytes(emptyBuf);
    expect(res.isValid).toBe(false);
  });

  it('rejects oversized uploads exceeding 10MB', () => {
    const oversizedPdf = Buffer.alloc(10 * 1024 * 1024 + 1024);
    oversizedPdf.write('%PDF-1.4', 0);

    expect(() => {
      attachmentService.saveAttachment('exp-1', 'large.pdf', oversizedPdf);
    }).toThrow('Kích thước chứng từ vượt quá giới hạn 10MB');
  });

  // 3. Path Traversal & Safe Storage
  it('neutralizes path traversal attempts in filename', () => {
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const maliciousName = '../../../../etc/passwd';

    const attachment = attachmentService.saveAttachment('exp-safe-1', maliciousName, validPng);
    expect(attachment.file_name).not.toContain('..');

    const safePath = attachmentService.getSafeFilePath(attachment);
    expect(safePath).toBeDefined();
    expect(safePath).toContain(tempStorageDir);
    expect(fs.existsSync(safePath!)).toBe(true);
  });
});
