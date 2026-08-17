import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import {
  MemberRow,
  ExternalContributorRow,
  NameCorrectionRequestRow,
} from '../db/schema.js';
import {
  removeVietnameseDiacritics,
  generateBankDisplayName,
} from './vietqr.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ImportMemberResult {
  totalRows: number;
  imported: number;
  skippedDuplicates: number;
  errors: string[];
}

/**
 * Extracts the given name (final name component), ignoring any parenthetical disambiguator.
 * e.g., "Nguyễn Thị Huế (Lạc Đạo)" -> "Huế"
 *       "Dương Tuấn Anh" -> "Anh"
 */
export function extractGivenName(name: string): string {
  // Strip parenthetical content first
  const cleanName = name.replace(/\s*\([^)]*\)/g, '').trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] || '') : cleanName;
}

/**
 * Sorts members according to Vietnamese class-list style:
 * 1. Alphabetically by GIVEN NAME using 'vi' locale collation.
 * 2. Secondary sort by full name.
 * 3. Stable tertiary sort by disambiguator.
 */
export function sortVietnameseMembers<T extends { full_name: string; disambiguator?: string | null }>(
  memberList: T[]
): T[] {
  return [...memberList].sort((a, b) => {
    const givenA = extractGivenName(a.full_name);
    const givenB = extractGivenName(b.full_name);

    const comp = givenA.localeCompare(givenB, 'vi', { sensitivity: 'base' });
    if (comp !== 0) return comp;

    const fullA = a.full_name.replace(/\s*\([^)]*\)/g, '').trim();
    const fullB = b.full_name.replace(/\s*\([^)]*\)/g, '').trim();
    const fullComp = fullA.localeCompare(fullB, 'vi', { sensitivity: 'base' });
    if (fullComp !== 0) return fullComp;

    return (a.disambiguator || '').localeCompare(b.disambiguator || '', 'vi', { sensitivity: 'base' });
  });
}

export class MemberService {
  constructor(private db: Database.Database) {}

  /**
   * Search canonical class roster by name or phone, returning sorted results.
   */
  searchMembers(query: string, limit = 50): MemberRow[] {
    let rows: MemberRow[];
    const trimmed = query.trim();

    if (!trimmed) {
      rows = this.db.prepare('SELECT * FROM members').all() as MemberRow[];
    } else {
      const normalized = removeVietnameseDiacritics(trimmed);
      const searchPattern = `%${normalized}%`;
      rows = this.db
        .prepare(`
          SELECT * FROM members
          WHERE normalized_name LIKE ? OR bank_display_name LIKE ? OR phone LIKE ? OR full_name LIKE ?
        `)
        .all(searchPattern, searchPattern, `%${trimmed}%`, `%${trimmed}%`) as MemberRow[];
    }

    const sorted = sortVietnameseMembers(rows);
    return sorted.slice(0, limit);
  }

