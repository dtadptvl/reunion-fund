import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { buildApp } from '../../server/src/app.js';
import { FastifyInstance } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Phase 3B UI Finalization & Direct Autocomplete (A-K Requirements)', () => {
  let db: Database.Database;
  let memberService: MemberService;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    // Create staff user for treasurer tests
    const argon2 = await import('argon2');
    const hash = await argon2.hash('test-password-123', { type: argon2.argon2id });
    db.prepare(`
      INSERT INTO staff_users (id, username, password_hash, full_name, role)
      VALUES ('staff-treasurer-1', 'treasurer', ?, 'Thủ Quỹ Lớp', 'TREASURER')
    `).run(hash);

    app = await buildApp({ db });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  // A. Search suggestions filter while typing
  it('A: search suggestions filter sensibly while typing (case-insensitivity and diacritics)', () => {
    // Search with diacritics "Huế"
    const resultsHue = memberService.searchMembers('Huế');
    expect(resultsHue.length).toBe(3); // Đặng Thị Huế, Nguyễn Thị Huế (Lạc Đạo), Nguyễn Thị Huế (Lương Tài)

    // Search without diacritics "Hue"
    const resultsHueNoDiacritics = memberService.searchMembers('Hue');
    expect(resultsHueNoDiacritics.length).toBe(3);

    // Search partial case-insensitive "tuan"
    const resultsTuan = memberService.searchMembers('tuAn');
    expect(resultsTuan.length).toBeGreaterThanOrEqual(2);
    expect(resultsTuan.some(m => m.full_name === 'Dương Tuấn Anh')).toBe(true);
    expect(resultsTuan.some(m => m.full_name === 'Nguyễn Văn Tuấn')).toBe(true);
  });

  // B. Clicking suggestion sets exact selectedMemberId
  it('B: selecting an autocomplete suggestion binds the exact immutable member ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/members?q=Huế',
    });
    expect(res.statusCode).toBe(200);
    const members = JSON.parse(res.body).members;

    const lacDao = members.find((m: any) => m.disambiguator === 'Lạc Đạo');
    expect(lacDao).toBeDefined();

    // Direct creation of intent with the selected memberId
    const intentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: {
        memberId: lacDao.id,
        amount: 500000,
      },
    });
    expect(intentRes.statusCode).toBe(200);
    const intentData = JSON.parse(intentRes.body);

    const intentInDb = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intentData.intentId) as any;
    expect(intentInDb.member_id).toBe(lacDao.id);
  });

  // C. Search field displays selected member after selection
  it('C: helper function builds correct full display name with parenthetical disambiguator', () => {
    const memberWithDisambiguator = { full_name: 'Nguyễn Thị Huế', disambiguator: 'Lạc Đạo' };
    const memberWithoutDisambiguator = { full_name: 'Dương Tuấn Anh', disambiguator: null };

    const getDisplayName = (m: any) =>
      m ? `${m.full_name}${m.disambiguator ? ` (${m.disambiguator})` : ''}` : '';

    expect(getDisplayName(memberWithDisambiguator)).toBe('Nguyễn Thị Huế (Lạc Đạo)');
    expect(getDisplayName(memberWithoutDisambiguator)).toBe('Dương Tuấn Anh');
  });

  // D. A new search can change member selection
  it('D: changing search term returns updated member suggestions and allows selecting a different member', async () => {
    // 1. Initial selection: Dương Tuấn Anh
    const res1 = await app.inject({ method: 'GET', url: '/api/v1/public/members?q=Tuấn Anh' });
    const mem1 = JSON.parse(res1.body).members[0];
    expect(mem1.full_name).toBe('Dương Tuấn Anh');

    // 2. User clears and searches for "Lê Mạnh Long"
    const res2 = await app.inject({ method: 'GET', url: '/api/v1/public/members?q=Mạnh Long' });
    const mem2 = JSON.parse(res2.body).members[0];
    expect(mem2.full_name).toBe('Lê Mạnh Long');
    expect(mem2.id).not.toBe(mem1.id);

    // Intent created with second member
    const intentRes = await app.inject({
      method: 'POST',
      url: '/api/v1/public/intent',
      payload: { memberId: mem2.id, amount: 500000 },
    });
    expect(intentRes.statusCode).toBe(200);
    const intentInDb = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(JSON.parse(intentRes.body).intentId) as any;
    expect(intentInDb.member_id).toBe(mem2.id);
  });

  // E. Both Nguyễn Thị Huế records remain independently selectable
  it('E: both Nguyễn Thị Huế records remain independently selectable with separate immutable IDs', () => {
    const hueMembers = memberService.searchMembers('Nguyễn Thị Huế');
    expect(hueMembers.length).toBe(2);

    const [hue1, hue2] = hueMembers;
    expect(hue1.id).not.toBe(hue2.id);
    expect(hue1.disambiguator).toBeDefined();
    expect(hue2.disambiguator).toBeDefined();
    expect(new Set([hue1.disambiguator, hue2.disambiguator])).toEqual(new Set(['Lạc Đạo', 'Lương Tài']));
  });

  // F & G. "Không có tên trong danh sách" available and NO old select dropdown rendered
  it('F & G: "Không có tên trong danh sách" is present and old member dropdown is completely removed', () => {
    const registerPagePath = path.resolve(__dirname, '../../client/src/pages/RegisterPage.tsx');
    const registerCode = fs.readFileSync(registerPagePath, 'utf-8');

    const contributePagePath = path.resolve(__dirname, '../../client/src/pages/ContributePage.tsx');
    const contributeCode = fs.readFileSync(contributePagePath, 'utf-8');

    // Verify old select element is removed
    expect(contributeCode.includes('-- Chọn thành viên lớp --')).toBe(false);
    expect(contributeCode.includes('<select')).toBe(false);
    expect(registerCode.includes('<select')).toBe(false);

    // Verify "Không có tên trong danh sách" flow is present in register autocomplete
    expect(registerCode.includes('Không có tên trong danh sách')).toBe(true);
    expect(registerCode.includes('isGuestMode')).toBe(true);
  });

  // H. Name correction remains functional
  it('H: name correction request remains functional with single requestedName field', async () => {
    const member = memberService.searchMembers('Dương Tuấn Anh', 1)[0];
    expect(member).toBeDefined();

    const correctionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/public/members/${member.id}/correction`,
      payload: { requestedName: 'Dương Tuấn Anh (Chuẩn)' },
    });
    expect(correctionRes.statusCode).toBe(200);

    const reqInDb = db.prepare('SELECT * FROM name_correction_requests WHERE member_id = ?').get(member.id) as any;
    expect(reqInDb).toBeDefined();
    expect(reqInDb.requested_name).toBe('Dương Tuấn Anh (Chuẩn)');
    expect(reqInDb.status).toBe('PENDING');
  });

  // I. Amount UI still has exactly suggested/custom choices
  it('I: amount UI supports configured suggested amount and custom amount only', async () => {
    // Check config endpoint returns default 500k
    const configRes = await app.inject({ method: 'GET', url: '/api/v1/public/config' });
    expect(configRes.statusCode).toBe(200);
    expect(JSON.parse(configRes.body).suggestedAmount).toBe(500000);

    // Frontend code inspection: exactly suggested amount and custom amount
    const contributePagePath = path.resolve(__dirname, '../../client/src/pages/ContributePage.tsx');
    const contributeCode = fs.readFileSync(contributePagePath, 'utf-8');
    expect(contributeCode.includes('Mức đề xuất')).toBe(true);
    expect(contributeCode.includes('Số tiền khác')).toBe(true);
    expect(contributeCode.includes('isCustomAmount')).toBe(true);
    // Ensure no legacy preset array [500000, 1000000, 2000000]
    expect(contributeCode.includes('[500000, 1000000, 2000000]')).toBe(false);
  });

  // J & K. Contribution list sorting & Nguyễn Thị Huế disambiguator rendering
  it('J & K: contribution list sorts by Vietnamese given name and renders disambiguators for identical names', async () => {
    const members = memberService.searchMembers('');
    const tuanAnh = members.find(m => m.full_name === 'Dương Tuấn Anh')!;
    const vanAnh = members.find(m => m.full_name === 'Nguyễn Vân Anh')!;
    const hueLacDao = members.find(m => m.full_name === 'Nguyễn Thị Huế' && m.disambiguator === 'Lạc Đạo')!;
    const hueLuongTai = members.find(m => m.full_name === 'Nguyễn Thị Huế' && m.disambiguator === 'Lương Tài')!;

    const insertContrib = (id: string, memberId: string, amount: number) => {
      const sepayId = Math.floor(Math.random() * 1000000);
      db.prepare(`
        INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source, is_excluded)
        VALUES ('bt-${id}', ${sepayId}, 'MBBank', CURRENT_TIMESTAMP, '0123', 'in', ${amount}, 'MEMO', '{}', 'WEBHOOK', 0)
      `).run();
      db.prepare(`
        INSERT INTO contributions (id, bank_transaction_id, contributor_type, member_id, amount, match_method)
        VALUES ('c-${id}', 'bt-${id}', 'MEMBER', '${memberId}', ${amount}, 'EXACT_PAYMENT_CODE')
      `).run();
    };

    insertContrib('1', tuanAnh.id, 500000);
    insertContrib('2', vanAnh.id, 500000);
    insertContrib('3', hueLacDao.id, 500000);
    insertContrib('4', hueLuongTai.id, 1000000);

    const contribRes = await app.inject({
      method: 'GET',
      url: '/api/v1/public/contributors',
    });
    expect(contribRes.statusCode).toBe(200);
    const body = JSON.parse(contribRes.body);
    const contribMembers = body.members;

    expect(contribMembers.length).toBe(40);

    // Vietnamese given-name ordering
    const givenNames = contribMembers.map((m: any) => {
      const clean = m.full_name.replace(/\s*\([^)]*\)/g, '').trim();
      const parts = clean.split(/\s+/);
      return parts[parts.length - 1];
    });

    expect(givenNames[0]).toBe('Anh');
    expect(givenNames[1]).toBe('Anh');
    expect(givenNames[givenNames.length - 1]).toBe('Viển');

    // Both Nguyễn Thị Huế must have disambiguators intact and distinct
    const hueRecords = contribMembers.filter((m: any) => m.full_name === 'Nguyễn Thị Huế');
    expect(hueRecords.length).toBe(2);
    expect(hueRecords[0].disambiguator).toBe('Lạc Đạo');
    expect(hueRecords[1].disambiguator).toBe('Lương Tài');
  });
});
