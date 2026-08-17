import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { ContributionService } from '../../server/src/services/contribution.service.js';
import { BankTransactionRow } from '../../server/src/db/schema.js';

describe('Name Correction Feature Workflow', () => {
  let db: Database.Database;
  let memberService: MemberService;
  let contributionService: ContributionService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    memberService = new MemberService(db);
    contributionService = new ContributionService(db);

    memberService.seedCanonicalRoster();
  });

  afterEach(() => {
    db.close();
  });

  it('allows public user to submit name correction request without directly altering member record', () => {
    const member = memberService.searchMembers('Dương Tuấn Anh', 1)[0];
    expect(member).toBeDefined();

    // 1. Submit request
    const req = memberService.createNameCorrectionRequest(
      member.id,
      'Dương Tuấn Anh (Chuẩn)',
      'Bổ sung chữ lót'
    );

    expect(req.id).toBeDefined();
    expect(req.status).toBe('PENDING');
    expect(req.member_id).toBe(member.id);

    // 2. Verify canonical member full_name is UNCHANGED until treasurer reviews
    const memberAfterReq = db.prepare('SELECT * FROM members WHERE id = ?').get(member.id) as any;
    expect(memberAfterReq.full_name).toBe('Dương Tuấn Anh');
  });

  it('allows treasurer to approve name correction, updating canonical name while preserving immutable ID and contributions', () => {
    const member = memberService.searchMembers('Dương Tuấn Anh', 1)[0];

    // 1. Member makes a contribution under their immutable ID
    const bankTx: BankTransactionRow = {
      id: 'tx-name-corr',
      sepay_id: 20001,
      gateway: 'MBBank',
      transaction_date: new Date().toISOString(),
      account_number: '0123456789',
      transfer_type: 'in',
      transfer_amount: 500000,
      content: 'TUAN ANH DONGQUY K9Z1P',
      raw_payload: '{}',
      ingestion_source: 'WEBHOOK',
      is_excluded: 0,
      created_at: new Date().toISOString(),
    };

    db.prepare(`
      INSERT INTO payment_intents (id, payment_code, member_id, expected_amount, transfer_content, status)
      VALUES ('pi-nc', 'K9Z1P', '${member.id}', 500000, 'TUAN ANH DONGQUY K9Z1P', 'PENDING')
    `).run();

    db.prepare(`
      INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source, is_excluded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bankTx.id, bankTx.sepay_id, bankTx.gateway, bankTx.transaction_date, bankTx.account_number, bankTx.transfer_type, bankTx.transfer_amount, bankTx.content, bankTx.raw_payload, bankTx.ingestion_source, bankTx.is_excluded);

    const contribResult = contributionService.processIncomingTransaction(bankTx);
    expect(contribResult.memberId).toBe(member.id);

    // 2. Submit correction request to "Dương Tuấn Anh Hào"
    const req = memberService.createNameCorrectionRequest(
      member.id,
      'Dương Tuấn Anh Hào',
      'Đổi tên đầy đủ'
    );

    // 3. Treasurer APPROVES
    const reviewResult = memberService.reviewNameCorrectionRequest(req.id, 'APPROVE', 'thuquy_admin');
    expect(reviewResult.success).toBe(true);

    // 4. Verify canonical member record is updated
    const updatedMember = db.prepare('SELECT * FROM members WHERE id = ?').get(member.id) as any;
    expect(updatedMember.full_name).toBe('Dương Tuấn Anh Hào');
    expect(updatedMember.normalized_name).toBe('DUONG TUAN ANH HAO');
    expect(updatedMember.id).toBe(member.id); // Immutable ID preserved

    // 5. Verify historical contribution remains linked to the exact same member ID
    const contribution = db.prepare('SELECT * FROM contributions WHERE id = ?').get(contribResult.contributionId) as any;
    expect(contribution.member_id).toBe(member.id);
  });

  it('allows treasurer to reject name correction request, preserving canonical name and recording history', () => {
    const member = memberService.searchMembers('Dương Ngọc Bích', 1)[0];

    const req = memberService.createNameCorrectionRequest(
      member.id,
      'Tên Không Hợp Lệ',
      'Yêu cầu sai'
    );

    // Treasurer REJECTS
    const reviewResult = memberService.reviewNameCorrectionRequest(req.id, 'REJECT', 'thuquy_admin');
    expect(reviewResult.success).toBe(true);

    // Member name remains untouched
    const memberAfter = db.prepare('SELECT * FROM members WHERE id = ?').get(member.id) as any;
    expect(memberAfter.full_name).toBe('Dương Ngọc Bích');

    // Request status is REJECTED
    const reqAfter = db.prepare('SELECT * FROM name_correction_requests WHERE id = ?').get(req.id) as any;
    expect(reqAfter.status).toBe('REJECTED');
    expect(reqAfter.reviewed_by).toBe('thuquy_admin');
  });
});
