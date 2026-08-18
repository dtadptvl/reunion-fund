import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { ActivityService } from '../../server/src/services/activity.service.js';
import { MockEmailProvider } from '../../server/src/providers/email/mock-email-provider.js';
import { buildApp } from '../../server/src/app.js';
import supertest from 'supertest';

describe('V2 Phase 2 — Reunion Invitation & Activity RSVP', () => {
  let db: Database.Database;
  let mockEmailProvider: MockEmailProvider;
  let authService: AuthService;
  let memberService: MemberService;
  let activityService: ActivityService;
  let app: any;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    mockEmailProvider = new MockEmailProvider();
    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    authService = new AuthService(db, mockEmailProvider);
    activityService = new ActivityService(db);

    app = buildApp({
      db,
      emailProvider: mockEmailProvider,
    });
    await app.ready();
  });

  it('verifies the 4 initial activities are seeded with correct titles and order', () => {
    const activities = activityService.getActivities();
    expect(activities).toHaveLength(4);
    expect(activities.map((a) => a.title)).toEqual([
      'Về trường tặng quà',
      'Về nhà tặng quà cô giáo',
      'Ăn uống',
      'Vui chơi sau ăn',
    ]);
  });

  it('allows a member to RSVP with different participant counts and retrieves public summary', async () => {
    const members = memberService.searchMembers('Bích', 10);
    const bich = members.find((m) => m.full_name === 'Nguyễn Thị Bích')!;
    expect(bich).toBeDefined();

    // Register & activate member account
    const reg = await authService.registerMember({
      memberId: bich.id,
      username: 'bich_member',
      email: 'bich@example.com',
      password: 'password123',
    });
    await authService.verifyEmail({ token: reg.verification.token });

    // Save RSVPs: 1 for 've-truong', 3 for 'an-uong'
    const rsvpResult = activityService.saveMemberRsvps(
      bich.id,
      reg.user.id,
      [
        { activityId: 've-truong', participantCount: 1 },
        { activityId: 'an-uong', participantCount: 3, notes: 'Đi cùng gia đình' },
      ],
      'bich_member'
    );
    expect(rsvpResult.success).toBe(true);

    // Check member's own RSVPs
    const memberRsvps = activityService.getMemberRsvps(bich.id);
    expect(memberRsvps).toHaveLength(2);

    // Check public summary
    const pubSummary = activityService.getPublicActivitySummaries();
    expect(pubSummary.isLocked).toBe(false);

    const anUong = pubSummary.activities.find((a) => a.id === 'an-uong')!;
    expect(anUong.total_participants).toBe(3);
    expect(anUong.participants).toHaveLength(1);
    expect(anUong.participants[0].full_name).toBe('Nguyễn Thị Bích');
    expect(anUong.participants[0].participant_count).toBe(3);

    // Ensure username and email are not in public response
    const pubJsonStr = JSON.stringify(pubSummary);
    expect(pubJsonStr).not.toContain('bich@example.com');
    expect(pubJsonStr).not.toContain('bich_member');
  });

  it('enforces positive integer for participant count', async () => {
    const duong = memberService.searchMembers('Đỗ Thuỳ Dương', 10)[0];

    const reg = await authService.registerMember({
      memberId: duong.id,
      username: 'duong_member',
      email: 'duong@example.com',
      password: 'password123',
    });

    expect(() => {
      activityService.saveMemberRsvps(
        duong.id,
        reg.user.id,
        [{ activityId: 'an-uong', participantCount: 0 }],
        'duong_member'
      );
    }).toThrow(/số nguyên dương/i);

    expect(() => {
      activityService.saveMemberRsvps(
        duong.id,
        reg.user.id,
        [{ activityId: 'an-uong', participantCount: -2 }],
        'duong_member'
      );
    }).toThrow(/số nguyên dương/i);
  });

  it('HTTP flow: Member RSVP, Admin lock/reopen, and 403 authorization enforcement', async () => {
    const bich = memberService.searchMembers('Nguyễn Thị Bích', 10).find((m) => m.full_name === 'Nguyễn Thị Bích')!;
    const nhan = memberService.searchMembers('Hoàng Thị Nhàn', 10).find((m) => m.full_name === 'Hoàng Thị Nhàn')!;

    // 1. Register Member (Nguyễn Thị Bích)
    await supertest(app.server).post('/api/v1/auth/register').send({
      memberId: bich.id,
      username: 'bich_a1',
      email: 'bich_a1@example.com',
      password: 'password123',
    });
    const bichEmail = mockEmailProvider.getLatestEmailFor('bich_a1@example.com')!;
    await supertest(app.server).post('/api/v1/auth/verify-email').send({ token: bichEmail.token });

    const memberLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'bich_a1',
      password: 'password123',
    });
    const memberCookie = memberLogin.headers['set-cookie'];

    // 2. Register ADMIN (Hoàng Thị Nhàn)
    await supertest(app.server).post('/api/v1/auth/register').send({
      memberId: nhan.id,
      username: 'nhan_admin_rsvp',
      email: 'nhan_admin_rsvp@example.com',
      password: 'adminpassword123',
    });
    const adminEmail = mockEmailProvider.getLatestEmailFor('nhan_admin_rsvp@example.com')!;
    await supertest(app.server).post('/api/v1/auth/verify-email').send({ token: adminEmail.token });

    const adminLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'nhan_admin_rsvp',
      password: 'adminpassword123',
    });
    const adminCookie = adminLogin.headers['set-cookie'];

    // 3. Member submits RSVP (ve-truong: 1, an-uong: 2)
    const saveRes = await supertest(app.server)
      .post('/api/v1/auth/rsvps')
      .set('Cookie', memberCookie)
      .send({
        rsvps: [
          { activityId: 've-truong', participantCount: 1 },
          { activityId: 'an-uong', participantCount: 2 },
        ],
      });
    expect(saveRes.status).toBe(200);
    expect(saveRes.body.success).toBe(true);

    // 4. Public endpoint reflects RSVPs
    const pubRes = await supertest(app.server).get('/api/v1/public/activities');
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.isLocked).toBe(false);
    const pubAnUong = pubRes.body.activities.find((a: any) => a.id === 'an-uong');
    expect(pubAnUong.total_participants).toBe(2);

    // 5. MEMBER attempts to call Admin Lock endpoint -> 403 FORBIDDEN
    const forbiddenLock = await supertest(app.server)
      .post('/api/v1/admin/rsvps/lock')
      .set('Cookie', memberCookie)
      .send({ isLocked: true });
    expect(forbiddenLock.status).toBe(403);

    // 6. ADMIN locks registration
    const adminLockRes = await supertest(app.server)
      .post('/api/v1/admin/rsvps/lock')
      .set('Cookie', adminCookie)
      .send({ isLocked: true });
    expect(adminLockRes.status).toBe(200);
    expect(adminLockRes.body.isLocked).toBe(true);

    // 7. MEMBER tries to update RSVP while locked -> 400 Bad Request
    const lockedSaveRes = await supertest(app.server)
      .post('/api/v1/auth/rsvps')
      .set('Cookie', memberCookie)
      .send({
        rsvps: [{ activityId: 've-truong', participantCount: 2 }],
      });
    expect(lockedSaveRes.status).toBe(400);
    expect(lockedSaveRes.body.error).toContain('đã bị khóa');

    // 8. ADMIN views registration overview
    const adminOverviewRes = await supertest(app.server)
      .get('/api/v1/admin/rsvps')
      .set('Cookie', adminCookie);
    expect(adminOverviewRes.status).toBe(200);
    expect(adminOverviewRes.body.isLocked).toBe(true);
    expect(adminOverviewRes.body.totalDistinctMembers).toBe(1);

    // 9. ADMIN reopens registration
    const adminReopenRes = await supertest(app.server)
      .post('/api/v1/admin/rsvps/lock')
      .set('Cookie', adminCookie)
      .send({ isLocked: false });
    expect(adminReopenRes.status).toBe(200);
    expect(adminReopenRes.body.isLocked).toBe(false);

    // 10. MEMBER updates RSVP again successfully after reopen
    const reopenSaveRes = await supertest(app.server)
      .post('/api/v1/auth/rsvps')
      .set('Cookie', memberCookie)
      .send({
        rsvps: [
          { activityId: 've-truong', participantCount: 1 },
          { activityId: 'an-uong', participantCount: 4 },
          { activityId: 'vui-choi', participantCount: 2 },
        ],
      });
    expect(reopenSaveRes.status).toBe(200);
    expect(reopenSaveRes.body.success).toBe(true);

    // Verify updated public list
    const finalPubRes = await supertest(app.server).get('/api/v1/public/activities');
    const finalAnUong = finalPubRes.body.activities.find((a: any) => a.id === 'an-uong');
    expect(finalAnUong.total_participants).toBe(4);

    // 11. Verify audit logs recorded correctly in canonical audit_logs table
    const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY timestamp ASC').all() as any[];
    const rsvpLogs = auditLogs.filter((l) => l.action === 'SAVE_ACTIVITY_RSVP');
    const lockLogs = auditLogs.filter((l) => l.action === 'LOCK_ACTIVITY_RSVP');
    const unlockLogs = auditLogs.filter((l) => l.action === 'UNLOCK_ACTIVITY_RSVP');

    expect(rsvpLogs.length).toBeGreaterThanOrEqual(2);
    expect(rsvpLogs[0].actor).toBe('bich_a1');
    expect(rsvpLogs[0].entity_type).toBe('MEMBER');
    expect(rsvpLogs[0].entity_id).toBe(bich.id);

    expect(lockLogs).toHaveLength(1);
    expect(lockLogs[0].actor).toBe('nhan_admin_rsvp');
    expect(lockLogs[0].entity_type).toBe('SYSTEM_STATE');
    expect(lockLogs[0].entity_id).toBe('is_rsvp_locked');

    expect(unlockLogs).toHaveLength(1);
    expect(unlockLogs[0].actor).toBe('nhan_admin_rsvp');
  });
});
