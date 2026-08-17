import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService, extractGivenName } from '../../server/src/services/member.service.js';
import { formatTransferContent } from '../../server/src/services/vietqr.service.js';

describe('Canonical 40-Member Roster & Vietnamese Given-Name Sorting', () => {
  let db: Database.Database;
  let service: MemberService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    service = new MemberService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('seeds exactly 40 canonical members from roster.json', () => {
    const seededCount = service.seedCanonicalRoster();
    expect(seededCount).toBe(40);

    const members = service.searchMembers('', 100);
    expect(members.length).toBe(40);
  });

  it('extracts Vietnamese given name correctly ignoring parenthetical disambiguators', () => {
    expect(extractGivenName('Dương Tuấn Anh')).toBe('Anh');
    expect(extractGivenName('Nguyễn Vân Anh')).toBe('Anh');
    expect(extractGivenName('Nguyễn Thị Bích')).toBe('Bích');
    expect(extractGivenName('Sái Văn Độ')).toBe('Độ');
    expect(extractGivenName('Lê Thiết Giáp')).toBe('Giáp');
    expect(extractGivenName('Nguyễn Thị Huế (Lạc Đạo)')).toBe('Huế');
    expect(extractGivenName('Nguyễn Thị Huế (Lương Tài)')).toBe('Huế');
    expect(extractGivenName('Nguyễn Thị Viển')).toBe('Viển');
  });

  it('sorts members alphabetically by given name (last component) using Vietnamese locale collation', () => {
    service.seedCanonicalRoster();
    const sorted = service.searchMembers('', 100);

    // Verify ordering sequence matches Vietnamese given-name ordering:
    // First should be Anh, then Bích, then Dương, Độ, Giáp ... Viển last.
    const firstTwo = sorted.slice(0, 2);
    expect(firstTwo.map((m) => m.full_name)).toEqual(['Dương Tuấn Anh', 'Nguyễn Vân Anh']);

    const nextTwo = sorted.slice(2, 4);
    expect(nextTwo.map((m) => m.full_name)).toEqual(['Dương Thành Bích', 'Nguyễn Thị Bích']);

    const lastOne = sorted[sorted.length - 1];
    expect(lastOne?.full_name).toBe('Nguyễn Thị Viển');
  });

  it('handles parenthetical disambiguators structurally without polluting bank display name', () => {
    service.seedCanonicalRoster();
    const hues = service.searchMembers('Huế', 10);

    const lacDao = hues.find((m) => m.disambiguator === 'Lạc Đạo');
    const luongTai = hues.find((m) => m.disambiguator === 'Lương Tài');

    expect(lacDao).toBeDefined();
    expect(lacDao?.full_name).toBe('Nguyễn Thị Huế');
    expect(lacDao?.disambiguator).toBe('Lạc Đạo');
    expect(lacDao?.bank_display_name).toBe('THI HUE'); // No disambiguator

    expect(luongTai).toBeDefined();
    expect(luongTai?.full_name).toBe('Nguyễn Thị Huế');
    expect(luongTai?.disambiguator).toBe('Lương Tài');
    expect(luongTai?.bank_display_name).toBe('THI HUE'); // No disambiguator

    // Transfer content must NOT contain the disambiguator
    const content = formatTransferContent(lacDao!.bank_display_name, 'K8P4X');
    expect(content).not.toContain('LAC DAO');
    expect(content).toBe('THI HUE DONGQUY K8P4X');
  });
});
