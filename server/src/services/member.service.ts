import Database from 'better-sqlite3';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { MemberRow, ExternalContributorRow } from '../db/schema.js';
import {
  removeVietnameseDiacritics,
  generateBankDisplayName,
} from './vietqr.service.js';

export interface ImportMemberResult {
  totalRows: number;
  imported: number;
  skippedDuplicates: number;
  errors: string[];
}

export class MemberService {
  constructor(private db: Database.Database) {}

  /**
   * Search canonical class roster by name or phone.
   */
  searchMembers(query: string, limit = 20): MemberRow[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.db
        .prepare('SELECT * FROM members ORDER BY full_name ASC LIMIT ?')
        .all(limit) as MemberRow[];
    }

    const normalized = removeVietnameseDiacritics(trimmed);
    const searchPattern = `%${normalized}%`;

    return this.db
      .prepare(`
        SELECT * FROM members
        WHERE normalized_name LIKE ? OR bank_display_name LIKE ? OR phone LIKE ?
        ORDER BY full_name ASC
        LIMIT ?
      `)
      .all(searchPattern, searchPattern, `%${trimmed}%`, limit) as MemberRow[];
  }

  /**
   * Import roster from CSV or XLSX buffer.
   */
  importRoster(
    fileBuffer: Buffer,
    fileType: 'csv' | 'xlsx'
  ): ImportMemberResult {
    let rawRecords: { name: string; phone?: string; email?: string; notes?: string }[] = [];

    if (fileType === 'csv') {
      const parsed = parse(fileBuffer.toString('utf-8'), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
      rawRecords = parsed.map((row: any) => ({
        name: row.name || row.full_name || row['Họ và tên'] || row['Tên'] || '',
        phone: row.phone || row['Số điện thoại'] || row['SĐT'] || '',
        email: row.email || row['Email'] || '',
        notes: row.notes || row['Ghi chú'] || '',
      }));
    } else {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0] || ''];
      if (firstSheet) {
        const jsonRows: any[] = XLSX.utils.sheet_to_json(firstSheet);
        rawRecords = jsonRows.map((row: any) => ({
          name: row.name || row.full_name || row['Họ và tên'] || row['Tên'] || '',
          phone: row.phone || row['Số điện thoại'] || row['SĐT'] || '',
          email: row.email || row['Email'] || '',
          notes: row.notes || row['Ghi chú'] || '',
        }));
      }
    }

    let imported = 0;
    let skippedDuplicates = 0;
    const errors: string[] = [];

    const insertStmt = this.db.prepare(`
      INSERT INTO members (
        id, full_name, normalized_name, bank_display_name, phone, email, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    this.db.transaction(() => {
      for (const record of rawRecords) {
        const fullName = record.name.trim();
        if (!fullName) continue;

        const normalized = removeVietnameseDiacritics(fullName);
        const bankDisplay = generateBankDisplayName(fullName);

        // Check exact duplicate
        const existing = this.db
          .prepare('SELECT id FROM members WHERE full_name = ? AND (phone = ? OR phone IS NULL)')
          .get(fullName, record.phone || null);

        if (existing) {
          skippedDuplicates++;
          continue;
        }

        const memberId = crypto.randomUUID();
        insertStmt.run(
          memberId,
          fullName,
          normalized,
          bankDisplay,
          record.phone || null,
          record.email || null,
          record.notes || null
        );
        imported++;
      }
    })();

    return {
      totalRows: rawRecords.length,
      imported,
      skippedDuplicates,
      errors,
    };
  }

  /**
   * Register a temporary external contributor (not on canonical roster).
   */
  createExternalContributor(rawName: string): ExternalContributorRow {
    const trimmed = rawName.trim();
    const normalized = removeVietnameseDiacritics(trimmed);
    const id = crypto.randomUUID();

    const row: ExternalContributorRow = {
      id,
      raw_name: trimmed,
      normalized_name: normalized,
      display_name: trimmed,
      status: 'PENDING_REVIEW',
      linked_member_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.db
      .prepare(`
        INSERT INTO external_contributors (
          id, raw_name, normalized_name, display_name, status, linked_member_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
      .run(row.id, row.raw_name, row.normalized_name, row.display_name, row.status, row.linked_member_id);

    return row;
  }
}
