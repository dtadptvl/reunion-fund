import { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { MemberService } from '../services/member.service.js';
import { ExportService } from '../services/export.service.js';
import {
  generatePaymentCode,
  formatTransferContent,
  generateBankDisplayName,
} from '../services/vietqr.service.js';
import { config } from '../config/env.js';

export async function publicRoutes(
  app: FastifyInstance,
  options: {
    db: Database.Database;
    memberService: MemberService;
    exportService: ExportService;
  }
) {
  const db = options.db;

  // 1. Overview Financial Totals & Recent Activity
  app.get('/api/v1/public/overview', async () => {
    const incomeRow = db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM contributions')
      .get() as { total: number };
    const expenseRow = db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses')
      .get() as { total: number };
    const countRow = db
      .prepare(`
        SELECT COUNT(DISTINCT COALESCE(member_id, external_contributor_id)) as count
        FROM contributions
        WHERE member_id IS NOT NULL OR external_contributor_id IS NOT NULL
      `)
      .get() as { count: number };
    const settledRow = db
      .prepare("SELECT value FROM system_state WHERE key = 'is_settled'")
      .get() as { value: string } | undefined;

    const recentContributions = db
      .prepare(`
        SELECT
          c.id,
          c.amount,
          c.created_at,
          COALESCE(m.full_name, ext.display_name, 'Chưa xác định') as contributor_name,
          c.contributor_type
        FROM contributions c
        LEFT JOIN members m ON c.member_id = m.id
        LEFT JOIN external_contributors ext ON c.external_contributor_id = ext.id
        ORDER BY c.created_at DESC
        LIMIT 5
      `)
      .all();

    const recentExpenses = db
      .prepare(`
        SELECT
          e.id,
          e.amount,
          e.category,
          COALESCE(e.vietnamese_title, e.title, 'Chưa rõ mục đích') as title,
          e.recipient_name,
          e.created_at
        FROM expenses e
        ORDER BY e.created_at DESC
        LIMIT 5
      `)
      .all();

    const totalIncome = incomeRow.total;
    const totalExpense = expenseRow.total;

    return {
      eventTitle: config.REUNION_EVENT_TITLE,
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      contributorCount: countRow.count,
      isSettled: settledRow?.value === 'true',
      recentContributions,
      recentExpenses,
    };
  });

  // 2. Member Roster Search
  app.get('/api/v1/public/members', async (request) => {
    const { q } = request.query as { q?: string };
    const members = options.memberService.searchMembers(q || '', 100);
    return { members };
  });

  // 2.1 Public Name Correction Request
  app.post('/api/v1/public/members/:id/correction', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { requestedName, notes } = request.body as { requestedName?: string; notes?: string };

    if (!requestedName || !requestedName.trim()) {
      return reply.status(400).send({ error: 'Vui lòng nhập tên đúng của bạn' });
    }

    try {
      const reqRow = options.memberService.createNameCorrectionRequest(
        id,
        requestedName.trim(),
        notes
      );
      return {
        success: true,
        requestId: reqRow.id,
        message: 'Đã gửi yêu cầu sửa tên. Thủ quỹ sẽ kiểm tra và cập nhật. Bạn vẫn có thể tiếp tục đóng quỹ.',
      };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không thể tạo yêu cầu sửa tên' });
    }
  });

  // 3. Create Payment Intent & VietQR
  app.post('/api/v1/public/intent', async (request, reply) => {
    const body = request.body as {
      memberId?: string;
      customName?: string;
      amount: number;
    };

    if (!body.amount || body.amount < 10000) {
      return reply.status(400).send({
        error: 'Số tiền đóng góp tối thiểu là 10.000 ₫',
      });
    }

    let bankDisplayName = 'BAN LOP';
    let memberId: string | null = null;
    let externalContributorId: string | null = null;

    if (body.memberId) {
      const member = db
        .prepare('SELECT * FROM members WHERE id = ?')
        .get(body.memberId) as any;
      if (!member) {
        return reply.status(404).send({ error: 'Không tìm thấy thành viên trong danh sách' });
      }
      memberId = member.id;
      bankDisplayName = member.bank_display_name;
    } else if (body.customName && body.customName.trim()) {
      const ext = options.memberService.createExternalContributor(body.customName);
      externalContributorId = ext.id;
      bankDisplayName = generateBankDisplayName(ext.raw_name);
    } else {
      return reply.status(400).send({ error: 'Vui lòng chọn tên hoặc nhập tên người đóng góp' });
    }

    // Generate unique payment code
    let paymentCode = generatePaymentCode();
    let collisionCheck = db
      .prepare('SELECT id FROM payment_intents WHERE payment_code = ?')
      .get(paymentCode);
    while (collisionCheck) {
      paymentCode = generatePaymentCode();
      collisionCheck = db
        .prepare('SELECT id FROM payment_intents WHERE payment_code = ?')
        .get(paymentCode);
    }

    const transferContent = formatTransferContent(bankDisplayName, paymentCode);
    const intentId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO payment_intents (
        id, payment_code, member_id, external_contributor_id,
        expected_amount, transfer_content, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
    `).run(
      intentId,
      paymentCode,
      memberId,
      externalContributorId,
      body.amount,
      transferContent
    );

    // Build standard VietQR image URL
    // Format: https://img.vietqr.io/image/<BANK_NAME>-<ACCOUNT_NO>-compact.png?amount=<AMOUNT>&addInfo=<CONTENT>&accountName=<ACC_NAME>
    const qrUrl = `https://img.vietqr.io/image/${config.SEPAY_BANK_NAME}-${config.SEPAY_BANK_ACCOUNT}-compact.png?amount=${body.amount}&addInfo=${encodeURIComponent(transferContent)}&accountName=${encodeURIComponent(config.SEPAY_ACCOUNT_NAME)}`;

    return {
      intentId,
      paymentCode,
      expectedAmount: body.amount,
      transferContent,
      bankAccount: config.SEPAY_BANK_ACCOUNT,
      bankName: config.SEPAY_BANK_NAME,
      accountName: config.SEPAY_ACCOUNT_NAME,
      qrUrl,
    };
  });

  // 4. Check Intent Status
  app.get('/api/v1/public/intent/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    const intent = db
      .prepare('SELECT * FROM payment_intents WHERE payment_code = ?')
      .get(code.toUpperCase()) as any;

    if (!intent) {
      return reply.status(404).send({ error: 'Không tìm thấy mã đóng quỹ' });
    }

    const contribution = db
      .prepare('SELECT * FROM contributions WHERE payment_intent_id = ?')
      .get(intent.id) as any;

    return {
      status: intent.status,
      isPaid: intent.status === 'COMPLETED' || Boolean(contribution),
      actualAmount: contribution ? contribution.amount : null,
      confirmedAt: contribution ? contribution.created_at : null,
    };
  });

  // 5. Contributors Public List (Alphabetical with total and items)
  app.get('/api/v1/public/contributors', async () => {
    // List all members with aggregated contribution totals
    const membersWithTotals = db
      .prepare(`
        SELECT
          m.id,
          m.full_name,
          COALESCE(SUM(c.amount), 0) as total_contributed,
          COUNT(c.id) as contribution_count
        FROM members m
        LEFT JOIN contributions c ON m.id = c.member_id
        GROUP BY m.id
        ORDER BY m.full_name COLLATE NOCASE ASC
      `)
      .all();

    // List all external confirmed contributors
    const externalContributors = db
      .prepare(`
        SELECT
          ext.id,
          ext.display_name as full_name,
          COALESCE(SUM(c.amount), 0) as total_contributed,
          COUNT(c.id) as contribution_count
        FROM external_contributors ext
        JOIN contributions c ON ext.id = c.external_contributor_id
        GROUP BY ext.id
        ORDER BY ext.display_name COLLATE NOCASE ASC
      `)
      .all();

    return {
      members: membersWithTotals,
      external: externalContributors,
    };
  });

  // 6. Contributor Detail History
  app.get('/api/v1/public/contributors/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id) as any;
    const external = !member
      ? (db.prepare('SELECT * FROM external_contributors WHERE id = ?').get(id) as any)
      : null;

    if (!member && !external) {
      return reply.status(404).send({ error: 'Không tìm thấy người đóng góp' });
    }

    const contributions = db
      .prepare(`
        SELECT id, amount, created_at, notes
        FROM contributions
        WHERE member_id = ? OR external_contributor_id = ?
        ORDER BY created_at DESC
      `)
      .all(id, id);

    return {
      person: {
        id,
        name: member ? member.full_name : external.display_name,
        type: member ? 'MEMBER' : 'EXTERNAL',
      },
      contributions,
    };
  });

  // 7. Public Expenses List
  app.get('/api/v1/public/expenses', async () => {
    const expenses = db
      .prepare(`
        SELECT
          e.id,
          e.amount,
          e.category,
          COALESCE(e.vietnamese_title, e.title, 'Chưa rõ mục đích') as title,
          e.recipient_name,
          e.created_at,
          e.notes,
          (SELECT COUNT(*) FROM attachments WHERE expense_id = e.id) as attachment_count
        FROM expenses e
        ORDER BY e.created_at DESC
      `)
      .all();

    return { expenses };
  });

  // 8. Public Exports
  app.get('/api/v1/public/export/xlsx', async (_req, reply) => {
    const buffer = options.exportService.generatePublicXLSX();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="bao_cao_quy_reunion.xlsx"');
    return reply.send(buffer);
  });

  app.get('/api/v1/public/export/csv/:type', async (request, reply) => {
    const { type } = request.params as { type: 'contributions' | 'expenses' };
    if (type !== 'contributions' && type !== 'expenses') {
      return reply.status(400).send({ error: 'Loại export không hợp lệ' });
    }
    const csvContent = options.exportService.generatePublicCSV(type);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${type}_reunion.csv"`);
    return reply.send('\uFEFF' + csvContent); // Add UTF-8 BOM for Excel
  });
}
