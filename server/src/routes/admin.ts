import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { AuthService } from '../services/auth.service.js';
import { MemberService } from '../services/member.service.js';
import { ReconciliationService } from '../services/reconciliation.service.js';
import { AuditService } from '../services/audit.service.js';
import { AttachmentService } from '../services/attachment.service.js';
import { ActivityService } from '../services/activity.service.js';
import { VotingService } from '../services/voting.service.js';
import { LotteryService } from '../services/lottery.service.js';
import { ExpenseCategory } from '../db/schema.js';
import { config } from '../config/env.js';

const VALID_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'FOOD',
  'GIFT_TEACHER',
  'FLOWERS',
  'PHOTO_VIDEO',
  'PRINTING',
  'TRANSPORT',
  'REFUND',
  'FUND_TRANSFER',
  'OTHER',
  'UNKNOWN',
];

export async function adminRoutes(
  app: FastifyInstance,
  options: {
    db: Database.Database;
    authService: AuthService;
    memberService: MemberService;
    reconciliationService: ReconciliationService;
    auditService: AuditService;
    attachmentService: AttachmentService;
    activityService?: ActivityService;
    votingService?: VotingService;
    lotteryService?: LotteryService;
  }
) {
  const db = options.db;
  const activityService = options.activityService || new ActivityService(db);
  const votingService = options.votingService || new VotingService(db);
  const lotteryService = options.lotteryService || new LotteryService(db);

  // In-memory failed login tracking per IP
  const failedLoginAttempts = new Map<string, { count: number; resetAt: number }>();
  const MAX_FAILED_LOGIN_ATTEMPTS = 5;
  const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

  // Middleware helper to check authentication
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionToken = (request.cookies as any)?.session_token;
    const session = options.authService.validateSession(sessionToken);
    if (!session) {
      return reply.status(401).send({ error: 'Yêu cầu đăng nhập tài khoản Quản trị' });
    }
    (request as any).user = session;
  };

  // Middleware helper to enforce ADMIN role
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    const user = (request as any).user;
    if (!user || user.role !== 'ADMIN') {
      return reply.status(403).send({ error: 'Bạn không có quyền quản trị. Chức năng này chỉ dành cho Admin.' });
    }
  };

  // 1. Admin / Staff Login
  app.post('/api/v1/admin/login', async (request, reply) => {
    const ip = request.ip || '127.0.0.1';
    const now = Date.now();
    const loginRecord = failedLoginAttempts.get(ip);

    if (loginRecord && loginRecord.count >= MAX_FAILED_LOGIN_ATTEMPTS) {
      if (now < loginRecord.resetAt) {
        return reply.status(429).send({
          error: 'Quá nhiều lần đăng nhập không thành công. Vui lòng thử lại sau 15 phút.',
        });
      } else {
        failedLoginAttempts.delete(ip);
      }
    }

    const { username, password } = request.body as { username?: string; password?: string };
    if (!username || !password) {
      return reply.status(400).send({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
    }

    const authResult = await options.authService.authenticate(username, password);
    if (authResult.status === 'PENDING_VERIFICATION') {
      return reply.status(403).send({
        error: authResult.error || 'Tài khoản chưa xác thực email. Vui lòng kiểm tra hộp thư để kích hoạt tài khoản.',
        requiresVerification: true,
        email: authResult.email,
        userId: authResult.userId,
      });
    }

    if (authResult.status !== 'SUCCESS' || !authResult.session) {
      const current = failedLoginAttempts.get(ip) || { count: 0, resetAt: now + LOGIN_LOCKOUT_MS };
      failedLoginAttempts.set(ip, {
        count: current.count + 1,
        resetAt: now + LOGIN_LOCKOUT_MS,
      });

      return reply.status(401).send({ error: authResult.error || 'Tên đăng nhập hoặc mật khẩu không chính xác' });
    }

    // Reset failed attempts on success
    failedLoginAttempts.delete(ip);

    const session = authResult.session;
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

  // 2. Admin Logout
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
  app.get('/api/v1/admin/exceptions', { preHandler: [requireAdmin] }, async () => {
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
  app.post('/api/v1/admin/name-corrections/:id/review', { preHandler: [requireAdmin] }, async (request, reply) => {
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
  app.post('/api/v1/admin/contributions/:id/assign', { preHandler: [requireAdmin] }, async (request, reply) => {
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

    const memberDisplayName = member.disambiguator
      ? `${member.full_name} (${member.disambiguator})`
      : member.full_name;

    options.auditService.log({
      actor: user.username,
      action: 'ASSIGN_CONTRIBUTION',
      entityType: 'CONTRIBUTION',
      entityId: id,
      beforeState: contribution,
      afterState: { memberId: member.id, memberName: memberDisplayName },
      ipAddress: request.ip,
    });

    return { success: true };
  });

  // 5.1 Undo / Unassign Contribution
  app.post('/api/v1/admin/contributions/:id/unassign', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;

    const contribution = db.prepare('SELECT * FROM contributions WHERE id = ?').get(id) as any;
    if (!contribution) {
      return reply.status(404).send({ error: 'Không tìm thấy khoản thu' });
    }

    let originalName = contribution.unresolved_name;
    if (!originalName && contribution.bank_transaction_id) {
      const bankTx = db.prepare('SELECT content, description FROM bank_transactions WHERE id = ?').get(contribution.bank_transaction_id) as any;
      if (bankTx) {
        originalName = bankTx.content || bankTx.description;
      }
    }

    db.prepare(`
      UPDATE contributions SET
        contributor_type = 'UNRESOLVED',
        member_id = NULL,
        external_contributor_id = NULL,
        match_method = 'UNRESOLVED',
        unresolved_name = ?,
        reviewed_by = ?,
        notes = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(originalName || 'Chưa xác định', user.username, id);

    options.auditService.log({
      actor: user.username,
      action: 'UNASSIGN_CONTRIBUTION',
      entityType: 'CONTRIBUTION',
      entityId: id,
      beforeState: contribution,
      afterState: { contributor_type: 'UNRESOLVED', member_id: null, match_method: 'UNRESOLVED', unresolved_name: originalName },
      ipAddress: request.ip,
    });

    return { success: true, message: 'Đã hoàn tác gán khoản thu thành công' };
  });

  // 6. Update Expense Details & Category
  const handleUpdateExpense = async (request: FastifyRequest, reply: FastifyReply) => {
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

    // Validate category if provided
    if (body.category && !VALID_EXPENSE_CATEGORIES.includes(body.category)) {
      return reply.status(400).send({ error: 'Danh mục chi tiêu không hợp lệ' });
    }

    // Validate string lengths
    if (body.vietnameseTitle && body.vietnameseTitle.length > 200) {
      return reply.status(400).send({ error: 'Tên khoản chi không được vượt quá 200 ký tự' });
    }
    if (body.recipientName && body.recipientName.length > 100) {
      return reply.status(400).send({ error: 'Tên người nhận không được vượt quá 100 ký tự' });
    }
    if (body.notes && body.notes.length > 1000) {
      return reply.status(400).send({ error: 'Ghi chú không được vượt quá 1000 ký tự' });
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

    // If admin wants to remember rule for future transactions
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
  };
  app.post('/api/v1/admin/expenses/:id', { preHandler: [requireAdmin] }, handleUpdateExpense);
  app.put('/api/v1/admin/expenses/:id', { preHandler: [requireAdmin] }, handleUpdateExpense);

  // 6.1 Upload Proof / Receipt Attachment for Expense
  app.post('/api/v1/admin/expenses/:id/attachments', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;

    const expense = db.prepare('SELECT id FROM expenses WHERE id = ?').get(id);
    if (!expense) {
      return reply.status(404).send({ error: 'Không tìm thấy khoản chi' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'Vui lòng chọn tập tin chứng từ' });
    }

    try {
      const buffer = await data.toBuffer();
      const attachment = options.attachmentService.saveAttachment(
        id,
        data.filename,
        buffer,
        user.username
      );

      options.auditService.log({
        actor: user.username,
        action: 'UPLOAD_ATTACHMENT',
        entityType: 'ATTACHMENT',
        entityId: attachment.id,
        afterState: { expenseId: id, filename: data.filename, size: buffer.length },
        ipAddress: request.ip,
      });

      return {
        success: true,
        attachment: {
          id: attachment.id,
          expense_id: attachment.expense_id,
          original_name: attachment.original_name,
          mime_type: attachment.mime_type,
          file_size: attachment.file_size,
          created_at: attachment.created_at,
        },
      };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không thể lưu chứng từ' });
    }
  });

  // 6.2 Delete Receipt Attachment
  app.delete('/api/v1/admin/attachments/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;

    const attachment = options.attachmentService.getAttachmentById(id);
    if (!attachment) {
      return reply.status(404).send({ error: 'Không tìm thấy chứng từ' });
    }

    options.attachmentService.deleteAttachment(id);

    options.auditService.log({
      actor: user.username,
      action: 'DELETE_ATTACHMENT',
      entityType: 'ATTACHMENT',
      entityId: id,
      beforeState: { id: attachment.id, expenseId: attachment.expense_id, name: attachment.original_name },
      ipAddress: request.ip,
    });

    return { success: true };
  });

  // 7. Manual SePay Reconciliation
  app.post('/api/v1/admin/reconcile', { preHandler: [requireAdmin] }, async (request, reply) => {
    try {
      const summary = await options.reconciliationService.runReconciliation('MANUAL');
      return { success: true, summary };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Lỗi trong quá trình đối soát' });
    }
  });

  // 8. Finalize Reunion Settlement
  app.post('/api/v1/admin/settlement', { preHandler: [requireAdmin] }, async (request, reply) => {
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

  // 9. Update Suggested Contribution Amount
  const handleUpdateSuggestedAmount = async (request: FastifyRequest, reply: FastifyReply) => {
    const { amount } = request.body as { amount?: number };
    const user = (request as any).user;

    if (!amount || typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount) || amount > 1000000000) {
      return reply.status(400).send({ error: 'Số tiền đề xuất phải là số nguyên dương hợp lệ' });
    }

    const prevRow = db
      .prepare("SELECT value FROM system_state WHERE key = 'suggested_contribution_amount'")
      .get() as { value: string } | undefined;
    const beforeState = { suggestedAmount: prevRow ? parseInt(prevRow.value, 10) : 500000 };

    db.prepare(`
      INSERT INTO system_state (key, value, updated_at)
      VALUES ('suggested_contribution_amount', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `).run(amount.toString(), amount.toString());

    options.auditService.log({
      actor: user.username,
      action: 'UPDATE_SUGGESTED_AMOUNT',
      entityType: 'SYSTEM_STATE',
      entityId: 'suggested_contribution_amount',
      beforeState,
      afterState: { suggestedAmount: amount },
      ipAddress: request.ip,
    });

    return {
      success: true,
      suggestedAmount: amount,
      message: `Đã cập nhật mức đóng góp đề xuất thành ${amount.toLocaleString('vi-VN')} ₫`,
    };
  };

  app.put('/api/v1/admin/config/suggested-amount', { preHandler: [requireAdmin] }, handleUpdateSuggestedAmount);
  app.post('/api/v1/admin/config/suggested-amount', { preHandler: [requireAdmin] }, handleUpdateSuggestedAmount);

  // 10. Financial Overview & Detailed Lists for Admin Dashboard
  app.get('/api/v1/admin/financials', { preHandler: [requireAdmin] }, async () => {
    const incomeRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM contributions').get() as { total: number };
    const expenseRow = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses').get() as { total: number };
    const totalIncome = incomeRow.total;
    const totalExpense = expenseRow.total;
    const balance = totalIncome - totalExpense;

    const contributions = db.prepare(`
      SELECT 
        c.id,
        c.amount,
        c.created_at,
        c.match_method,
        c.contributor_type,
        c.unresolved_name,
        COALESCE(
          CASE 
            WHEN m.disambiguator IS NOT NULL AND m.disambiguator != '' 
            THEN m.full_name || ' (' || m.disambiguator || ')'
            ELSE m.full_name 
          END,
          ext.display_name,
          c.unresolved_name,
          'Chưa xác định'
        ) as contributor_name
      FROM contributions c
      LEFT JOIN members m ON c.member_id = m.id
      LEFT JOIN external_contributors ext ON c.external_contributor_id = ext.id
      ORDER BY c.created_at DESC
    `).all();

    const expenses = db.prepare(`
      SELECT 
        e.id,
        e.amount,
        e.category,
        COALESCE(e.vietnamese_title, e.title, 'Chưa rõ mục đích') as title,
        e.recipient_name,
        e.created_at,
        e.classification_source,
        CASE WHEN e.category = 'UNKNOWN' OR e.vietnamese_title IS NULL THEN 1 ELSE 0 END as needs_review
      FROM expenses e
      ORDER BY e.created_at DESC
    `).all() as any[];

    const allAttachments = db.prepare(`
      SELECT id, expense_id, file_name, original_name, mime_type, file_size, created_at
      FROM attachments
      ORDER BY created_at ASC
    `).all() as any[];

    const attachmentsByExpense = new Map<string, any[]>();
    for (const att of allAttachments) {
      if (!attachmentsByExpense.has(att.expense_id)) {
        attachmentsByExpense.set(att.expense_id, []);
      }
      attachmentsByExpense.get(att.expense_id)!.push({
        id: att.id,
        expense_id: att.expense_id,
        original_name: att.original_name,
        mime_type: att.mime_type,
        file_size: att.file_size,
        created_at: att.created_at,
      });
    }

    const expensesWithAttachments = expenses.map((e) => ({
      ...e,
      attachment_count: (attachmentsByExpense.get(e.id) || []).length,
      attachments: attachmentsByExpense.get(e.id) || [],
    }));

    return {
      totalIncome,
      totalExpense,
      balance,
      contributions,
      expenses: expensesWithAttachments,
    };
  });

  // 12. Admin Activity RSVPs Overview
  app.get('/api/v1/admin/rsvps', { preHandler: [requireAdmin] }, async () => {
    return activityService.getAdminRsvpOverview();
  });

  // 13. Admin Lock / Reopen Activity RSVPs
  app.post('/api/v1/admin/rsvps/lock', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = (request as any).user;
    const body = request.body as { isLocked?: boolean };

    if (typeof body.isLocked !== 'boolean') {
      return reply.status(400).send({ error: 'Trạng thái khóa không hợp lệ.' });
    }

    const result = activityService.setRsvpLock(body.isLocked, user.username);
    return {
      success: true,
      isLocked: result.isLocked,
      message: result.isLocked
        ? 'Đã khóa đăng ký tham gia hoạt động.'
        : 'Đã mở lại đăng ký tham gia hoạt động.',
    };
  });

  // 14. Admin Voting Results Breakdown
  app.get('/api/v1/admin/voting/results', { preHandler: [requireAdmin] }, async () => {
    return votingService.getAdminResults();
  });

  // 15. Admin Lock / Reopen Voting
  app.post('/api/v1/admin/voting/lock', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = (request as any).user;
    const body = request.body as { isLocked?: boolean };

    if (typeof body.isLocked !== 'boolean') {
      return reply.status(400).send({ error: 'Trạng thái khóa bình chọn không hợp lệ.' });
    }

    const result = votingService.setVotingLock(body.isLocked, user.username);
    return {
      success: true,
      isLocked: result.isLocked,
      message: result.isLocked
        ? 'Đã khóa bình chọn trao giải.'
        : 'Đã mở lại bình chọn trao giải.',
    };
  });

  // 16. Admin Manual Tie-Break Winner Selection
  app.post('/api/v1/admin/voting/categories/:id/winner', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { winnerMemberId?: string };

    if (!body.winnerMemberId) {
      return reply.status(400).send({ error: 'Vui lòng chọn thành viên nhận giải.' });
    }

    try {
      const result = votingService.setManualWinner(id, body.winnerMemberId, user.username);
      return {
        success: true,
        message: 'Đã chọn thành viên đạt giải.',
      };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không thể chọn người đạt giải.' });
    }
  });

  // 17. Admin Award Presentation Data (TV/Projector Mode)
  app.get('/api/v1/admin/voting/presentation', { preHandler: [requireAdmin] }, async () => {
    return votingService.getPresentationData();
  });

  // 18. Admin Trigger Lucky Wheel Draw
  app.post('/api/v1/admin/lottery/draw', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = (request as any).user;
    const body = request.body as { prizeId?: string };

    if (!body || !body.prizeId) {
      return reply.status(400).send({ error: 'Vui lòng chỉ định hạng mục giải thưởng cần quay.' });
    }

    try {
      const draw = lotteryService.triggerDraw(body.prizeId, user.username);
      return {
        success: true,
        draw,
      };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không thể thực hiện quay thưởng.' });
    }
  });

  // 19. Admin Staging Lottery Reset (Environment Gated)
  app.post('/api/v1/admin/lottery/reset', { preHandler: [requireAdmin] }, async (request, reply) => {
    const user = (request as any).user;
    try {
      lotteryService.resetLotteryState(user.username, config.ALLOW_LOTTERY_TEST_RESET);
      return {
        success: true,
        message: 'Đã đặt lại kết quả quay thử thành công.',
      };
    } catch (err: any) {
      return reply.status(403).send({ error: err?.message || 'Không thể đặt lại kết quả quay thưởng.' });
    }
  });
}

