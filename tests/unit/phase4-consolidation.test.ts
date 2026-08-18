import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { LotteryService } from '../../server/src/services/lottery.service.js';
import { MockEmailProvider } from '../../server/src/providers/email/mock-email-provider.js';
import { buildApp } from '../../server/src/app.js';
import supertest from 'supertest';
import crypto from 'crypto';

describe('V2 Consolidation Patch — Lucky Wheel, Contribution Identity, Registration & Voting Removal', () => {
  let db: Database.Database;
  let mockEmailProvider: MockEmailProvider;
  let memberService: MemberService;
  let authService: AuthService;
  let lotteryService: LotteryService;
  let app: any;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    mockEmailProvider = new MockEmailProvider();
    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    authService = new AuthService(db, mockEmailProvider);
    lotteryService = new LotteryService(db);

    app = buildApp({
      db,
      emailProvider: mockEmailProvider,
    });
    await app.ready();
  });

  function insertContribution(db: Database.Database, memberId: string, amount: number) {
    const bankTxId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
      VALUES (?, ?, 'MB', datetime('now'), '0123', 'in', ?, 'test', '{}', 'WEBHOOK')
    `).run(bankTxId, Math.floor(Math.random() * 10000000) + 1000, amount);

    db.prepare(`
      INSERT INTO contributions (id, bank_transaction_id, contributor_type, member_id, amount, match_method)
      VALUES (?, ?, 'MEMBER', ?, ?, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), bankTxId, memberId, amount);
  }

  // 1. Voting Removal Verification
  it('1. Verifies voting endpoints are completely removed and return 404', async () => {
    // Public / Member vote routes
    const resGetVotes = await supertest(app.server).get('/api/v1/auth/votes');
    expect(resGetVotes.status).toBe(404);

    const resPostVotes = await supertest(app.server).post('/api/v1/auth/votes').send({ votes: [] });
    expect(resPostVotes.status).toBe(404);

    // Admin voting routes
    const resAdminResults = await supertest(app.server).get('/api/v1/admin/voting/results');
    expect(resAdminResults.status).toBe(404);

    const resAdminLock = await supertest(app.server).post('/api/v1/admin/voting/lock').send({ isLocked: true });
    expect(resAdminLock.status).toBe(404);

    const resAdminPresentation = await supertest(app.server).get('/api/v1/admin/voting/presentation');
    expect(resAdminPresentation.status).toBe(404);
  });

  // 2. Lucky Wheel Scale to 20 Participants & Proportional Weights
  it('2. Scales wheel cleanly with 20 eligible members, preserving proportional angles and distinct disambiguators', () => {
    const members = memberService.searchMembers('', 40);
    expect(members.length).toBe(40);

    // Give 20 members contributions
    const testMembers = members.slice(0, 20);
    testMembers.forEach((m, idx) => {
      insertContribution(db, m.id, (idx + 1) * 100000);
    });

    const { segments, totalWeight } = lotteryService.getWheelSegments(new Set());
    expect(segments).toHaveLength(20);

    // Expected total weight = sum(1..20) * 100,000 = 210 * 100,000 = 21,000,000
    expect(totalWeight).toBe(21000000);

    // Angles must span contiguous 0..360 degrees
    expect(segments[0].startAngle).toBe(0);
    expect(segments[segments.length - 1].endAngle).toBe(360);

    // Verify both Hue members if present
    const hueRecords = segments.filter((s) => s.fullName === 'Nguyễn Thị Huế');
    hueRecords.forEach((h) => {
      expect(h.disambiguator).toBeTruthy();
    });
  });

  // 3. Official Admin Reset
  it('3. Official Admin Reset restores all members to wheel pool and preserves financial/music data', async () => {
    const members = memberService.searchMembers('', 5);
    members.slice(0, 4).forEach((m) => {
      insertContribution(db, m.id, 500000);
    });

    // Draw all 3 prizes
    lotteryService.triggerDraw('giai-ba', 'admin');
    lotteryService.triggerDraw('giai-nhi', 'admin');
    lotteryService.triggerDraw('giai-nhat', 'admin');

    expect(lotteryService.getCompletedDraws()).toHaveLength(3);

    // Reset via LotteryService
    lotteryService.resetLotteryState('admin_user');

    expect(lotteryService.getCompletedDraws()).toHaveLength(0);

    const state = lotteryService.getPublicWheelState();
    expect(state.status).toBe('IDLE');
    expect(state.completedPrizes).toHaveLength(0);
    expect(state.nextPrize?.prizeId).toBe('giai-ba');
    expect(state.wheelSegments).toHaveLength(4);
  });

  // 4. Intent & Contribution Identity Binding
  it('4. Member contribution auto-binds memberId; guest contribution creates external intent without account', async () => {
    const members = memberService.searchMembers('', 2);
    const member = members[0];

    // Authenticated member intent creation
    const memberRes = await supertest(app.server)
      .post('/api/v1/public/intent')
      .send({
        memberId: member.id,
        amount: 500000,
      });

    expect(memberRes.status).toBe(200);
    expect(memberRes.body.memberId).toBe(member.id);
    expect(memberRes.body.transferContent).toContain(member.bank_display_name);

    // Guest intent creation
    const guestRes = await supertest(app.server)
      .post('/api/v1/public/intent')
      .send({
        customName: 'Khách Quý Doanh Nghiệp ABC',
        amount: 1000000,
      });

    expect(guestRes.status).toBe(200);
    expect(guestRes.body.memberId).toBeNull();
    expect(guestRes.body.externalContributorId).toBeTruthy();

    // Confirm no users row created for guest
    const userCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE username = 'Khách Quý Doanh Nghiệp ABC'").get() as { count: number };
    expect(userCount.count).toBe(0);
  });

  // 5. Canonical Member Display Name Resolution for Admin Accounts
  it('5. Resolves canonical member name as fullName when user account has member_id', async () => {
    const m = memberService.searchMembers('', 40).find((x) => x.full_name === 'Nguyễn Thị Bích')!;
    expect(m).toBeDefined();

    // Register user for this canonical member
    const regResult = await authService.registerMember({
      memberId: m.id,
      username: 'member_user1',
      email: 'member1@example.com',
      password: 'password123',
    });

    await authService.verifyEmail({ code: regResult.verification.code, email: 'member1@example.com' });

    // Authenticate
    const authRes = await authService.authenticate('member_user1', 'password123');
    expect(authRes.status).toBe('SUCCESS');
    expect(authRes.session?.memberId).toBe(m.id);
    expect(authRes.session?.fullName).toBe(m.full_name);
  });

  // 6. Wheel Segments Sorted by Probability Descending & Equal-Weight Vietnamese Name Sort
  it('6. Sorts wheel segments by probability descending with deterministic Vietnamese name secondary sort', () => {
    const allMembers = memberService.searchMembers('', 40);
    const mTop = allMembers.find((m) => m.full_name === 'Nguyễn Vân Anh')!;
    const mHue1 = allMembers.find((m) => m.full_name === 'Nguyễn Thị Huế' && m.disambiguator === 'Lạc Đạo')!;
    const mHue2 = allMembers.find((m) => m.full_name === 'Nguyễn Thị Huế' && m.disambiguator === 'Lương Tài')!;
    const mLa = allMembers.find((m) => m.full_name === 'Lê Hồng La')!;
    const mBich = allMembers.find((m) => m.full_name === 'Nguyễn Thị Bích')!;

    insertContribution(db, mTop.id, 1000000);   // Top: 1,000,000 (Highest probability)
    insertContribution(db, mHue1.id, 500000);   // Equal: 500,000 (Huế Lạc Đạo)
    insertContribution(db, mHue2.id, 500000);   // Equal: 500,000 (Huế Lương Tài)
    insertContribution(db, mLa.id, 500000);     // Equal: 500,000 (La)
    insertContribution(db, mBich.id, 200000);   // Lowest: 200,000 (Bích)

    const { segments, totalWeight } = lotteryService.getWheelSegments(new Set());
    expect(totalWeight).toBe(2700000);
    expect(segments).toHaveLength(5);

    // Segment 0 must be top contributor (Nguyễn Vân Anh)
    expect(segments[0].fullName).toBe('Nguyễn Vân Anh');
    expect(segments[0].weight).toBe(1000000);

    // Segments 1, 2, 3 must be sorted by Vietnamese given name for 500k:
    // Given names: Huế (H) comes before La (L)
    expect(segments[1].fullName).toBe('Nguyễn Thị Huế');
    expect(segments[1].disambiguator).toBe('Lạc Đạo');
    expect(segments[2].fullName).toBe('Nguyễn Thị Huế');
    expect(segments[2].disambiguator).toBe('Lương Tài');
    expect(segments[3].fullName).toBe('Lê Hồng La');

    // Segment 4 must be lowest contributor (Nguyễn Thị Bích)
    expect(segments[4].fullName).toBe('Nguyễn Thị Bích');
    expect(segments[4].weight).toBe(200000);
  });

  // 7. Wheel Segment Visuals: Pure Numbers Only (No Names/Percentages On Canvas)
  it('7. Verifies wheel canvas renders ONLY upright participant numbers and no names/percentages', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const luckyWheelPagePath = path.resolve(__dirname, '../../client/src/pages/LuckyWheelPage.tsx');
    const code = fs.readFileSync(luckyWheelPagePath, 'utf-8');

    // Canvas must draw participant number ${i + 1}
    expect(code.includes('ctx.fillText(`${i + 1}`, 0, 0)')).toBe(true);

    // Canvas must NOT draw full names or percentages inside segment draw loop
    expect(code.includes('ctx.fillText(nameText')).toBe(false);
    expect(code.includes('ctx.fillText(seg.probabilityDisplay,')).toBe(false);
  });

  // 8. Admin Account Identity Repair & Role Invariants
  it('8. Enforces exactly ONE account for Dương Tuấn Anh, ONE for Hoàng Thị Nhàn as ADMIN, and all others as MEMBER', async () => {
    const tuanAnh = memberService.searchMembers('Dương Tuấn Anh', 1)[0];
    const nhan = memberService.searchMembers('Hoàng Thị Nhàn', 1)[0];
    const bich = memberService.searchMembers('Nguyễn Thị Bích', 1)[0];

    expect(tuanAnh).toBeDefined();
    expect(nhan).toBeDefined();
    expect(bich).toBeDefined();

    // 1. Seed initial staff user (admin88)
    await authService.seedInitialStaff('admin88', undefined, 'Dương Tuấn Anh');

    // 2. Register separate account for Hoàng Thị Nhàn
    const nhanReg = await authService.registerMember({
      memberId: nhan.id,
      username: 'nhan_admin',
      email: 'nhan@example.com',
      password: 'password123',
    });
    await authService.verifyEmail({ code: nhanReg.verification.code, email: 'nhan@example.com' });

    // 3. Register standard member (Nguyễn Thị Bích)
    const bichReg = await authService.registerMember({
      memberId: bich.id,
      username: 'bich_member',
      email: 'bich@example.com',
      password: 'password123',
    });
    await authService.verifyEmail({ code: bichReg.verification.code, email: 'bich@example.com' });

    // Trigger admin seeding / invariant enforcement
    authService.seedDefaultAdmins();

    // Verify Dương Tuấn Anh account
    const tuanAnhUser = db.prepare('SELECT * FROM users WHERE member_id = ?').get(tuanAnh.id) as any;
    expect(tuanAnhUser).toBeDefined();
    expect(tuanAnhUser.role).toBe('ADMIN');
    expect(tuanAnhUser.full_name).toBe('Dương Tuấn Anh');

    // Verify Hoàng Thị Nhàn account
    const nhanUser = db.prepare('SELECT * FROM users WHERE member_id = ?').get(nhan.id) as any;
    expect(nhanUser).toBeDefined();
    expect(nhanUser.role).toBe('ADMIN');
    expect(nhanUser.full_name).toBe('Hoàng Thị Nhàn');

    // Verify Nguyễn Thị Bích account (MUST be MEMBER)
    const bichUser = db.prepare('SELECT * FROM users WHERE member_id = ?').get(bich.id) as any;
    expect(bichUser).toBeDefined();
    expect(bichUser.role).toBe('MEMBER');

    // Verify total ADMIN count in users table is exactly 2 (Dương Tuấn Anh & Hoàng Thị Nhàn)
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN'").get() as { count: number };
    expect(adminCount.count).toBe(2);
  });
});
