import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../../server/src/app.js';
import { runMigrations } from '../../server/src/db/connection.js';
import { MockBankSyncProvider } from '../../server/src/providers/bank-sync/mock-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { AuthService } from '../../server/src/services/auth.service.js';

describe('Admin Canonical Identity & Legacy String Purge', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;
  let authService: AuthService;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);
    authService = new AuthService(db);
    await authService.seedInitialStaff('admin', undefined, 'Dương Tuấn Anh');
    app = buildApp({
      db,
      authService,
      bankSyncProvider: new MockBankSyncProvider(),
      aiProvider: new MockAIProvider(),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (db && db.open) db.close();
  });

  it('ensures exactly two default admin members in canonical roster', () => {
    const defaultAdmins = db.prepare("SELECT id, full_name FROM members WHERE full_name IN ('Dương Tuấn Anh', 'Hoàng Thị Nhàn')").all() as any[];
    expect(defaultAdmins.length).toBe(2);
  });

  it('purges any legacy "Thủ Quỹ" display name during migration', async () => {
    // Manually inject a legacy row to simulate pre-migration state
    db.prepare("INSERT OR REPLACE INTO staff_users (id, username, password_hash, full_name, role) VALUES ('legacy-1', 'admin_legacy', 'hash', 'Thủ Quỹ Lớp A1', 'ADMIN')").run();

    // Reset migration record so migration 009 runs on the newly injected legacy row
    db.prepare("DELETE FROM schema_migrations WHERE version = '009_clean_legacy_treasurer_identity.sql'").run();
    runMigrations(db);

    const staffRow = db.prepare("SELECT full_name FROM staff_users WHERE id = 'legacy-1'").get() as any;
    expect(staffRow.full_name).not.toContain('Thủ Quỹ');
    expect(staffRow.full_name).toBe('Dương Tuấn Anh');
  });

  it('authenticates admin login and returns canonical name Dương Tuấn Anh', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/login',
      payload: {
        username: 'admin',
        password: 'password123', // default seed hash in tests or 123456
      },
    });

    // If password doesn't match default test seed, test with 123456
    let loginRes = res;
    if (res.statusCode === 401) {
      loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/login',
        payload: {
          username: 'admin',
          password: '123456',
        },
      });
    }

    expect(loginRes.statusCode).toBe(200);
    const data = JSON.parse(loginRes.body);
    expect(data.user.fullName).toBe('Dương Tuấn Anh');
    expect(data.user.fullName).not.toContain('Thủ Quỹ');
    expect(data.user.role).toBe('ADMIN');
  });

  it('dynamically projects canonical name in validateSession even if session object was stale', () => {
    const tuanAnh = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;

    const staleSession = {
      userId: 'stale-user-id',
      username: 'tuananh',
      fullName: 'Thủ Quỹ Lớp A1', // stale legacy text
      role: 'ADMIN' as const,
      memberId: tuanAnh.id,
      email: 'tuananh@reunion.local',
    };

    const token = authService.createSession(staleSession);
    const validated = authService.validateSession(token);

    expect(validated).not.toBeNull();
    expect(validated?.fullName).toBe('Dương Tuấn Anh');
    expect(validated?.fullName).not.toContain('Thủ Quỹ');
  });
});
