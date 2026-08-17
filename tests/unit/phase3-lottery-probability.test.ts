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

describe('V2 Phase 3 — Personalized Contribution & Lottery Probability UI', () => {
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

  it('1. verifies configurable base fund exclusion setting defaults to 6,000,000 VND', () => {
    const baseFund = lotteryService.getBaseFundExclusion();
    expect(baseFund).toBe(6000000);

    // Can be updated via setting
    lotteryService.setBaseFundExclusion(8000000);
    expect(lotteryService.getBaseFundExclusion()).toBe(8000000);
  });

  it('2. verifies 0 contribution produces 0% probability and eligible pool is 0 when no contributions exist', () => {
    const members = memberService.searchMembers('Bích', 10);
    const bich = members.find((m) => m.full_name === 'Nguyễn Thị Bích')!;

    const stats = lotteryService.getMemberPersonalStats(bich.id);
    expect(stats.totalContributed).toBe(0);
    expect(stats.lotteryProbability).toBe(0);
    expect(stats.lotteryProbabilityDisplay).toBe('0%');
    expect(stats.isLotteryEligible).toBe(false);
    expect(stats.eligiblePool).toBe(0);
  });

  it('3. maps member contributions by immutable member_id, aggregates multiple transactions, and calculates probabilities summing to ~100%', () => {
    const members = memberService.searchMembers('', 100);
    const member1 = members[0]; // e.g. Tuấn Anh
    const member2 = members[1];
    const member3 = members[2];

    // Insert multiple contributions for member 1 (500k + 500k = 1,000,000)
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE'),
             (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), member1.id, crypto.randomUUID(), member1.id);

    // Insert 1 contribution for member 2 (2,000,000)
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 2000000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), member2.id);

    // Insert 1 contribution for member 3 (1,000,000)
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 1000000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), member3.id);

    // Also insert an external contributor contribution (500k) - must NOT be in eligible member pool
    const extId = crypto.randomUUID();
    db.prepare("INSERT INTO external_contributors (id, raw_name, display_name) VALUES (?, 'Nguoi Ngoai', 'Người Ngoài')").run(extId);
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, external_contributor_id, amount, match_method)
      VALUES (?, 'EXTERNAL', ?, 500000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), extId);

    // Total member eligible pool = 1M + 2M + 1M = 4,000,000
    const pool = lotteryService.getEligibleMemberPool();
    expect(pool).toBe(4000000);

    // Member 1 stats: 1M / 4M = 25.00%
    const stats1 = lotteryService.getMemberPersonalStats(member1.id);
    expect(stats1.totalContributed).toBe(1000000);
    expect(stats1.lotteryProbability).toBe(25.0);
    expect(stats1.lotteryProbabilityDisplay).toBe('25,00%');
    expect(stats1.isLotteryEligible).toBe(true);

    // Member 2 stats: 2M / 4M = 50.00%
    const stats2 = lotteryService.getMemberPersonalStats(member2.id);
    expect(stats2.totalContributed).toBe(2000000);
    expect(stats2.lotteryProbability).toBe(50.0);
    expect(stats2.lotteryProbabilityDisplay).toBe('50,00%');

    // Member 3 stats: 1M / 4M = 25.00%
    const stats3 = lotteryService.getMemberPersonalStats(member3.id);
    expect(stats3.totalContributed).toBe(1000000);
    expect(stats3.lotteryProbability).toBe(25.0);

    // Non-contributing member stats: 0%
    const nonContributedMember = members[3];
    const statsNon = lotteryService.getMemberPersonalStats(nonContributedMember.id);
    expect(statsNon.totalContributed).toBe(0);
    expect(statsNon.lotteryProbability).toBe(0);
    expect(statsNon.lotteryProbabilityDisplay).toBe('0%');

    // Sum of all eligible member probabilities must equal 100%
    const allMembersData = lotteryService.getMembersWithLotteryStats();
    const sumProb = allMembersData.members.reduce((sum, m) => sum + m.lottery_probability, 0);
    expect(Math.round(sumProb)).toBe(100);
  });

  it('4. HTTP API: Public contributors endpoint returns lottery probabilities and formula info', async () => {
    const members = memberService.searchMembers('Nguyễn Thị Bích', 10);
    const bich = members.find((m) => m.full_name === 'Nguyễn Thị Bích')!;

    // Add confirmed contribution for Bich (500k)
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), bich.id);

    const res = await supertest(app.server).get('/api/v1/public/contributors');
    expect(res.status).toBe(200);
    expect(res.body.eligiblePool).toBe(500000);
    expect(res.body.baseFundExclusion).toBe(6000000);
    expect(res.body.formulaDescription).toContain('Tỷ lệ quay thưởng =');
    expect(res.body.baseFundNote).toContain('6.000.000 ₫');

    const bichEntry = res.body.members.find((m: any) => m.id === bich.id);
    expect(bichEntry).toBeDefined();
    expect(bichEntry.total_contributed).toBe(500000);
    expect(bichEntry.lottery_probability).toBe(100.0);
    expect(bichEntry.lottery_probability_display).toBe('100,00%');
    expect(bichEntry.is_lottery_eligible).toBe(true);

    // Canonical given name sorting and disambiguators preserved
    const hues = res.body.members.filter((m: any) => m.full_name === 'Nguyễn Thị Huế');
    expect(hues).toHaveLength(2);
    expect(hues.map((h: any) => h.disambiguator).sort()).toEqual(['Lạc Đạo', 'Lương Tài'].sort());
  });

  it('5. HTTP API: Logged-in MEMBER and ADMIN receive personalized stats, unauthenticated does not', async () => {
    const bich = memberService.searchMembers('Nguyễn Thị Bích', 10).find((m) => m.full_name === 'Nguyễn Thị Bích')!;

    // 1. Unauthenticated request to /api/v1/auth/me returns 401
    const unauthRes = await supertest(app.server).get('/api/v1/auth/me');
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.user).toBeNull();

    // 2. Add contribution for Bich (500k)
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), bich.id);

    // 3. Register & verify Bich account
    await supertest(app.server).post('/api/v1/auth/register').send({
      memberId: bich.id,
      username: 'bich_member',
      email: 'bich@example.com',
      password: 'password123',
    });
    const email = mockEmailProvider.getLatestEmailFor('bich@example.com')!;
    await supertest(app.server).post('/api/v1/auth/verify-email').send({ token: email.token });

    // 4. Login as Bich
    const loginRes = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'bich_member',
      password: 'password123',
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.totalContributed).toBe(500000);
    expect(loginRes.body.user.lotteryProbability).toBe(100.0);
    expect(loginRes.body.user.lotteryProbabilityDisplay).toBe('100,00%');

    const cookie = loginRes.headers['set-cookie'];

    // 5. Query /api/v1/auth/me with session cookie
    const meRes = await supertest(app.server).get('/api/v1/auth/me').set('Cookie', cookie);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.fullName).toContain('Nguyễn Thị Bích');
    expect(meRes.body.user.totalContributed).toBe(500000);
    expect(meRes.body.user.lotteryProbabilityDisplay).toBe('100,00%');
    expect(meRes.body.lottery.eligiblePool).toBe(500000);
    expect(meRes.body.lottery.baseFundExclusion).toBe(6000000);
  });
});