  /**
   * Seed canonical roster from roster.json if members table is empty.
   */
  seedCanonicalRoster(): number {
    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM members').get() as { count: number };
    if (countRow.count > 0) {
      return 0;
    }

    const seedPath = path.resolve(__dirname, '../db/seeds/roster.json');
    if (!fs.existsSync(seedPath)) {
      return 0;
    }

    const rawData = fs.readFileSync(seedPath, 'utf-8');
    const items: { fullName: string; disambiguator?: string }[] = JSON.parse(rawData);

    const insertStmt = this.db.prepare(`
      INSERT INTO members (
        id, full_name, normalized_name, bank_display_name, disambiguator, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    let inserted = 0;
    this.db.transaction(() => {
      for (const item of items) {
        const id = crypto.randomUUID();
        const fullName = item.fullName.trim();
        const normalized = removeVietnameseDiacritics(fullName);
        const bankDisplay = generateBankDisplayName(fullName);
        const disambiguator = item.disambiguator ? item.disambiguator.trim() : null;

        insertStmt.run(id, fullName, normalized, bankDisplay, disambiguator);
        inserted++;
      }
    })();

    return inserted;
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
        id, full_name, normalized_name, bank_display_name, disambiguator, phone, email, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    this.db.transaction(() => {
      for (const record of rawRecords) {
        let fullName = record.name.trim();
        if (!fullName) continue;

        let disambiguator: string | null = null;
        const match = fullName.match(/^(.+?)\s*\(([^)]+)\)$/);
        if (match && match[1] && match[2]) {
          fullName = match[1].trim();
          disambiguator = match[2].trim();
        }

        const normalized = removeVietnameseDiacritics(fullName);
        const bankDisplay = generateBankDisplayName(fullName);

        // Check exact duplicate
        const existing = this.db
          .prepare('SELECT id FROM members WHERE full_name = ? AND COALESCE(disambiguator, "") = ?')
          .get(fullName, disambiguator || '');

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
          disambiguator,
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
   * Submit a name correction request from a public user.
   * MUST NOT directly modify the canonical member record.
   */
  createNameCorrectionRequest(
    memberId: string,
    requestedName: string,
    notes?: string
  ): NameCorrectionRequestRow {
    const member = this.db.prepare('SELECT * FROM members WHERE id = ?').get(memberId) as MemberRow | undefined;
    if (!member) {
      throw new Error('Thành viên không tồn tại');
    }

    const id = crypto.randomUUID();
    const reqRow: NameCorrectionRequestRow = {
      id,
      member_id: memberId,
      current_name: member.full_name + (member.disambiguator ? ` (${member.disambiguator})` : ''),
      requested_name: requestedName.trim(),
      notes: notes?.trim() || null,
      status: 'PENDING',
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO name_correction_requests (
        id, member_id, current_name, requested_name, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
    `).run(
      reqRow.id,
      reqRow.member_id,
      reqRow.current_name,
      reqRow.requested_name,
      reqRow.notes
    );

    return reqRow;
  }

  /**
   * Review and approve/reject a name correction request.
   * On approval: update canonical member record, keeping the immutable ID intact.
   */
  reviewNameCorrectionRequest(
    requestId: string,
    action: 'APPROVE' | 'REJECT',
    reviewerUsername: string
  ): { success: boolean; memberId: string; updatedName?: string } {
    const req = this.db
      .prepare('SELECT * FROM name_correction_requests WHERE id = ?')
      .get(requestId) as NameCorrectionRequestRow | undefined;

    if (!req) {
      throw new Error('Yêu cầu sửa tên không tồn tại');
    }

    if (action === 'REJECT') {
      this.db.prepare(`
        UPDATE name_correction_requests SET
          status = 'REJECTED',
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(reviewerUsername, requestId);

      return { success: true, memberId: req.member_id };
    }

    // APPROVE
    let newFullName = req.requested_name.trim();
    let newDisambiguator: string | null = null;
    const match = newFullName.match(/^(.+?)\s*\(([^)]+)\)$/);
    if (match && match[1] && match[2]) {
      newFullName = match[1].trim();
      newDisambiguator = match[2].trim();
    }

    const newNormalized = removeVietnameseDiacritics(newFullName);
    const newBankDisplay = generateBankDisplayName(newFullName);

    this.db.transaction(() => {
      // 1. Update member (preserving immutable ID and foreign keys)
      this.db.prepare(`
        UPDATE members SET
          full_name = ?,
          normalized_name = ?,
          bank_display_name = ?,
          disambiguator = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(newFullName, newNormalized, newBankDisplay, newDisambiguator, req.member_id);

      // 2. Mark request as APPROVED
      this.db.prepare(`
        UPDATE name_correction_requests SET
          status = 'APPROVED',
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(reviewerUsername, requestId);
    })();

    return { success: true, memberId: req.member_id, updatedName: newFullName };
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
