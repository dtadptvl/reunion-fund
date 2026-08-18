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

  it('1. Excludes 0-VND members and builds correct proportional wheel segments', async () => {
    const members = memberService.searchMembers('', 10);
    const m1 = members[0]; // 500k
    const m2 = members[1]; // 1,500k
    // members[2] has 0 VND -> must NOT appear on wheel

    insertContribution(db, m1.id, 500000);
    insertContribution(db, m2.id, 1500000);
    const { segments, totalWeight } = lotteryService.getWheelSegments(new Set());
    expect(totalWeight).toBe(2000000);
    expect(segments).toHaveLength(2);

    const seg1 = segments.find((s) => s.memberId === m1.id)!;
    const seg2 = segments.find((s) => s.memberId === m2.id)!;

    expect(seg2.weight).toBe(1500000);
    expect(seg2.probability).toBe(75);
    expect(seg2.probabilityDisplay).toBe('75,00%');
    expect(seg2.startAngle).toBe(0);
    expect(seg2.endAngle).toBe(270);

    expect(seg1.weight).toBe(500000);
    expect(seg1.probability).toBe(25);
    expect(seg1.probabilityDisplay).toBe('25,00%');
    expect(seg1.startAngle).toBe(270);
    expect(seg1.endAngle).toBe(360);
  });

  it('2. Enforces strict draw order: Giải Ba -> Giải Nhì -> Giải Nhất', async () => {
    const members = memberService.searchMembers('', 5);
    members.slice(0, 4).forEach((m) => {
      insertContribution(db, m.id, 500000);
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

    // Now drawing Giải Nhất succeeds
    const drawNhat = lotteryService.triggerDraw('giai-nhat', 'admin');
    expect(drawNhat.prize_id).toBe('giai-nhat');
    expect(drawNhat.duration_seconds).toBe(35);

    // All 3 drawn -> completed
    const completed = lotteryService.getCompletedDraws();
    expect(completed).toHaveLength(3);
  });

  it('3. Automatically excludes previous winners from subsequent prize pools', async () => {
    const members = memberService.searchMembers('', 4);
    const m1 = members[0];
    const m2 = members[1];
    const m3 = members[2];

    insertContribution(db, m1.id, 500000);
    insertContribution(db, m2.id, 500000);
    insertContribution(db, m3.id, 500000);

    // Initial pool: 3 members
    const initialSegments = lotteryService.getWheelSegments(new Set()).segments;
    expect(initialSegments).toHaveLength(3);

    // Draw Giải Ba
    const drawBa = lotteryService.triggerDraw('giai-ba', 'admin');
    const winnerBaId = drawBa.winner_member_id;

    // Remaining pool for Giải Nhì must exclude winner of Giải Ba
    const secondSegments = lotteryService.getWheelSegments(new Set([winnerBaId])).segments;
    expect(secondSegments).toHaveLength(2);
    expect(secondSegments.some((s) => s.memberId === winnerBaId)).toBe(false);
    expect(secondSegments.reduce((sum, s) => sum + s.probability, 0)).toBe(100);

    // Draw Giải Nhì
    const drawNhi = lotteryService.triggerDraw('giai-nhi', 'admin');
    const winnerNhiId = drawNhi.winner_member_id;
    expect(winnerNhiId).not.toBe(winnerBaId);

    // Remaining pool for Giải Nhất must have exactly 1 member
    const thirdSegments = lotteryService.getWheelSegments(new Set([winnerBaId, winnerNhiId])).segments;
    expect(thirdSegments).toHaveLength(1);
    expect(thirdSegments[0].probability).toBe(100);
    expect(thirdSegments[0].probabilityDisplay).toBe('100,00%');
  });

  it('4. Uses CSPRNG and correctly computes deterministic target angle on wheel circle', async () => {
    const members = memberService.searchMembers('', 3);
    insertContribution(db, members[0].id, 1000000); // 50%
    insertContribution(db, members[1].id, 1000000); // 50%

    const draw = lotteryService.triggerDraw('giai-ba', 'admin');
    const state = lotteryService.getPublicWheelState();
    expect(state.activeDraw).toBeDefined();
    expect(state.activeDraw?.targetAngle).toBeGreaterThanOrEqual(0);
    expect(state.activeDraw?.targetAngle).toBeLessThanOrEqual(360);

    const winnerMemberId = draw.winner_member_id;
    const segments = lotteryService.getWheelSegments(new Set()).segments;
    const winnerSeg = segments.find((s) => s.memberId === winnerMemberId)!;

    // Target angle must fall strictly within winner's segment bounds
    expect(state.activeDraw?.targetAngle).toBeGreaterThanOrEqual(winnerSeg.startAngle);
    expect(state.activeDraw?.targetAngle).toBeLessThanOrEqual(winnerSeg.endAngle);
  });

  it('5. RBAC & HTTP API: Guest/Member cannot trigger draw (401/403), Admin can trigger (200), Public can read state', async () => {
    const members = memberService.searchMembers('', 40);
    members.slice(0, 4).forEach((m) => {
      insertContribution(db, m.id, 500000);
    });

    // 1. Unauthenticated request to draw -> 401
    const unauthRes = await supertest(app.server).post('/api/v1/admin/lottery/draw').send({ prizeId: 'giai-ba' });
    expect(unauthRes.status).toBe(401);

    // 2. Member request to draw -> 403
    const normalMember = members.find((m) => m.full_name === 'Nguyễn Thị Bích') || members[0];
    await authService.registerMember({ memberId: normalMember.id, username: 'bich_usr', email: 'bich@example.com', password: 'password123' });
    await authService.verifyEmail({ token: mockEmailProvider.getLatestEmailFor('bich@example.com')!.token });
    const memberLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'bich_usr',
      password: 'password123',
    });
    const memberCookie = memberLogin.headers['set-cookie'];

    const memberRes = await supertest(app.server)
      .post('/api/v1/admin/lottery/draw')
      .set('Cookie', memberCookie)
      .send({ prizeId: 'giai-ba' });
    expect(memberRes.status).toBe(403);

    // 3. Admin request to draw -> 200
    const nhan = members.find((m) => m.full_name === 'Hoàng Thị Nhàn')!;
    await authService.registerMember({ memberId: nhan.id, username: 'nhan_adm', email: 'adm@example.com', password: 'password123' });
    await authService.verifyEmail({ token: mockEmailProvider.getLatestEmailFor('adm@example.com')!.token });
    const adminLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'nhan_adm',
      password: 'password123',
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
    expect(audit.actor).toBe('nhan_adm');
    expect(audit.entity_id).toBe('giai-ba');
  });

  it('6. Background Music: Streams persistent audio asset and handles missing music gracefully', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const audioDir = path.join(lotteryService.storageDir, 'audio');
    if (fs.existsSync(audioDir)) {
      fs.readdirSync(audioDir).forEach((f) => {
        try { fs.unlinkSync(path.join(audioDir, f)); } catch { /* ignore */ }
      });
    }

    // 1. Initial music request when no file on disk -> 404
    const initRes = await supertest(app.server).get('/api/v1/public/lottery/background-music');
    expect(initRes.status).toBe(404);

    // 2. When persistent audio exists in storage, public can stream it
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    
    const mp3Buffer = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(100)]);
    fs.writeFileSync(path.join(audioDir, 'lottery_bgm.mp3'), mp3Buffer);

    // 3. Public can stream audio
    const streamRes = await supertest(app.server).get('/api/v1/public/lottery/background-music');
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers['content-type']).toBe('audio/mpeg');

    // 4. Public wheel state reports hasBackgroundMusic: true
    const stateRes = await supertest(app.server).get('/api/v1/public/lottery/wheel-state');
    expect(stateRes.status).toBe(200);
    expect(stateRes.body.hasBackgroundMusic).toBe(true);

    // Clean up test file
    try {
      fs.unlinkSync(path.join(audioDir, 'lottery_bgm.mp3'));
    } catch { /* ignore */ }
  });

  it('7. Official Admin Lottery Reset: deletes draw history and audits reset without touching contributions', async () => {
    const members = memberService.searchMembers('', 5);
    members.slice(0, 3).forEach((m) => {
      insertContribution(db, m.id, 500000);
    });

    // Draw Giải Ba
    lotteryService.triggerDraw('giai-ba', 'admin');
    expect(lotteryService.getCompletedDraws()).toHaveLength(1);

    // Official Admin Reset -> succeeds
    lotteryService.resetLotteryState('admin_tester');

    expect(lotteryService.getCompletedDraws()).toHaveLength(0);

    // Contributions preserved
    const totalContributed = db.prepare('SELECT SUM(amount) as total FROM contributions').get() as { total: number };
    expect(totalContributed.total).toBe(1500000);

    // Audit log created
    const resetAudit = db.prepare("SELECT * FROM audit_logs WHERE action = 'RESET_LUCKY_WHEEL'").get() as any;
    expect(resetAudit).toBeDefined();
    expect(resetAudit.actor).toBe('admin_tester');
  });

  it('8. Verifies persistent music survives lottery reset and completed state transitions cleanly', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const audioDir = path.join(lotteryService.storageDir, 'audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    
    const mp3Buffer = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(100)]);
    fs.writeFileSync(path.join(audioDir, 'lottery_bgm.mp3'), mp3Buffer);

    const members = memberService.searchMembers('', 5);
    members.slice(0, 4).forEach((m) => {
      insertContribution(db, m.id, 500000);
    });

    // 1. Draw all 3 prizes
    lotteryService.triggerDraw('giai-ba', 'admin');
    lotteryService.triggerDraw('giai-nhi', 'admin');
    lotteryService.triggerDraw('giai-nhat', 'admin');

    // Simulate elapsed spin duration for Giải Nhất
    db.prepare("UPDATE lucky_wheel_draws SET started_at = datetime('now', '-40 seconds') WHERE prize_id = 'giai-nhat'").run();

    const finishedState = lotteryService.getPublicWheelState();
    expect(finishedState.status).toBe('FINISHED');
    expect(finishedState.nextPrize).toBeNull();
    expect(finishedState.completedPrizes).toHaveLength(3);
    expect(finishedState.hasBackgroundMusic).toBe(true);

    // 2. Perform official admin reset
    lotteryService.resetLotteryState('admin_tester');

    const resetState = lotteryService.getPublicWheelState();
    expect(resetState.status).toBe('IDLE');
    expect(resetState.completedPrizes).toHaveLength(0);
    expect(resetState.nextPrize?.prizeId).toBe('giai-ba');
    expect(resetState.nextPrize?.prizeTitle).toBe('Giải Ba');
    expect(resetState.hasBackgroundMusic).toBe(true); // Music remains preserved!

    // Cleanup
    try {
      fs.unlinkSync(path.join(audioDir, 'lottery_bgm.mp3'));
    } catch { /* ignore */ }
  });
});

