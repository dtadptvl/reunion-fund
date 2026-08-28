import { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import { MemberService, sortVietnameseMembers } from '../services/member.service.js';
import { ExportService } from '../services/export.service.js';
import { AttachmentService } from '../services/attachment.service.js';
import { ActivityService } from '../services/activity.service.js';
import { LotteryService } from '../services/lottery.service.js';
import {
  generatePaymentCode,
  formatTransferContent,
  generateBankDisplayName,
  removeVietnameseDiacritics,
} from '../services/vietqr.service.js';
import { AuthService } from '../services/auth.service.js';
import { config } from '../config/env.js';

export async function publicRoutes(
  app: FastifyInstance,
  options: {
    db: Database.Database;
    memberService: MemberService;
    exportService: ExportService;
    attachmentService: AttachmentService;
    activityService?: ActivityService;
    lotteryService?: LotteryService;
    authService?: AuthService;
  }
) {
  const db = options.db;
  const activityService = options.activityService || new ActivityService(db);
  const lotteryService = options.lotteryService || new LotteryService(db);

  // 0. Public Activities & RSVPs
  app.get(
    '/api/v1/public/activities',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async () => {
      return activityService.getPublicActivitySummaries();
    }
  );

  // 0.1 Public Lucky Wheel State (High Capacity for Shared NAT Event Polling)
  app.get(
    '/api/v1/public/lottery/wheel-state',
    {
      config: {
        rateLimit: {
          max: 3000,
          timeWindow: '1 minute',
        },
      },
    },
    async () => {
      return lotteryService.getPublicWheelState();
    }
  );

  // 0.2 Public Background Music Streaming
  app.get(
    '/api/v1/public/lottery/background-music',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const musicMeta = lotteryService.getBackgroundMusicMetadata();
      const storage = lotteryService.getStorage();
      // Per-record provenance only (B3): redirect to edge media exclusively when the
      // music metadata's own storageProvider is R2/R2_MIRRORED. App-level provider
      // mode must NOT override LOCAL/legacy music, which streams from local files.
      const metaIsR2 = musicMeta?.storageProvider === 'R2' || musicMeta?.storageProvider === 'R2_MIRRORED';

      if (musicMeta && metaIsR2 && musicMeta.storageKey) {
        const publicUrl = storage.getPublicUrl(musicMeta.storageKey);
        reply.header('Cache-Control', 'public, max-age=3600');
        return reply.redirect(publicUrl, 302);
      }

      // LOCAL / legacy provenance (or R2 metadata missing its key): stream from local file path
      const audio = lotteryService.getBackgroundMusicFilePath();
      if (!audio || !fs.existsSync(audio.filePath)) {
        return reply.status(404).send({ error: 'Chưa có nhạc nền được tải lên.' });
      }

      const stream = fs.createReadStream(audio.filePath);
      reply.header('Content-Type', audio.mimeType);
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(stream);
    }
  );

  // 1. Overview Financial Totals & Recent Activity
  app.get(
    '/api/v1/public/overview',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async () => {
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
    const suggestedRow = db
      .prepare("SELECT value FROM system_state WHERE key = 'suggested_contribution_amount'")
      .get() as { value: string } | undefined;
    const suggestedAmount = suggestedRow ? parseInt(suggestedRow.value, 10) : 500000;

    const recentContributions = db
      .prepare(`
        SELECT
          c.id,
          c.amount,
          c.created_at,
          COALESCE(
            CASE WHEN m.disambiguator IS NOT NULL THEN m.full_name || ' (' || m.disambiguator || ')' ELSE m.full_name END,
            ext.display_name,
            'Chưa xác định'
          ) as contributor_name,
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
    const rawSuggested = isNaN(suggestedAmount) || suggestedAmount <= 0 ? 500000 : suggestedAmount;
    const targetAmount = rawSuggested * 18;
    const progressPercent = targetAmount > 0 ? (totalIncome / targetAmount) * 100 : 0;

    return {
      eventTitle: config.REUNION_EVENT_TITLE,
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      contributorCount: countRow.count,
      isSettled: settledRow?.value === 'true',
      suggestedAmount: rawSuggested,
      fundGoal: {
        suggestedAmount: rawSuggested,
        targetAmount,
        targetMultiplier: 18,
        totalIncome,
        progressPercent: Math.round(progressPercent * 10) / 10,
        isGoalReached: totalIncome >= targetAmount,
        overGoalPercent: totalIncome > targetAmount ? Math.round((progressPercent - 100) * 10) / 10 : 0,
      },
      recentContributions,
      recentExpenses,
    };
  });

  // 1.1 Public Global Configuration
  app.get(
    '/api/v1/public/config',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async () => {
      const suggestedRow = db
        .prepare("SELECT value FROM system_state WHERE key = 'suggested_contribution_amount'")
        .get() as { value: string } | undefined;
      const suggestedAmount = suggestedRow ? parseInt(suggestedRow.value, 10) : 500000;
      const rawSuggested = isNaN(suggestedAmount) || suggestedAmount <= 0 ? 500000 : suggestedAmount;
      const targetAmount = rawSuggested * 18;

      return {
        eventTitle: config.REUNION_EVENT_TITLE,
        suggestedAmount: rawSuggested,
        targetAmount,
        targetMultiplier: 18,
      };
    }
  );

  // 2. Member Roster Search
  app.get(
    '/api/v1/public/members',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async (request) => {
      const { q } = request.query as { q?: string };
      const members = options.memberService.searchMembers(q || '', 100);
      return { members };
    }
  );

  // 2.1 Public Name Correction Request
  app.post(
    '/api/v1/public/members/:id/correction',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const { id } = request.params as { id: string };
    const { requestedName, notes } = request.body as { requestedName?: string; notes?: string };

    if (!requestedName || !requestedName.trim() || requestedName.trim().length > 100) {
      return reply.status(400).send({ error: 'Vui lòng nhập tên đúng của bạn (tối đa 100 ký tự)' });
    }
    if (notes && notes.length > 1000) {
      return reply.status(400).send({ error: 'Ghi chú không được vượt quá 1000 ký tự' });
    }

    try {
      const reqRow = options.memberService.createNameCorrectionRequest(
        id,
        requestedName.trim(),
        notes?.trim()
      );
      return {
        success: true,
        requestId: reqRow.id,
        message: 'Đã gửi yêu cầu sửa tên. Ban Quản trị sẽ kiểm tra và cập nhật. Bạn vẫn có thể tiếp tục đóng quỹ.',
      };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không thể tạo yêu cầu sửa tên' });
    }
  });

  // 3. Create Payment Intent & VietQR
  app.post(
    '/api/v1/public/intent',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const body = request.body as {
      memberId?: string;
      customName?: string;
      amount: number;
    };

    if (
      !body.amount ||
      typeof body.amount !== 'number' ||
      !Number.isInteger(body.amount) ||
      body.amount <= 0 ||
      body.amount > 1000000000
    ) {
      return reply.status(400).send({
        error: 'Số tiền đóng góp phải là số nguyên dương hợp lệ (VND)',
      });
    }

    // Check authenticated session
    const sessionToken = (request.cookies as any)?.session_token;
    const session = options.authService ? options.authService.validateSession(sessionToken) : null;

    let bankDisplayName = 'BAN LOP';
    let memberId: string | null = null;
    let externalContributorId: string | null = null;

    if (session && session.memberId) {
      // Authenticated canonical member/admin: strictly bind to session.memberId
      if (body.memberId && body.memberId !== session.memberId) {
        return reply.status(403).send({ error: 'Không thể tạo mã đóng quỹ dưới danh tính thành viên khác' });
      }
      const member = db
        .prepare('SELECT * FROM members WHERE id = ?')
        .get(session.memberId) as any;
      if (!member) {
        return reply.status(404).send({ error: 'Không tìm thấy thông tin thành viên đã đăng nhập' });
      }
      memberId = member.id;
      bankDisplayName = member.bank_display_name;
    } else if (body.memberId) {
      // Unauthenticated request attempting to submit a canonical memberId: REJECT!
      return reply.status(403).send({ error: 'Vui lòng đăng nhập tài khoản để đóng quỹ dưới danh nghĩa thành viên lớp' });
    } else if (body.customName && body.customName.trim()) {
      // Approved Guest flow
      const trimmedCustomName = body.customName.trim();
      if (trimmedCustomName.length > 100) {
        return reply.status(400).send({ error: 'Tên người đóng góp không được vượt quá 100 ký tự' });
      }

      // Check for canonical member impersonation
      const normGuest = removeVietnameseDiacritics(trimmedCustomName);
      const canonicalMatch = db
        .prepare('SELECT id, full_name FROM members WHERE UPPER(normalized_name) = UPPER(?)')
        .get(normGuest) as any;
      if (canonicalMatch) {
        return reply.status(400).send({
          error: `"${canonicalMatch.full_name}" là thành viên trong danh sách lớp. Vui lòng đăng nhập để đóng quỹ.`,
        });
      }

      const ext = options.memberService.createExternalContributor(trimmedCustomName);
      externalContributorId = ext.id;
      bankDisplayName = generateBankDisplayName(ext.raw_name);
    } else {
      return reply.status(400).send({ error: 'Vui lòng đăng nhập hoặc nhập tên người đóng góp' });
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
      memberId,
      externalContributorId,
      expectedAmount: body.amount,
      transferContent,
      bankAccount: config.SEPAY_BANK_ACCOUNT,
      bankName: config.SEPAY_BANK_NAME,
      accountName: config.SEPAY_ACCOUNT_NAME,
      qrUrl,
    };
  });

  // 4. Check Intent Status (High Capacity for Contributor Polling)
  app.get(
    '/api/v1/public/intent/:code',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
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

  // 5. Contributors Public List (Alphabetical with lottery probability)
  app.get(
    '/api/v1/public/contributors',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async () => {
    // Get canonical class members with calculated lottery statistics
    const lotteryData = lotteryService.getMembersWithLotteryStats();

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
      `)
      .all() as Array<{
        id: string;
        full_name: string;
        total_contributed: number;
        contribution_count: number;
      }>;

    const sortedExternal = sortVietnameseMembers(externalContributors).map((ext) => ({
      ...ext,
      disambiguator: null,
      lottery_probability: 0,
      lottery_probability_display: '0%',
      is_lottery_eligible: false,
    }));

    return {
      members: lotteryData.members,
      external: sortedExternal,
      eligiblePool: lotteryData.eligiblePool,
      baseFundExclusion: lotteryData.baseFundExclusion,
      formulaDescription: lotteryData.formulaDescription,
      baseFundNote: lotteryData.baseFundNote,
    };
  });

  // 6. Contributor Detail History
  app.get(
    '/api/v1/public/contributors/:id',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
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
  app.get(
    '/api/v1/public/expenses',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async () => {
    const expenses = db
      .prepare(`
        SELECT
          e.id,
          e.amount,
          e.category,
          COALESCE(e.vietnamese_title, e.title, 'Chưa rõ mục đích') as title,
          e.recipient_name,
          e.created_at,
          e.notes
        FROM expenses e
        ORDER BY e.created_at DESC
      `)
      .all() as any[];

    const allAttachments = db
      .prepare(`
        SELECT id, expense_id, file_name, original_name, mime_type, file_size, created_at
        FROM attachments
        ORDER BY created_at ASC
      `)
      .all() as any[];

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

    return { expenses: expensesWithAttachments };
  });

  // 7.1 Public Settlement Summary & Financial Totals
  app.get(
    '/api/v1/public/settlement',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async () => {
    const totalInRow = db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM contributions')
      .get() as { total: number };

    const totalOutRow = db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE is_settlement_transfer = 0')
      .get() as { total: number };

    const totalSettlementRow = db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE is_settlement_transfer = 1')
      .get() as { total: number };

    const totalIn = totalInRow.total;
    const totalOut = totalOutRow.total;
    const totalSettlement = totalSettlementRow.total;
    const currentBalance = totalIn - totalOut - totalSettlement;

    const participatingMembersRow = db
      .prepare('SELECT COUNT(DISTINCT member_id) as count FROM contributions WHERE member_id IS NOT NULL')
      .get() as { count: number };

    const totalMembersRow = db
      .prepare('SELECT COUNT(*) as count FROM members')
      .get() as { count: number };

    const participatingCount = participatingMembersRow.count || 0;
    const totalMembersCount = totalMembersRow.count || 40;
    const averageCostPerParticipant = participatingCount > 0 ? Math.round(totalOut / participatingCount) : 0;

    const systemState = db
      .prepare('SELECT settlement_status, target_amount, event_date FROM system_state LIMIT 1')
      .get() as any;

    return {
      totalContributions: totalIn,
      totalExpenses: totalOut,
      totalSettlementTransfers: totalSettlement,
      currentBalance,
      participatingMembersCount: participatingCount,
      totalMembersCount,
      averageCostPerParticipant,
      settlementStatus: systemState?.settlement_status || 'OPEN',
      targetAmount: systemState?.target_amount || 20000000,
      eventDate: systemState?.event_date || '2026-08-30',
    };
  });

  // 8. Public Exports
  app.get(
    '/api/v1/public/export/xlsx',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (_req, reply) => {
    const buffer = options.exportService.generatePublicXLSX();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename="bao_cao_quy_reunion.xlsx"');
    return reply.send(buffer);
  });

  app.get(
    '/api/v1/public/export/csv/:type',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const { type } = request.params as { type: 'contributions' | 'expenses' };
    if (type !== 'contributions' && type !== 'expenses') {
      return reply.status(400).send({ error: 'Loại export không hợp lệ' });
    }
    const csvContent = options.exportService.generatePublicCSV(type);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${type}_reunion.csv"`);
    return reply.send('\uFEFF' + csvContent); // Add UTF-8 BOM for Excel
  });

  // 9. Public Expense Attachments List
  app.get(
    '/api/v1/public/expenses/:id/attachments',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async (request) => {
    const { id } = request.params as { id: string };
    const attachments = options.attachmentService.getAttachmentsForExpense(id);
    return {
      attachments: attachments.map((a) => ({
        id: a.id,
        expense_id: a.expense_id,
        original_name: a.original_name,
        mime_type: a.mime_type,
        file_size: a.file_size,
        created_at: a.created_at,
      })),
    };
  });

  // 10. Public Attachment Safe Download / View
  app.get(
    '/api/v1/public/attachments/:id',
    {
      config: {
        rateLimit: {
          max: 600,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const { id } = request.params as { id: string };
    const attachment = options.attachmentService.getAttachmentById(id);
    if (!attachment) {
      return reply.status(404).send({ error: 'Không tìm thấy chứng từ' });
    }

    const storage = options.attachmentService.getStorage();
    // Per-row provenance only (B3): redirect to edge media exclusively for rows whose
    // own storage_provider is R2/R2_MIRRORED. App-level provider mode must NOT
    // override LOCAL/legacy rows; those keep streaming from the local filesystem.
    const rowIsR2 = attachment.storage_provider === 'R2' || attachment.storage_provider === 'R2_MIRRORED';

    if (rowIsR2 && attachment.storage_key) {
      const publicUrl = storage.getPublicUrl(attachment.storage_key);
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.redirect(publicUrl, 302);
    }

    // LOCAL / legacy provenance: stream safely from the local filesystem
    const filePath = options.attachmentService.getSafeFilePath(attachment);
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Tập tin chứng từ không tồn tại' });
    }

    const buffer = fs.readFileSync(filePath);
    reply.header('Content-Type', attachment.mime_type);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.original_name)}"`);
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(buffer);
  });
}
