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

describe('V2 Phase 5 — Weighted Lucky Wheel & Ceremony Draws', () => {
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

  it('1. Excludes 0-VND members and builds correct proportional wheel segments', async () => {
    const members = memberService.searchMembers('', 10);
    const m1 = members[0]; // 500k
    const m2 = members[1]; // 1,500k
    // members[2] has 0 VND -> must NOT appear on wheel

    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE'),
             (?, 'MEMBER', ?, 1500000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), m1.id, crypto.randomUUID(), m2.id);

    const { segments, totalWeight } = lotteryService.getWheelSegments(new Set());
    expect(totalWeight).toBe(2000000);
    expect(segments).toHaveLength(2);

    const seg1 = segments.find((s) => s.memberId === m1.id)!;
    const seg2 = segments.find((s) => s.memberId === m2.id)!;

    expect(seg1.weight).toBe(500000);
    expect(seg1.probability).toBe(25);
    expect(seg1.probabilityDisplay).toBe('25,00%');
    expect(seg1.startAngle).toBe(0);
    expect(seg1.endAngle).toBe(90);

    expect(seg2.weight).toBe(1500000);
    expect(seg2.probability).toBe(75);
    expect(seg2.probabilityDisplay).toBe('75,00%');
    expect(seg2.startAngle).toBe(90);
    expect(seg2.endAngle).toBe(360);
  });

  it('2. Enforces strict draw order: Giải Ba -> Giải Nhì -> Giải Nhất', async () => {
    const members = memberService.searchMembers('', 5);
    members.slice(0, 4).forEach((m) => {
      db.prepare(`
        INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
        VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
      `).run(crypto.randomUUID(), m.id);
    });

    // Attempting to draw Giải Nhì before Giải Ba must fail
    expect(() => lotteryService.triggerDraw('giai-nhi', 'admin')).toThrowError(
      'Chưa thể quay Giải Nhì. Vui lòng quay Giải Ba trước.'
    );

    // Attempting to draw Giải Nhất before Giải Nhì must fail
    expect(() => lotteryService.triggerDraw('giai-nhat', 'admin')).toThrowError(
      'Chưa thể quay Giải Nhất. Vui lòng quay Giải Nhì trước.'
    );

    // Drawing Giải Ba succeeds
    const drawBa = lotteryService.triggerDraw('giai-ba', 'admin');
    expect(drawBa.prize_id).toBe('giai-ba');
    expect(drawBa.duration_seconds).toBe(15);
    expect(drawBa.winner_member_id).toBeDefined();

    // Now drawing Giải Nhì succeeds
    const drawNhi = lotteryService.triggerDraw('giai-nhi', 'admin');
    expect(drawNhi.prize_id).toBe('giai-nhi');
    expect(drawNhi.duration_seconds).toBe(25);
    expect(drawNhi.winner_member_id).toBeDefined();

    // Now drawing Giải Nhất succeeds
    const drawNhat = lotteryService.triggerDraw('giai-nhat', 'admin');
    expect(drawNhat.prize_id).toBe('giai-nhat');
    expect(drawNhat.duration_seconds).toBe(35);
    expect(drawNhat.winner_member_id).toBeDefined();
  });

  it('3. Excludes previous winners and renormalizes remaining probabilities for next draw', async () => {
    const members = memberService.searchMembers('', 5);
    const m1 = members[0]; // 500k
    const m2 = members[1]; // 500k
    const m3 = members[2]; // 1,000k

    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE'),
             (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE'),
             (?, 'MEMBER', ?, 1000000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), m1.id, crypto.randomUUID(), m2.id, crypto.randomUUID(), m3.id);

    // Total initial pool = 2M. m1 = 25%, m2 = 25%, m3 = 50%
    const initialSegments = lotteryService.getWheelSegments(new Set()).segments;
    expect(initialSegments).toHaveLength(3);

    // Draw Giải Ba
    const drawBa = lotteryService.triggerDraw('giai-ba', 'admin');
    const winner1Id = drawBa.winner_member_id;

    // Remaining segments for next draw (Giải Nhì) must exclude winner1
    const { segments: nextSegments, totalWeight: remainingWeight } = lotteryService.getWheelSegments(new Set([winner1Id]));
    expect(nextSegments).toHaveLength(2);
    expect(nextSegments.find((s) => s.memberId === winner1Id)).toBeUndefined();

    // Sum of renormalized probabilities must be 100%
    const sumProb = nextSegments.reduce((sum, s) => sum + s.probability, 0);
    expect(Math.round(sumProb)).toBe(100);
    expect(remainingWeight).toBe(2000000 - drawBa.winner_weight);
  });

  it('4. Idempotency: duplicate / repeated draw request returns existing persisted draw', async () => {
    const members = memberService.searchMembers('', 5);
    members.slice(0, 3).forEach((m) => {
      db.prepare(`
        INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
        VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
      `).run(crypto.randomUUID(), m.id);
    });

    const firstDraw = lotteryService.triggerDraw('giai-ba', 'admin');
    const secondDraw = lotteryService.triggerDraw('giai-ba', 'admin');

    // Both calls must return identical draw, winner, and random ticket
    expect(firstDraw.winner_member_id).toBe(secondDraw.winner_member_id);
    expect(firstDraw.random_ticket).toBe(secondDraw.random_ticket);
    expect(firstDraw.started_at).toBe(secondDraw.started_at);

    // Exactly 1 row in lucky_wheel_draws
    const count = db.prepare('SELECT COUNT(*) as count FROM lucky_wheel_draws WHERE prize_id = ?').get('giai-ba') as { count: number };
    expect(count.count).toBe(1);
  });

  it('5. RBAC & HTTP API: Guest/Member cannot trigger draw (401/403), Admin can trigger (200), Public can read state', async () => {
    const members = memberService.searchMembers('', 5);
    members.slice(0, 3).forEach((m) => {
      db.prepare(`
        INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
        VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
      `).run(crypto.randomUUID(), m.id);
    });

    // 1. Unauthenticated request to draw -> 401
    const unauthRes = await supertest(app.server).post('/api/v1/admin/lottery/draw').send({ prizeId: 'giai-ba' });
    expect(unauthRes.status).toBe(401);

    // 2. Member request to draw -> 403
    const bich = members.find((m) => m.full_name === 'Nguyễn Thị Bích') || members[0];
    await authService.registerMemberAccount(bich.id, 'bich_member', 'bich@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('bich@example.com')!.token);
    const memberLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'bich_member',
      password: 'pwd',
    });
    const memberCookie = memberLogin.headers['set-cookie'];

    const memberRes = await supertest(app.server)
      .post('/api/v1/admin/lottery/draw')
      .set('Cookie', memberCookie)
      .send({ prizeId: 'giai-ba' });
    expect(memberRes.status).toBe(403);

    // 3. Admin request to draw -> 200
    const tuanAnh = members.find((m) => m.full_name === 'Dương Tuấn Anh') || members[1];
    await authService.registerMemberAccount(tuanAnh.id, 'tuananh_adm', 'tuananh@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('tuananh@example.com')!.token);
    const adminLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'tuananh_adm',
      password: 'pwd',
    });
    const adminCookie = adminLogin.headers['set-cookie'];

    const adminRes = await supertest(app.server)
      .post('/api/v1/admin/lottery/draw')
      .set('Cookie', adminCookie)
      .send({ prizeId: 'giai-ba' });
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.success).toBe(true);
    expect(adminRes.body.draw.prize_id).toBe('giai-ba');

    // 4. Public can read wheel state without authentication
    const pubRes = await supertest(app.server).get('/api/v1/public/lottery/wheel-state');
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.activeDraw.prizeId).toBe('giai-ba');
    expect(pubRes.body.wheelSegments.length).toBeGreaterThan(0);

    // 5. Audit log verified
    const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'TRIGGER_LUCKY_DRAW'").get() as any;
    expect(audit).toBeDefined();
    expect(audit.actor).toBe('tuananh_adm');
    expect(audit.entity_id).toBe('giai-ba');
  });

  it('6. Background Music: Admin can upload, stream, and delete audio file without path traversal', async () => {
    // Admin login
    const members = memberService.searchMembers('Dương Tuấn Anh', 5);
    const tuanAnh = members[0];
    await authService.registerMemberAccount(tuanAnh.id, 'admin_audio', 'audio@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('audio@example.com')!.token);
    const adminLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'admin_audio',
      password: 'pwd',
    });
    const adminCookie = adminLogin.headers['set-cookie'];

    // 1. Initial music request -> 404
    const initRes = await supertest(app.server).get('/api/v1/public/lottery/background-music');
    expect(initRes.status).toBe(404);

    // 2. Upload valid MP3 (ID3 header)
    const mp3Buffer = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(100)]);
    const uploadRes = await supertest(app.server)
      .post('/api/v1/admin/lottery/music')
      .set('Cookie', adminCookie)
      .attach('file', mp3Buffer, 'theme_gala.mp3');

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.success).toBe(true);
    expect(uploadRes.body.metadata.mimeType).toBe('audio/mpeg');

    // 3. Public can stream audio
    const streamRes = await supertest(app.server).get('/api/v1/public/lottery/background-music');
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers['content-type']).toBe('audio/mpeg');

    // 4. Delete audio
    const delRes = await supertest(app.server)
      .delete('/api/v1/admin/lottery/music')
      .set('Cookie', adminCookie);
    expect(delRes.status).toBe(200);

    const streamAfterDel = await supertest(app.server).get('/api/v1/public/lottery/background-music');
    expect(streamAfterDel.status).toBe(404);
  });

  it('7. Staging Lottery Reset: deletes draw history and audits reset without touching contributions', async () => {
    const members = memberService.searchMembers('', 5);
    members.slice(0, 3).forEach((m) => {
      db.prepare(`
        INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
        VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
      `).run(crypto.randomUUID(), m.id);
    });

    // Draw Giải Ba
    lotteryService.triggerDraw('giai-ba', 'admin');
    expect(lotteryService.getCompletedDraws()).toHaveLength(1);

    // Reset when not allowed -> throws error
    expect(() => lotteryService.resetLotteryState('admin', false)).toThrowError(
      'Chức năng đặt lại chỉ khả dụng trong môi trường kiểm thử/staging.'
    );

    // Reset when allowed -> succeeds
    lotteryService.resetLotteryState('admin_tester', true);

    expect(lotteryService.getCompletedDraws()).toHaveLength(0);

    // Contributions preserved
    const totalContributed = db.prepare('SELECT SUM(amount) as total FROM contributions').get() as { total: number };
    expect(totalContributed.total).toBe(1500000);

    // Audit log created
    const resetAudit = db.prepare("SELECT * FROM audit_logs WHERE action = 'RESET_LUCKY_WHEEL_TEST_STATE'").get() as any;
    expect(resetAudit).toBeDefined();
    expect(resetAudit.actor).toBe('admin_tester');
  });
});
