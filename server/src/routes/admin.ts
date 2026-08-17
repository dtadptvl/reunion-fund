import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { AuthService } from '../services/auth.service.js';
import { MemberService } from '../services/member.service.js';
import { ReconciliationService } from '../services/reconciliation.service.js';
import { AuditService } from '../services/audit.service.js';
import { ExpenseCategory } from '../db/schema.js';
import { config } from '../config/env.js';

export async function adminRoutes(
  app: FastifyInstance,
  options: {
    db: Database.Database;
    authService: AuthService;
    memberService: MemberService;
    reconciliationService: ReconciliationService;
    auditService: AuditService;
  }
) {
  const db = options.db;

  // Middleware helper to check authentication
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionToken = (request.cookies as any)?.session_token;
    const session = options.authService.validateSession(sessionToken);
    if (!session) {
      return reply.status(401).send({ error: 'Yêu cầu đăng nhập tài khoản thủ quỹ' });
    }
    (request as any).user = session;
  };

  // 1. Treasurer Login
  app.post('/api/v1/admin/login', async (request, reply) => {
    const { username, password } = request.body as { username?: string; password?: string };
    if (!username || !password) {
      return reply.status(400).send({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
    }

    const session = await options.authService.authenticate(username, password);
    if (!session) {
      return reply.status(401).send({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác' });
    }

    const token = options.authService.createSession(session);
    reply.setCookie('session_token', token, {
      path: '/',
      httpOnly: true,
      secure: config.COOKIE_SECURE || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400, // 24 hours
    });

    options.auditService.log({
      actor: session.username,
      action: 'LOGIN',
      entityType: 'STAFF_USER',
      entityId: session.userId,
      ipAddress: request.ip,
    });

    return { success: true, user: session };
  });

  // 2. Treasurer Logout
  app.post('/api/v1/admin/logout', async (request, reply) => {
    const sessionToken = (request.cookies as any)?.session_token;
    if (sessionToken) {
      options.authService.destroySession(sessionToken);
    }
    reply.clearCookie('session_token', { path: '/' });
    return { success: true };
  });

  // 3. Current Session
  app.get('/api/v1/admin/me', { preHandler: [requireAuth] }, async (request) => {
    return { user: (request as any).user };
  });

  // 4. Exception Queues (Cần xử lý)
  app.get('/api/v1/admin/exceptions', { preHandler: [requireAuth] }, async () => {
    // A. Unresolved incoming contributions
    const unresolvedIncome = db
      .prepare(`
        SELECT c.id, c.amount, c.created_at, c.unresolved_name, bt.content, bt.description
        FROM contributions c
        JOIN bank_transactions bt ON c.bank_transaction_id = bt.id
        WHERE c.contributor_type = 'UNRESOLVED'
        ORDER BY c.created_at DESC
      `)
      .all();

    // B. Expenses needing purpose or category clarification
    const expensesNeedingReview = db
      .prepare(`
        SELECT e.id, e.amount, e.category, e.title, e.recipient_name, e.created_at, bt.content, bt.description
        FROM expenses e
        JOIN bank_transactions bt ON e.bank_transaction_id = bt.id
        WHERE e.category = 'UNKNOWN' OR e.vietnamese_title IS NULL
        ORDER BY e.created_at DESC
      `)
      .all();

    // C. External contributors pending normalization
    const pendingNames = db
      .prepare(`
        SELECT id, raw_name, display_name, created_at
        FROM external_contributors
        WHERE status = 'PENDING_REVIEW'
        ORDER BY created_at DESC
      `)
      .all();

    // D. Name correction requests pending review
    const pendingCorrections = db
      .prepare(`
        SELECT r.id, r.member_id, r.current_name, r.requested_name, r.notes, r.created_at, m.full_name
        FROM name_correction_requests r
        JOIN members m ON r.member_id = m.id
        WHERE r.status = 'PENDING'
        ORDER BY r.created_at DESC
      `)
      .all();

    // E. Reconciliation stats
    const lastReconciliation = db
      .prepare('SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT 1')
      .get();

    return {
      unresolvedIncomeCount: unresolvedIncome.length,
      unresolvedIncome,
      expensesNeedingReviewCount: expensesNeedingReview.length,
      expensesNeedingReview,
      pendingNamesCount: pendingNames.length,
      pendingNames,
      pendingCorrectionsCount: pendingCorrections.length,
      pendingCorrections,
      lastReconciliation,
    };
  });

  // 4.1 Review Name Correction Request (Approve / Reject)
  app.post('/api/v1/admin/name-corrections/:id/review', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { action } = request.body as { action: 'APPROVE' | 'REJECT' };
    const user = (request as any).user;

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return reply.status(400).send({ error: 'Hành động không hợp lệ (APPROVE hoặc REJECT)' });
    }

    try {
      const result = options.memberService.reviewNameCorrectionRequest(id, action, user.username);
      options.auditService.log({
        actor: user.username,
        action: action === 'APPROVE' ? 'APPROVE_NAME_CORRECTION' : 'REJECT_NAME_CORRECTION',
        entityType: 'NAME_CORRECTION_REQUEST',
        entityId: id,
        afterState: result,
        ipAddress: request.ip,
      });

      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Lỗi xử lý yêu cầu sửa tên' });
    }
  });

  // 5. Assign Unresolved Contribution
  app.post('/api/v1/admin/contributions/:id/assign', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { memberId, notes } = request.body as { memberId: string; notes?: string };
    const user = (request as any).user;

    const contribution = db.prepare('SELECT * FROM contributions WHERE id = ?').get(id) as any;
    if (!contribution) {
      return reply.status(404).send({ error: 'Không tìm thấy khoản thu' });
    }

    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(memberId) as any;
    if (!member) {
      return reply.status(404).send({ error: 'Không tìm thấy thành viên được chỉ định' });
    }

    db.prepare(`
      UPDATE contributions SET
        contributor_type = 'MEMBER',
        member_id = ?,
        match_method = 'MANUAL_TREASURER_ASSIGNMENT',
        reviewed_by = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(member.id, user.username, notes || null, id);

    options.auditService.log({
      actor: user.username,
      action: 'ASSIGN_CONTRIBUTION',
      entityType: 'CONTRIBUTION',
      entityId: id,
      beforeState: contribution,
      afterState: { memberId: member.id, memberName: member.full_name },
      ipAddress: request.ip,
    });

    return { success: true };
  });

  // 6. Update Expense Details & Category
  app.post('/api/v1/admin/expenses/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      vietnameseTitle?: string;
      category?: ExpenseCategory;
      recipientName?: string;
      notes?: string;
      saveLearnedRule?: boolean;
    };
    const user = (request as any).user;

    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
    if (!expense) {
      return reply.status(404).send({ error: 'Không tìm thấy khoản chi' });
    }

    const isSettlement = body.category === 'FUND_TRANSFER' ? 1 : expense.is_settlement_transfer;

    db.prepare(`
      UPDATE expenses SET
        vietnamese_title = COALESCE(?, vietnamese_title),
        category = COALESCE(?, category),
        recipient_name = COALESCE(?, recipient_name),
        notes = COALESCE(?, notes),
        classification_source = 'MANUAL_OVERRIDE',
        is_settlement_transfer = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      body.vietnameseTitle || null,
      body.category || null,
      body.recipientName || null,
      body.notes || null,
      isSettlement,
      id
    );

    // If treasurer wants to remember rule for future transactions
    if (body.saveLearnedRule && body.recipientName && body.category) {
      db.prepare(`
        INSERT INTO classification_rules (id, recipient_pattern, assigned_category, suggested_title, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(recipient_pattern) DO UPDATE SET
          assigned_category = excluded.assigned_category,
          suggested_title = excluded.suggested_title
      `).run(
        crypto.randomUUID(),
        body.recipientName,
        body.category,
        body.vietnameseTitle || null,
        user.username
      );
    }

    options.auditService.log({
      actor: user.username,
      action: 'UPDATE_EXPENSE',
      entityType: 'EXPENSE',
      entityId: id,
      beforeState: expense,
      afterState: body,
      ipAddress: request.ip,
    });

    return { success: true };
  });

  // 7. Manual SePay Reconciliation
  app.post('/api/v1/admin/reconcile', { preHandler: [requireAuth] }, async (request, reply) => {
    try {
      const summary = await options.reconciliationService.runReconciliation('MANUAL');
      return { success: true, summary };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Lỗi trong quá trình đối soát' });
    }
  });

  // 8. Finalize Reunion Settlement
  app.post('/api/v1/admin/settlement', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = (request as any).user;

    // Check financial balance
    const incomeRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM contributions').get() as { total: number };
    const expenseRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses').get() as { total: number };
    const balance = incomeRow.total - expenseRow.total;

    if (balance !== 0) {
      return reply.status(400).send({
        error: `Số dư quỹ hiện tại là ${balance.toLocaleString('vi-VN')} ₫. Cần chuyển toàn bộ số dư còn lại về quỹ chung của lớp trước khi quyết toán.`,
      });
    }

    db.prepare(`
      INSERT INTO system_state (key, value, updated_at)
      VALUES ('is_settled', 'true', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = 'true', updated_at = CURRENT_TIMESTAMP
    `).run();

    options.auditService.log({
      actor: user.username,
      action: 'SETTLE_REUNION_FUND',
      entityType: 'SYSTEM_STATE',
      entityId: 'is_settled',
      afterState: { totalIncome: incomeRow.total, totalExpense: expenseRow.total, balance: 0 },
      ipAddress: request.ip,
    });

    return {
      success: true,
      message: 'Đã quyết toán quỹ họp lớp thành công. Website đã chuyển sang chế độ lưu trữ.',
    };
  });
}
