import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { AuthService } from '../../server/src/services/auth.service.js';

describe('Fresh Database Startup & Bootstrap Isolation', () => {
  it('creates a clean database with 0 bank transactions, 0 contributions, and canonical 40-member roster', async () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const memberService = new MemberService(db);
    memberService.seedCanonicalRoster();

    const authService = new AuthService(db);
    await authService.seedInitialStaff('thuquy');

    const bankTxCount = (db.prepare('SELECT COUNT(*) as c FROM bank_transactions').get() as any).c;
    const contribCount = (db.prepare('SELECT COUNT(*) as c FROM contributions').get() as any).c;
    const expenseCount = (db.prepare('SELECT COUNT(*) as c FROM expenses').get() as any).c;
    const memberCount = (db.prepare('SELECT COUNT(*) as c FROM members').get() as any).c;

    expect(bankTxCount).toBe(0);
    expect(contribCount).toBe(0);
    expect(expenseCount).toBe(0);
    expect(memberCount).toBe(40);

    const dummy123 = db.prepare('SELECT * FROM bank_transactions WHERE sepay_id = 123').get();
    expect(dummy123).toBeUndefined();

    db.close();
  });
});
