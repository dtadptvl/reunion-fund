import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { buildApp } from '../../server/src/app.js';
import { FastifyInstance } from 'fastify';

describe('Phase 3B UI & Configuration Refinements (A-K Requirements)', () => {
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

  // A. Typing filters member suggestions
  it('A: typing filters member suggestions sensibly with case-insensitivity and diacritic handling', () => {
    // Search with diacritics
    const resultsHue = memberService.searchMembers('Huế');
    expect(resultsHue.length).toBe(3); // Đặng Thị Huế, Nguyễn Thị Huế (Lạc Đạo), Nguyễn Thị Huế (Lương Tài)

    // Search without diacritics
    const resultsHueNoDiacritics = memberService.searchMembers('Hue');
    expect(resultsHueNoDiacritics.length).toBe(3);

    // Search partial case-insensitive
    const resultsTuan = memberService.searchMembers('tuAn');
    expect(resultsTuan.length).toBeGreaterThanOrEqual(2);
    expect(resultsTuan.some(m => m.full_name === 'Dương Tuấn Anh')).toBe(true);
    expect(resultsTuan.some(m => m.full_name === 'Nguyễn Văn Tuấn')).toBe(true);
  });

  // B & C. Synchronized member state & dropdown ID
  it('B & C: autocomplete suggestions and dropdown bind to the exact same immutable member ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/members?q=Huế',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const members = body.members;

    expect(members.length).toBe(3);
    const lacDao = members.find((m: any) => m.disambiguator === 'Lạc Đạo');
    const luongTai = members.find((m: any) => m.disambiguator === 'Lương Tài');

    expect(lacDao).toBeDefined();
    expect(luongTai).toBeDefined();
    expect(lacDao.id).not.toBe(luongTai.id);

    // Creating intent with immutable ID directly binds to the correct member
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

  // D. Two Nguyễn Thị Huế entries remain distinguishable
  it('D: two Nguyễn Thị Huế records remain distinct and distinguishable by immutable ID and disambiguator', () => {
    const hueMembers = memberService.searchMembers('Nguyễn Thị Huế');
    expect(hueMembers.length).toBe(2);

    const [hue1, hue2] = hueMembers;
    expect(hue1.id).not.toBe(hue2.id);
    expect(hue1.disambiguator).toBeDefined();
    expect(hue2.disambiguator).toBeDefined();
    expect(new Set([hue1.disambiguator, hue2.disambiguator])).toEqual(new Set(['Lạc Đạo', 'Lương Tài']));
  });

  // E & F. Default suggested amount = 500000 and public config exposure
  it('E & F: public configuration exposes default suggested amount of 500000 VND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/config',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.suggestedAmount).toBe(500000);

    const overviewRes = await app.inject({
      method: 'GET',
      url: '/api/v1/public/overview',
    });
    expect(overviewRes.statusCode).toBe(200);
    const overviewBody = JSON.parse(overviewRes.body);
    expect(overviewBody.suggestedAmount).toBe(500000);
  });

  // G, H, I. Treasurer configurable suggested amount, auth protection, audit log
  it('G, H, I: Treasurer can update suggested amount, unauthorized users are rejected, audit log is written', async () => {
    // 1. Unauthorized attempt -> HTTP 401
    const unauthRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/config/suggested-amount',
      payload: { amount: 600000 },
    });
    expect(unauthRes.statusCode).toBe(401);

    // 2. Treasurer logs in
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: { username: 'treasurer', password: 'test-password-123' },
    });
    expect(loginRes.statusCode).toBe(200);
    const cookie = loginRes.headers['set-cookie'] as string;
    expect(cookie).toBeDefined();

    // 3. Negative validation (invalid amount)
    const invalidRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/config/suggested-amount',
      headers: { cookie },
      payload: { amount: -50000 },
    });
    expect(invalidRes.statusCode).toBe(400);

    // 4. Authenticated Treasurer updates suggested amount to 600,000 VND
    const updateRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/config/suggested-amount',
      headers: { cookie },
      payload: { amount: 600000 },
    });
    expect(updateRes.statusCode).toBe(200);
    const updateBody = JSON.parse(updateRes.body);
    expect(updateBody.success).toBe(true);
    expect(updateBody.suggestedAmount).toBe(600000);

    // 5. Public config immediately reflects the updated value without rebuild
    const publicConfigRes = await app.inject({
      method: 'GET',
      url: '/api/v1/public/config',
    });
    expect(JSON.parse(publicConfigRes.body).suggestedAmount).toBe(600000);

    // 6. Verify audit log entry
    const auditRow = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'UPDATE_SUGGESTED_AMOUNT' ORDER BY timestamp DESC LIMIT 1")
      .get() as any;
    expect(auditRow).toBeDefined();
    expect(auditRow.actor).toBe('treasurer');
    expect(auditRow.entity_type).toBe('SYSTEM_STATE');
    expect(JSON.parse(auditRow.after_state).suggestedAmount).toBe(600000);
  });

  // J & K. Contribution list sorting & Nguyễn Thị Huế disambiguator rendering
  it('J & K: contribution list sorts by Vietnamese given name and renders disambiguators for identical names', async () => {
    // Seed contributions for multiple members
    const members = memberService.searchMembers('');
    const tuanAnh = members.find(m => m.full_name === 'Dương Tuấn Anh')!;
    const vanAnh = members.find(m => m.full_name === 'Nguyễn Vân Anh')!;
    const hueLacDao = members.find(m => m.full_name === 'Nguyễn Thị Huế' && m.disambiguator === 'Lạc Đạo')!;
    const hueLuongTai = members.find(m => m.full_name === 'Nguyễn Thị Huế' && m.disambiguator === 'Lương Tài')!;
    const vuTuyen = members.find(m => m.full_name === 'Vũ Văn Tuyền')!;
    const nguyenTuyen = members.find(m => m.full_name === 'Nguyễn Thị Tuyền')!;

    // Create contributions
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
    insertContrib('5', vuTuyen.id, 500000);
    insertContrib('6', nguyenTuyen.id, 500000);

    const contribRes = await app.inject({
      method: 'GET',
      url: '/api/v1/public/contributors',
    });
    expect(contribRes.statusCode).toBe(200);
    const body = JSON.parse(contribRes.body);
    const contribMembers = body.members;

    // Verify exactly 40 canonical members returned
    expect(contribMembers.length).toBe(40);

    // Verify ordering: given names "Anh" < "Bích" < "Dương" < ... < "Huế" < ... < "Tuyền" < "Tuyến" < "Uyên" < "Viển"
    const givenNames = contribMembers.map((m: any) => {
      const clean = m.full_name.replace(/\s*\([^)]*\)/g, '').trim();
      const parts = clean.split(/\s+/);
      return parts[parts.length - 1];
    });

    // First members should have given name "Anh"
    expect(givenNames[0]).toBe('Anh');
    expect(givenNames[1]).toBe('Anh');
    // Last member should have given name "Viển"
    expect(givenNames[givenNames.length - 1]).toBe('Viển');

    // Both Nguyễn Thị Huế must have their disambiguators intact and distinct
    const hueRecords = contribMembers.filter((m: any) => m.full_name === 'Nguyễn Thị Huế');
    expect(hueRecords.length).toBe(2);
    expect(hueRecords[0].disambiguator).toBe('Lạc Đạo');
    expect(hueRecords[1].disambiguator).toBe('Lương Tài');
    expect(hueRecords[0].total_contributed).toBe(500000);
    expect(hueRecords[1].total_contributed).toBe(1000000);
  });
});
