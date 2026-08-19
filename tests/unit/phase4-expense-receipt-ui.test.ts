import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import FormData from 'form-data';
import { buildApp } from '../../server/src/app.js';
import { runMigrations } from '../../server/src/db/connection.js';
import { MockBankSyncProvider } from '../../server/src/providers/bank-sync/mock-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { MemberService } from '../../server/src/services/member.service.js';

describe('Phase 4: Expense Receipt UI & Attachment Proof Tests', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;
  let tempStorageDir: string;
  let cookieHeader: string;
  const expenseId1 = 'exp-receipt-test-1';
  const expenseId2 = 'exp-receipt-test-2';

  beforeEach(async () => {
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf_receipt_test_'));
    db = new Database(':memory:');
    runMigrations(db);

    // Setup bank transactions and expenses
    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
      VALUES 
        ('btx-1', 9901, 'MB', '2026-08-17 14:00:00', '0123', 'out', 350000, 'DAT COC NHA HANG TIEC HOP LOP', '{}', 'WEBHOOK'),
        ('btx-2', 9902, 'MB', '2026-08-17 15:00:00', '0123', 'out', 120000, 'QR839281923', '{}', 'WEBHOOK'),
        ('btx-in-1', 9903, 'MB', '2026-08-17 12:00:00', '0123', 'in', 500000, 'DONG QUY LOP', '{}', 'WEBHOOK')
    `).run();

    db.prepare(`
      INSERT INTO contributions (id, bank_transaction_id, contributor_type, amount, match_method)
      VALUES ('c-1', 'btx-in-1', 'MEMBER', 500000, 'EXACT_PAYMENT_CODE')
    `).run();

    db.prepare(`
      INSERT INTO expenses (id, bank_transaction_id, title, vietnamese_title, category, amount, classification_source)
      VALUES 
        (?, 'btx-1', 'Đặt cọc nhà hàng', 'Đặt cọc nhà hàng', 'FOOD', 350000, 'DETERMINISTIC_RULE'),
        (?, 'btx-2', 'Nước uống họp lớp', 'Nước uống họp lớp', 'FOOD', 120000, 'MANUAL_OVERRIDE')
    `).run(expenseId1, expenseId2);

    // Create staff session
    const authService = new AuthService(db);
    new MemberService(db).seedCanonicalRoster();
    const hash = await authService.hashPassword('12a1@2016');
    await authService.seedInitialStaff('admin88', hash);

    app = buildApp({
      db,
      bankSyncProvider: new MockBankSyncProvider(),
      aiProvider: new MockAIProvider(),
    });
    await app.ready();

    // Authenticate
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'admin88', password: '12a1@2016' },
    });
    expect(loginRes.statusCode).toBe(200);
    cookieHeader = loginRes.headers['set-cookie'] as string;
  });

  afterEach(async () => {
    await app.close();
    if (db && db.open) db.close();
    if (fs.existsSync(tempStorageDir)) {
      try {
        fs.rmSync(tempStorageDir, { recursive: true, force: true });
      } catch (e) {
        // cleanup ignore
        void e;
      }
    }
  });

  // A. Treasurer can upload a valid image receipt
  it('A: allows treasurer to upload a valid image receipt (JPEG/PNG) to an expense', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const form = new FormData();
    form.append('file', pngBuffer, { filename: 'receipt1.png', contentType: 'image/png' });

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/expenses/${expenseId1}/attachments`,
      headers: {
        ...form.getHeaders(),
        cookie: cookieHeader,
      },
      payload: form.getBuffer(),
    });

    expect(uploadRes.statusCode).toBe(200);
    const data = JSON.parse(uploadRes.payload);
    expect(data.success).toBe(true);
    expect(data.attachment.original_name).toBe('receipt1.png');
    expect(data.attachment.mime_type).toBe('image/png');
  });

  // B. Treasurer can upload multiple receipts to one expense
  it('B: allows treasurer to upload multiple receipts (PNG and PDF) to a single expense', async () => {
    // Receipt 1: PNG
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const form1 = new FormData();
    form1.append('file', pngBuffer, { filename: 'hoa_don_1.png', contentType: 'image/png' });

    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/expenses/${expenseId1}/attachments`,
      headers: { ...form1.getHeaders(), cookie: cookieHeader },
      payload: form1.getBuffer(),
    });
    expect(res1.statusCode).toBe(200);

    // Receipt 2: PDF
    const pdfBuffer = Buffer.from('%PDF-1.4\n%Receipt Content\n%%EOF');
    const form2 = new FormData();
    form2.append('file', pdfBuffer, { filename: 'chung_tu_2.pdf', contentType: 'application/pdf' });

    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/expenses/${expenseId1}/attachments`,
      headers: { ...form2.getHeaders(), cookie: cookieHeader },
      payload: form2.getBuffer(),
    });
    expect(res2.statusCode).toBe(200);

    // Verify both exist in DB for expenseId1
    const attList = db.prepare('SELECT * FROM attachments WHERE expense_id = ?').all(expenseId1) as any[];
    expect(attList.length).toBe(2);
    expect(attList.map((a) => a.original_name)).toEqual(['hoa_don_1.png', 'chung_tu_2.pdf']);
  });

  // C. Public expense API exposes those receipts
  it('C: exposes uploaded receipts array directly in public expenses API', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\nReceipt\n');
    const form = new FormData();
    form.append('file', pdfBuffer, { filename: 'chung_tu_dat_coc.pdf', contentType: 'application/pdf' });

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/expenses/${expenseId1}/attachments`,
      headers: { ...form.getHeaders(), cookie: cookieHeader },
      payload: form.getBuffer(),
    });

    const publicRes = await app.inject({
      method: 'GET',
      url: '/api/v1/public/expenses',
    });

    expect(publicRes.statusCode).toBe(200);
    const data = JSON.parse(publicRes.payload);
    const expWithAtt = data.expenses.find((e: any) => e.id === expenseId1);
    expect(expWithAtt).toBeDefined();
    expect(expWithAtt.attachment_count).toBe(1);
    expect(expWithAtt.attachments.length).toBe(1);
    expect(expWithAtt.attachments[0].original_name).toBe('chung_tu_dat_coc.pdf');
  });

  // D. Unauthenticated public user can view the controlled receipt URL
  it('D: allows unauthenticated public user to view and stream attachment safely with nosniff header', async () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const form = new FormData();
    form.append('file', jpegBuffer, { filename: 'receipt_view.jpg', contentType: 'image/jpeg' });

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/expenses/${expenseId1}/attachments`,
      headers: { ...form.getHeaders(), cookie: cookieHeader },
      payload: form.getBuffer(),
    });
    const { attachment } = JSON.parse(uploadRes.payload);

    // Unauthenticated GET request
    const publicViewRes = await app.inject({
      method: 'GET',
      url: `/api/v1/public/attachments/${attachment.id}`,
    });

    expect(publicViewRes.statusCode).toBe(200);
    expect(publicViewRes.headers['content-type']).toBe('image/jpeg');
    expect(publicViewRes.headers['x-content-type-options']).toBe('nosniff');
    expect(publicViewRes.headers['content-disposition']).toContain('inline');
  });

  // E. Invalid/executable file rejected
  it('E: rejects executable files (e.g. DOS MZ header) disguised as image/pdf', async () => {
    const maliciousExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); // MZ executable
    const form = new FormData();
    form.append('file', maliciousExe, { filename: 'malicious.pdf', contentType: 'application/pdf' });

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/expenses/${expenseId1}/attachments`,
      headers: { ...form.getHeaders(), cookie: cookieHeader },
      payload: form.getBuffer(),
    });

    expect(uploadRes.statusCode).toBe(400);
    const data = JSON.parse(uploadRes.payload);
    expect(data.error).toContain('bị cấm');
  });

  // F. Expense totals unchanged after upload
  it('F: proves financial totals, contributions, and balance remain identical after receipt upload', async () => {
    const totalsBefore = db.prepare(`
      SELECT 
        (SELECT SUM(amount) FROM contributions) as in_sum,
        (SELECT SUM(amount) FROM expenses) as out_sum
    `).get() as any;

    const pdfBuffer = Buffer.from('%PDF-1.4\nInvoice\n');
    const form = new FormData();
    form.append('file', pdfBuffer, { filename: 'hoa_don.pdf', contentType: 'application/pdf' });

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/expenses/${expenseId1}/attachments`,
      headers: { ...form.getHeaders(), cookie: cookieHeader },
      payload: form.getBuffer(),
    });

    const totalsAfter = db.prepare(`
      SELECT 
        (SELECT SUM(amount) FROM contributions) as in_sum,
        (SELECT SUM(amount) FROM expenses) as out_sum
    `).get() as any;

    expect(totalsAfter.in_sum).toBe(totalsBefore.in_sum);
    expect(totalsAfter.out_sum).toBe(totalsBefore.out_sum);
  });

  // G. Expense without receipt behaves correctly
  it('G: ensures expenses without receipts return empty attachments array without error', async () => {
    const publicRes = await app.inject({
      method: 'GET',
      url: '/api/v1/public/expenses',
    });

    expect(publicRes.statusCode).toBe(200);
    const data = JSON.parse(publicRes.payload);
    const expWithoutAtt = data.expenses.find((e: any) => e.id === expenseId2);
    expect(expWithoutAtt).toBeDefined();
    expect(expWithoutAtt.attachment_count).toBe(0);
    expect(expWithoutAtt.attachments).toEqual([]);
  });
});
