import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { VotingService } from '../../server/src/services/voting.service.js';
import { MockEmailProvider } from '../../server/src/providers/email/mock-email-provider.js';
import { buildApp } from '../../server/src/app.js';
import supertest from 'supertest';
import crypto from 'crypto';

describe('V2 Phase 4 — Voting & Admin Award Presentation', () => {
  let db: Database.Database;
  let mockEmailProvider: MockEmailProvider;
  let memberService: MemberService;
  let authService: AuthService;
  let votingService: VotingService;
  let app: any;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    mockEmailProvider = new MockEmailProvider();
    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    authService = new AuthService(db, mockEmailProvider);
    votingService = new VotingService(db);

    app = buildApp({
      db,
      emailProvider: mockEmailProvider,
    });
    await app.ready();
  });

  it('1. verifies canonical 3 categories are seeded in correct display order', () => {
    const categories = votingService.getCategories();
    expect(categories).toHaveLength(3);
    expect(categories.map((c) => c.id)).toEqual([
      'dang-quy-nhat',
      'gia-dinh-vien-man',
      'su-nghiep-an-tuong',
    ]);
    expect(categories[0].title).toBe('Người bạn cùng lớp đáng quý nhất');
    expect(categories[1].title).toBe('Gia đình viên mãn nhất');
    expect(categories[2].title).toBe('Sự nghiệp ấn tượng nhất');
  });

  it('2. allows casting 1 vote per category, updates without duplicate rows', async () => {
    const members = memberService.searchMembers('', 10);
    const voter = members[0];
    const candidateA = members[1];
    const candidateB = members[2];

    // Register & verify voter account
    await authService.registerMemberAccount(voter.id, 'voter1', 'voter1@example.com', 'password123');
    const token = mockEmailProvider.getLatestEmailFor('voter1@example.com')!.token;
    await authService.verifyEmailToken(token);
    const user = (await authService.authenticate('voter1', 'password123')).user!;

    // Cast vote for dang-quy-nhat -> candidateA
    votingService.castVotes(
      user.id,
      voter.id,
      [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateA.id }],
      'voter1'
    );

    let userVotes = votingService.getUserVotes(user.id);
    expect(userVotes['dang-quy-nhat']).toBe(candidateA.id);

    // Total rows in votes table for dang-quy-nhat must be 1
    const count1 = db.prepare('SELECT COUNT(*) as count FROM votes WHERE category_id = ?').get('dang-quy-nhat') as any;
    expect(count1.count).toBe(1);

    // Change vote for dang-quy-nhat -> candidateB
    votingService.castVotes(
      user.id,
      voter.id,
      [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateB.id }],
      'voter1'
    );

    userVotes = votingService.getUserVotes(user.id);
    expect(userVotes['dang-quy-nhat']).toBe(candidateB.id);

    // Total rows in votes table for dang-quy-nhat must STILL be 1 (no duplicates)
    const count2 = db.prepare('SELECT COUNT(*) as count FROM votes WHERE category_id = ?').get('dang-quy-nhat') as any;
    expect(count2.count).toBe(1);
  });

  it('3. lock blocks vote changes and reopen permits vote changes', async () => {
    const members = memberService.searchMembers('', 10);
    const voter = members[0];
    const candidateA = members[1];

    await authService.registerMemberAccount(voter.id, 'voter2', 'voter2@example.com', 'password123');
    const token = mockEmailProvider.getLatestEmailFor('voter2@example.com')!.token;
    await authService.verifyEmailToken(token);
    const user = (await authService.authenticate('voter2', 'password123')).user!;

    // Lock voting
    votingService.setVotingLock(true, 'admin_user');
    expect(votingService.isVotingLocked()).toBe(true);

    // Attempt to vote while locked -> throws error
    expect(() => {
      votingService.castVotes(
        user.id,
        voter.id,
        [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateA.id }],
        'voter2'
      );
    }).toThrow(/Bình chọn đã bị khóa/);

    // Reopen voting
    votingService.setVotingLock(false, 'admin_user');
    expect(votingService.isVotingLocked()).toBe(false);

    // Now voting succeeds
    const res = votingService.castVotes(
      user.id,
      voter.id,
      [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateA.id }],
      'voter2'
    );
    expect(res.success).toBe(true);
    expect(res.votes['dang-quy-nhat']).toBe(candidateA.id);
  });

  it('4. 0-VND candidate cannot win even if they have the most votes', async () => {
    const members = memberService.searchMembers('', 10);
    const voter = members[0];
    const candidateNoContrib = members[1]; // 0 contribution
    const candidateWithContrib = members[2]; // 500k contribution

    // Add contribution for candidateWithContrib only
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), candidateWithContrib.id);

    // Voter casts vote for candidateNoContrib
    await authService.registerMemberAccount(voter.id, 'voter3', 'voter3@example.com', 'password123');
    const token = mockEmailProvider.getLatestEmailFor('voter3@example.com')!.token;
    await authService.verifyEmailToken(token);
    const user = (await authService.authenticate('voter3', 'password123')).user!;

    votingService.castVotes(
      user.id,
      voter.id,
      [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateNoContrib.id }],
      'voter3'
    );

    const adminResults = votingService.getAdminResults();
    const cat = adminResults.categories.find((c) => c.id === 'dang-quy-nhat')!;

    // candidateNoContrib has 1 vote but is NOT eligible
    const candResult = cat.candidates.find((c) => c.member_id === candidateNoContrib.id)!;
    expect(candResult.vote_count).toBe(1);
    expect(candResult.total_contributed).toBe(0);
    expect(candResult.is_eligible_winner).toBe(false);

    // Winner must be null (no eligible winner)
    expect(cat.winner).toBeNull();
  });

  it('5. vote ranking and contribution tie-break logic works correctly', async () => {
    const members = memberService.searchMembers('', 10);
    const voter1 = members[0];
    const voter2 = members[1];
    const voter3 = members[2];

    const candidateA = members[3]; // 500k contribution
    const candidateB = members[4]; // 1,000,000 contribution

    // Add contributions
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE'),
             (?, 'MEMBER', ?, 1000000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), candidateA.id, crypto.randomUUID(), candidateB.id);

    // Create 2 voters
    await authService.registerMemberAccount(voter1.id, 'v1', 'v1@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('v1@example.com')!.token);
    const u1 = (await authService.authenticate('v1', 'pwd')).user!;

    await authService.registerMemberAccount(voter2.id, 'v2', 'v2@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('v2@example.com')!.token);
    const u2 = (await authService.authenticate('v2', 'pwd')).user!;

    // Case 1: Higher vote count wins (u1 and u2 vote for candidateA -> candidateA has 2 votes vs candidateB 0 votes)
    votingService.castVotes(u1.id, voter1.id, [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateA.id }], 'v1');
    votingService.castVotes(u2.id, voter2.id, [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateA.id }], 'v2');

    let results = votingService.getAdminResults();
    let cat = results.categories.find((c) => c.id === 'dang-quy-nhat')!;
    expect(cat.winner?.member_id).toBe(candidateA.id);

    // Case 2: Tie in votes (1 vote each) -> Candidate with higher contribution wins (candidateB has 1M > candidateA 500k)
    votingService.castVotes(u2.id, voter2.id, [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateB.id }], 'v2');

    results = votingService.getAdminResults();
    cat = results.categories.find((c) => c.id === 'dang-quy-nhat')!;
    expect(cat.winner?.member_id).toBe(candidateB.id); // candidateB wins by contribution tie-break!
    expect(cat.needs_admin_tie_break).toBe(false);
  });

  it('6. exact tie (equal votes AND equal contributions) requires ADMIN manual choice', async () => {
    const members = memberService.searchMembers('', 10);
    const voter1 = members[0];
    const voter2 = members[1];
    const candidateA = members[3]; // 500k contribution
    const candidateB = members[4]; // 500k contribution

    // Add equal contributions
    db.prepare(`
      INSERT INTO contributions (id, contributor_type, member_id, amount, match_method)
      VALUES (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE'),
             (?, 'MEMBER', ?, 500000, 'EXACT_PAYMENT_CODE')
    `).run(crypto.randomUUID(), candidateA.id, crypto.randomUUID(), candidateB.id);

    // Create 2 voters
    await authService.registerMemberAccount(voter1.id, 't1', 't1@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('t1@example.com')!.token);
    const u1 = (await authService.authenticate('t1', 'pwd')).user!;

    await authService.registerMemberAccount(voter2.id, 't2', 't2@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('t2@example.com')!.token);
    const u2 = (await authService.authenticate('t2', 'pwd')).user!;

    votingService.castVotes(u1.id, voter1.id, [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateA.id }], 't1');
    votingService.castVotes(u2.id, voter2.id, [{ categoryId: 'dang-quy-nhat', candidateMemberId: candidateB.id }], 't2');

    // Both candidates have 1 vote and 500k contribution -> exact tie!
    let results = votingService.getAdminResults();
    let cat = results.categories.find((c) => c.id === 'dang-quy-nhat')!;
    expect(cat.needs_admin_tie_break).toBe(true);
    expect(cat.tied_candidates).toHaveLength(2);

    // Admin manually selects candidateA as winner
    votingService.setManualWinner('dang-quy-nhat', candidateA.id, 'admin_operator');

    results = votingService.getAdminResults();
    cat = results.categories.find((c) => c.id === 'dang-quy-nhat')!;
    expect(cat.winner?.member_id).toBe(candidateA.id);
    expect(cat.winner?.is_manual_selection).toBe(true);

    // Presentation data reflects winner without exposing vote counts
    const presentation = votingService.getPresentationData();
    const presAward = presentation.awards.find((a) => a.categoryId === 'dang-quy-nhat')!;
    expect(presAward.winner?.memberId).toBe(candidateA.id);
    expect((presAward as any).vote_count).toBeUndefined();
  });

  it('7. HTTP API: Member / Public cannot read results, Admin can', async () => {
    // 1. Unauthenticated request to /api/v1/admin/voting/results -> 401
    const unauthRes = await supertest(app.server).get('/api/v1/admin/voting/results');
    expect(unauthRes.status).toBe(401);

    // 2. MEMBER role request -> 403
    const members = memberService.searchMembers('Nguyễn Thị Bích', 10);
    const bich = members.find((m) => m.full_name === 'Nguyễn Thị Bích')!;
    await authService.registerMemberAccount(bich.id, 'bich_voter', 'bich_voter@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('bich_voter@example.com')!.token);
    const memberLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'bich_voter',
      password: 'pwd',
    });
    const memberCookie = memberLogin.headers['set-cookie'];

    const memberRes = await supertest(app.server)
      .get('/api/v1/admin/voting/results')
      .set('Cookie', memberCookie);
    expect(memberRes.status).toBe(403);

    // 3. ADMIN role request -> 200
    const tuanAnh = memberService.searchMembers('Dương Tuấn Anh', 10).find((m) => m.full_name === 'Dương Tuấn Anh')!;
    await authService.registerMemberAccount(tuanAnh.id, 'tuananh_admin', 'tuananh_admin@example.com', 'pwd');
    await authService.verifyEmailToken(mockEmailProvider.getLatestEmailFor('tuananh_admin@example.com')!.token);
    const adminLogin = await supertest(app.server).post('/api/v1/auth/login').send({
      username: 'tuananh_admin',
      password: 'pwd',
    });
    const adminCookie = adminLogin.headers['set-cookie'];

    const adminRes = await supertest(app.server)
      .get('/api/v1/admin/voting/results')
      .set('Cookie', adminCookie);
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.categories).toHaveLength(3);

    // Presentation endpoint also 200 for Admin
    const presRes = await supertest(app.server)
      .get('/api/v1/admin/voting/presentation')
      .set('Cookie', adminCookie);
    expect(presRes.status).toBe(200);
    expect(presRes.body.awards).toHaveLength(3);
  });
});
