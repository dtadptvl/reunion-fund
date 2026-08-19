import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { AuthService } from '../../server/src/services/auth.service.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { MockEmailProvider } from '../../server/src/providers/email/mock-email-provider.js';

describe('H1.1 Startup Admin Canonicalization Hardening', () => {
  let db: Database.Database;
  let authService: AuthService;
  let memberService: MemberService;
  let mockEmailProvider: MockEmailProvider;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    mockEmailProvider = new MockEmailProvider();
    memberService = new MemberService(db);
    memberService.seedCanonicalRoster();
    authService = new AuthService(db, mockEmailProvider);
  });

  afterEach(() => {
    if (db && db.open) db.close();
  });

  // 1. Repeated app/service startup is idempotent
  it('repeated seedInitialStaff and seedDefaultAdmins runs are strictly idempotent', async () => {
    // First bootstrap run
    const res1 = await authService.seedInitialStaff('admin', undefined, 'Dương Tuấn Anh');
    expect(res1).toBe(true);

    const userCount1 = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    const adminUser1 = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as any;

    // Second bootstrap run (simulating server restart)
    const res2 = await authService.seedInitialStaff('admin', undefined, 'Dương Tuấn Anh');
    expect(res2).toBe(true);

    const userCount2 = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
    const adminUser2 = db.prepare("SELECT * FROM users WHERE username = 'admin'").get() as any;

    expect(userCount2).toBe(userCount1);
    expect(adminUser2.id).toBe(adminUser1.id);
    expect(adminUser2.created_at).toBe(adminUser1.created_at);
  });

  // 2. Restart does not change an existing password hash
  it('restart does not overwrite or change an existing user password hash', async () => {
    // Custom pre-existing password hash
    const customHash = await authService.hashPassword('MyCustomAdminPassword!@#');

    await authService.seedInitialStaff('admin', customHash, 'Dương Tuấn Anh');
    const userBefore = db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() as any;
    expect(userBefore.password_hash).toBe(customHash);

    // Simulate service restart with dummy/default bootstrap config
    await authService.seedInitialStaff('admin', '$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy', 'Dương Tuấn Anh');

    const userAfter = db.prepare("SELECT password_hash FROM users WHERE username = 'admin'").get() as any;
    expect(userAfter.password_hash).toBe(customHash);

    // Verify user can still authenticate with the custom password
    const authResult = await authService.authenticate('admin', 'MyCustomAdminPassword!@#');
    expect(authResult.status).toBe('SUCCESS');

    // Verify incorrect/default password fails
    const authFail = await authService.authenticate('admin', '123456');
    expect(authFail.status).toBe('INVALID_CREDENTIALS');
  });

  // 3. Legacy Treasurer identity cannot become visible again
  it('legacy Treasurer identity cannot become visible in authentication or session validation', async () => {
    const tuanAnh = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;

    // Seed admin
    await authService.seedInitialStaff('admin', undefined, 'Dương Tuấn Anh');

    // Create session with stale legacy fullName
    const staleToken = authService.createSession({
      userId: 'user-tuananh',
      username: 'admin',
      fullName: 'Thủ Quỹ Lớp A1', // stale legacy text
      role: 'ADMIN',
      memberId: tuanAnh.id,
      email: 'tuananh@reunion.local',
    });

    const validated = authService.validateSession(staleToken);
    expect(validated).not.toBeNull();
    expect(validated?.fullName).toBe('Dương Tuấn Anh');
    expect(validated?.fullName).not.toContain('Thủ Quỹ');

    // Authenticate check
    const authRes = await authService.authenticate('admin', '123456');
    expect(authRes.status).toBe('SUCCESS');
    expect(authRes.session?.fullName).toBe('Dương Tuấn Anh');
    expect(authRes.session?.fullName).not.toContain('Thủ Quỹ');
  });

  // 4. One Dương Tuấn Anh account only
  it('enforces strictly one account for Dương Tuấn Anh', async () => {
    const tuanAnh = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;

    // Bootstrap creates the initial admin account linked to Dương Tuấn Anh
    await authService.seedInitialStaff('admin', undefined, 'Dương Tuấn Anh');

    // Attempting to register another account with Dương Tuấn Anh's member_id must be rejected
    await expect(
      authService.registerMember({
        memberId: tuanAnh.id,
        username: 'tuananh_new',
        email: 'tuananh2@example.com',
        password: 'password123',
      })
    ).rejects.toThrow('Thành viên này đã đăng ký tài khoản');

    const accounts = db.prepare('SELECT COUNT(*) as c FROM users WHERE member_id = ?').get(tuanAnh.id) as any;
    expect(accounts.c).toBe(1);
  });

  // 5. One Hoàng Thị Nhàn account only
  it('enforces strictly one account for Hoàng Thị Nhàn with automatic ADMIN role', async () => {
    const nhan = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Hoàng Thị Nhàn'").get() as any;

    const reg = await authService.registerMember({
      memberId: nhan.id,
      username: 'hoang_nhan',
      email: 'nhan@example.com',
      password: 'password123',
    });

    expect(reg.user.role).toBe('ADMIN');
    expect(reg.user.full_name).toBe('Hoàng Thị Nhàn');

    // Second registration attempt fails
    await expect(
      authService.registerMember({
        memberId: nhan.id,
        username: 'nhan_duplicate',
        email: 'nhan2@example.com',
        password: 'password123',
      })
    ).rejects.toThrow('Thành viên này đã đăng ký tài khoản');
  });

  // 6. Exactly two ADMIN canonical accounts & other accounts remain MEMBER
  it('enforces that only default admin accounts hold ADMIN role while all other accounts are MEMBER', async () => {
    const nhan = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Hoàng Thị Nhàn'").get() as any;
    const regularMember = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Nguyễn Thị Bích'").get() as any;

    await authService.seedInitialStaff('admin', undefined, 'Dương Tuấn Anh');

    const regNhan = await authService.registerMember({
      memberId: nhan.id,
      username: 'nhan_admin',
      email: 'nhan@example.com',
      password: 'password123',
    });

    const regBich = await authService.registerMember({
      memberId: regularMember.id,
      username: 'bich_member',
      email: 'bich@example.com',
      password: 'password123',
    });

    expect(regNhan.user.role).toBe('ADMIN');
    expect(regBich.user.role).toBe('MEMBER');

    // Re-run seedDefaultAdmins
    authService.seedDefaultAdmins();

    const adminAccounts = db.prepare("SELECT username, full_name, role FROM users WHERE role = 'ADMIN'").all() as any[];
    expect(adminAccounts).toHaveLength(2);
    expect(adminAccounts.map((u) => u.full_name).sort()).toEqual(['Dương Tuấn Anh', 'Hoàng Thị Nhàn'].sort());

    const memberAccounts = db.prepare("SELECT username, full_name, role FROM users WHERE role = 'MEMBER'").all() as any[];
    expect(memberAccounts.every((u) => u.username !== 'admin' && u.username !== 'nhan_admin')).toBe(true);
  });

  // 7. In production mode, dummy/placeholder password fails closed and does not create an admin with 123456
  it('in production mode, placeholder bootstrap secret cannot create an admin account with default 123456', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      const freshDb = new Database(':memory:');
      freshDb.pragma('foreign_keys = ON');
      runMigrations(freshDb);
      const freshMemberService = new MemberService(freshDb);
      freshMemberService.seedCanonicalRoster();
      const freshAuth = new AuthService(freshDb);

      // Attempt bootstrap with dummy hash in production
      const result = await freshAuth.seedInitialStaff('admin', '$argon2id$v=19$m=65536,t=3,p=4$dummy$dummy');
      expect(result).toBe(false);

      // Verify no admin account was created with 123456
      const user = freshDb.prepare("SELECT * FROM users WHERE username = 'admin'").get();
      expect(user).toBeUndefined();

      freshDb.close();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  // 8. Dirty state: Dương Tuấn Anh already has a linked account + separate unlinked legacy admin exists
  it('dirty state: unlinked legacy admin account cannot authenticate/authorize as ADMIN when Dương Tuấn Anh already has a linked account', async () => {
    const tuanAnh = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;

    // 1. Real account linked to Dương Tuấn Anh
    const hashTuanAnh = await authService.hashPassword('RealTuanAnhPass123!');
    db.prepare(`
      INSERT INTO users (id, member_id, username, email, password_hash, full_name, role, status, email_verified)
      VALUES ('u-real-tuananh', ?, 'tuananh_real', 'tuananh@example.com', ?, 'Dương Tuấn Anh', 'ADMIN', 'ACTIVE', 1)
    `).run(tuanAnh.id, hashTuanAnh);

    // 2. Separate unlinked legacy admin account
    const hashLegacyAdmin = await authService.hashPassword('LegacyAdminPass123!');
    db.prepare(`
      INSERT INTO users (id, member_id, username, email, password_hash, full_name, role, status, email_verified)
      VALUES ('u-legacy-admin', NULL, 'admin', 'admin@reunion.local', ?, 'Admin Cũ', 'ADMIN', 'ACTIVE', 1)
    `).run(hashLegacyAdmin);

    // Normalize
    authService.seedDefaultAdmins();

    // The unlinked legacy admin must be downgraded to MEMBER
    const legacyAdminRow = db.prepare("SELECT * FROM users WHERE id = 'u-legacy-admin'").get() as any;
    expect(legacyAdminRow.role).toBe('MEMBER');
    expect(legacyAdminRow.member_id).toBeNull();

    // Authenticating with unlinked legacy admin yields MEMBER role and does NOT project as Dương Tuấn Anh
    const legacyAuth = await authService.authenticate('admin', 'LegacyAdminPass123!');
    expect(legacyAuth.status).toBe('SUCCESS');
    expect(legacyAuth.session?.role).toBe('MEMBER');
    expect(legacyAuth.session?.fullName).toBe('Admin Cũ');
    expect(legacyAuth.session?.memberId).toBeNull();

    // Real Dương Tuấn Anh account retains ADMIN role
    const realAuth = await authService.authenticate('tuananh_real', 'RealTuanAnhPass123!');
    expect(realAuth.status).toBe('SUCCESS');
    expect(realAuth.session?.role).toBe('ADMIN');
    expect(realAuth.session?.fullName).toBe('Dương Tuấn Anh');
    expect(realAuth.session?.memberId).toBe(tuanAnh.id);

    // Re-running seedInitialStaff preserves real Dương Tuấn Anh account
    await authService.seedInitialStaff('admin', undefined, 'Dương Tuấn Anh');
    const checkTuanAnhRow = db.prepare("SELECT * FROM users WHERE id = 'u-real-tuananh'").get() as any;
    expect(checkTuanAnhRow.member_id).toBe(tuanAnh.id);
    expect(checkTuanAnhRow.role).toBe('ADMIN');
  });

  // 9. Dirty state: arbitrary unlinked row with role ADMIN is normalized to MEMBER
  it('dirty state: arbitrary unlinked row with role ADMIN is normalized to MEMBER and has effective MEMBER role in sessions', async () => {
    const hashRogue = await authService.hashPassword('RoguePass123!');
    db.prepare(`
      INSERT INTO users (id, member_id, username, email, password_hash, full_name, role, status, email_verified)
      VALUES ('u-rogue', NULL, 'rogue_admin', 'rogue@example.com', ?, 'Rogue Admin', 'ADMIN', 'ACTIVE', 1)
    `).run(hashRogue);

    // Prior to or after seedDefaultAdmins, authenticate returns MEMBER role
    const rogueAuth = await authService.authenticate('rogue_admin', 'RoguePass123!');
    expect(rogueAuth.status).toBe('SUCCESS');
    expect(rogueAuth.session?.role).toBe('MEMBER');
    expect(rogueAuth.session?.fullName).toBe('Rogue Admin');

    // Create session with stale ADMIN role for unlinked user -> validateSession forces MEMBER role
    const token = authService.createSession({
      userId: 'u-rogue',
      username: 'rogue_admin',
      fullName: 'Rogue Admin',
      role: 'ADMIN',
      memberId: null,
      email: 'rogue@example.com',
    });

    const validated = authService.validateSession(token);
    expect(validated).not.toBeNull();
    expect(validated?.role).toBe('MEMBER');

    // Run seedDefaultAdmins
    authService.seedDefaultAdmins();
    const rogueRow = db.prepare("SELECT role FROM users WHERE id = 'u-rogue'").get() as any;
    expect(rogueRow.role).toBe('MEMBER');
  });

  // 10. Migration 009 exact matching regression test
  it('migration 009 cleans exact legacy strings but leaves unrelated names containing similar text untouched', () => {
    // Inject exact legacy strings and unrelated similar names
    db.prepare("INSERT INTO staff_users (id, username, password_hash, full_name, role) VALUES ('s-exact-1', 's1', 'h', 'Thủ Quỹ Lớp A1', 'ADMIN')").run();
    db.prepare("INSERT INTO staff_users (id, username, password_hash, full_name, role) VALUES ('s-exact-2', 's2', 'h', 'Thủ Quỹ Lớp', 'ADMIN')").run();
    db.prepare("INSERT INTO staff_users (id, username, password_hash, full_name, role) VALUES ('s-exact-3', 's3', 'h', 'Thủ Quỹ', 'ADMIN')").run();
    db.prepare("INSERT INTO staff_users (id, username, password_hash, full_name, role) VALUES ('s-unrelated-1', 's4', 'h', 'Nguyễn Thủ Quỹ', 'ADMIN')").run();
    db.prepare("INSERT INTO staff_users (id, username, password_hash, full_name, role) VALUES ('s-unrelated-2', 's5', 'h', 'Bác Quỹ Trưởng', 'ADMIN')").run();

    db.prepare("INSERT INTO users (id, username, password_hash, full_name, role, status, email_verified) VALUES ('u-exact-1', 'u1', 'h', 'Thủ Quỹ Lớp A1', 'MEMBER', 'ACTIVE', 1)").run();
    db.prepare("INSERT INTO users (id, username, password_hash, full_name, role, status, email_verified) VALUES ('u-unrelated-1', 'u2', 'h', 'Trần Văn Quỹ (Khách mời)', 'MEMBER', 'ACTIVE', 1)").run();

    // Reset migration 009 in schema_migrations so it executes on these rows
    db.prepare("DELETE FROM schema_migrations WHERE version = '009_clean_legacy_treasurer_identity.sql'").run();
    runMigrations(db);

    // Exact matches must be updated to 'Dương Tuấn Anh'
    const s1 = db.prepare("SELECT full_name FROM staff_users WHERE id = 's-exact-1'").get() as any;
    const s2 = db.prepare("SELECT full_name FROM staff_users WHERE id = 's-exact-2'").get() as any;
    const s3 = db.prepare("SELECT full_name FROM staff_users WHERE id = 's-exact-3'").get() as any;
    const u1 = db.prepare("SELECT full_name FROM users WHERE id = 'u-exact-1'").get() as any;

    expect(s1.full_name).toBe('Dương Tuấn Anh');
    expect(s2.full_name).toBe('Dương Tuấn Anh');
    expect(s3.full_name).toBe('Dương Tuấn Anh');
    expect(u1.full_name).toBe('Dương Tuấn Anh');

    // Unrelated names must be completely UNTOUCHED
    const s4 = db.prepare("SELECT full_name FROM staff_users WHERE id = 's-unrelated-1'").get() as any;
    const s5 = db.prepare("SELECT full_name FROM staff_users WHERE id = 's-unrelated-2'").get() as any;
    const u2 = db.prepare("SELECT full_name FROM users WHERE id = 'u-unrelated-1'").get() as any;

    expect(s4.full_name).toBe('Nguyễn Thủ Quỹ');
    expect(s5.full_name).toBe('Bác Quỹ Trưởng');
    expect(u2.full_name).toBe('Trần Văn Quỹ (Khách mời)');
  });

  // 11. Dirty state: staff_users legacy credential cannot authenticate as an additional Admin when real account exists
  it('dirty state: staff_users legacy credential cannot authenticate as an additional Admin when real Dương Tuấn Anh account exists', async () => {
    const tuanAnh = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;

    // 1. Real account linked to Dương Tuấn Anh in users
    const hashReal = await authService.hashPassword('RealTuanAnhPass123!');
    db.prepare(`
      INSERT INTO users (id, member_id, username, email, password_hash, full_name, role, status, email_verified)
      VALUES ('u-real-tuananh', ?, 'tuananh_real', 'tuananh@example.com', ?, 'Dương Tuấn Anh', 'ADMIN', 'ACTIVE', 1)
    `).run(tuanAnh.id, hashReal);

    // 2. Separate legacy staff_users row with its own password
    const hashLegacyStaff = await authService.hashPassword('OldStaffSecret999!');
    db.prepare(`
      INSERT INTO staff_users (id, username, password_hash, full_name, role, member_id)
      VALUES ('s-legacy-thuquy', 'thuquy', ?, 'Thủ Quỹ Lớp', 'TREASURER', NULL)
    `).run(hashLegacyStaff);

    // Re-run seedDefaultAdmins
    authService.seedDefaultAdmins();

    // Authenticate with legacy staff_users credentials
    const staffAuth = await authService.authenticate('thuquy', 'OldStaffSecret999!');
    expect(staffAuth.status).toBe('SUCCESS');
    // Must NOT receive ADMIN role or steal Dương Tuấn Anh's identity
    expect(staffAuth.session?.role).toBe('MEMBER');
    expect(staffAuth.session?.memberId).toBeNull();
    expect(staffAuth.session?.fullName).toBe('Thủ Quỹ Lớp');

    // Real account authenticates as ADMIN
    const realAuth = await authService.authenticate('tuananh_real', 'RealTuanAnhPass123!');
    expect(realAuth.status).toBe('SUCCESS');
    expect(realAuth.session?.role).toBe('ADMIN');
    expect(realAuth.session?.fullName).toBe('Dương Tuấn Anh');
    expect(realAuth.session?.memberId).toBe(tuanAnh.id);
  });
});
