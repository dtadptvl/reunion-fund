import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { AuthService } from '../services/auth.service.js';
import { AuditService } from '../services/audit.service.js';
import { ActivityService } from '../services/activity.service.js';
import { LotteryService } from '../services/lottery.service.js';
import { config } from '../config/env.js';

export async function authRoutes(
  app: FastifyInstance,
  options: {
    db: Database.Database;
    authService: AuthService;
    auditService: AuditService;
    activityService?: ActivityService;
    lotteryService?: LotteryService;
  }
) {
  const { db, authService, auditService } = options;
  const activityService = options.activityService || new ActivityService(db);
  const lotteryService = options.lotteryService || new LotteryService(db);

  // In-memory failed login tracking per IP
  const failedLoginAttempts = new Map<string, { count: number; resetAt: number }>();
  const MAX_FAILED_LOGIN_ATTEMPTS = 5;
  const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

  // 1. Member Account Registration
  app.post(
    '/api/v1/auth/register',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const body = request.body as {
      memberId?: string;
      username?: string;
      email?: string;
      password?: string;
    };

    if (!body.memberId || !body.username || !body.email || !body.password) {
      return reply.status(400).send({
        error: 'Vui lòng điền đầy đủ các thông tin: chọn thành viên, tên đăng nhập, email và mật khẩu.',
      });
    }

    try {
      const appUrl = `${request.protocol}://${request.hostname}`;
      const result = await authService.registerMember({
        memberId: body.memberId,
        username: body.username,
        email: body.email,
        password: body.password,
        appUrl: config.APP_URL || appUrl,
      });

      auditService.log({
        actor: result.user.username,
        action: 'REGISTER_ACCOUNT',
        entityType: 'USER',
        entityId: result.user.id,
        afterState: {
          username: result.user.username,
          email: result.user.email,
          role: result.user.role,
          memberId: result.user.member_id,
        },
        ipAddress: request.ip,
      });

      return {
        success: true,
        message: 'Đăng ký tài khoản thành công! Vui lòng kiểm tra email để xác nhận.',
        requiresVerification: true,
        email: result.user.email,
        user: {
          id: result.user.id,
          username: result.user.username,
          fullName: result.user.full_name,
          role: result.user.role,
        },
      };
    } catch (err: any) {
      return reply.status(400).send({
        error: err?.message || 'Không thể đăng ký tài khoản.',
      });
    }
  });

  // 2. Email Verification (POST with code or token)
  app.post(
    '/api/v1/auth/verify-email',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const body = request.body as {
      token?: string;
      code?: string;
      email?: string;
    };

    if (!body.token && (!body.code || !body.email)) {
      return reply.status(400).send({
        error: 'Vui lòng cung cấp mã xác thực 6 số kèm email hoặc liên kết xác thực.',
      });
    }

    try {
      const result = await authService.verifyEmail(body);

      auditService.log({
        actor: result.user.username,
        action: 'VERIFY_EMAIL',
        entityType: 'USER',
        entityId: result.user.id,
        afterState: { email: result.user.email, email_verified: 1, status: 'ACTIVE' },
        ipAddress: request.ip,
      });

      return {
        success: true,
        message: 'Xác thực email thành công! Tài khoản đã được kích hoạt, bạn có thể đăng nhập.',
        user: {
          id: result.user.id,
          username: result.user.username,
          fullName: result.user.full_name,
          role: result.user.role,
        },
      };
    } catch (err: any) {
      return reply.status(400).send({
        error: err?.message || 'Xác thực email thất bại.',
      });
    }
  });

  // 2.1 Email Verification via Direct Link (GET)
  app.get(
    '/api/v1/auth/verify-email',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.type('text/html').send(`
        <html>
          <head><meta charset="utf-8"><title>Lỗi xác thực</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h2 style="color: #dc2626;">Liên kết không hợp lệ</h2>
            <p>Không tìm thấy mã token xác thực.</p>
            <p><a href="/">Quay về trang chủ</a></p>
          </body>
        </html>
      `);
    }

    try {
      const result = await authService.verifyEmail({ token });

      auditService.log({
        actor: result.user.username,
        action: 'VERIFY_EMAIL_LINK',
        entityType: 'USER',
        entityId: result.user.id,
        afterState: { email: result.user.email, email_verified: 1, status: 'ACTIVE' },
        ipAddress: request.ip,
      });

      return reply.type('text/html').send(`
        <html>
          <head>
            <meta charset="utf-8">
            <title>Kích hoạt tài khoản thành công</title>
            <meta http-equiv="refresh" content="3;url=/#login">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f8fafc;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
              <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
              <h2 style="color: #15803d; margin-top: 0;">Xác thực Email thành công!</h2>
              <p style="color: #475569;">Tài khoản của <strong>${result.user.full_name}</strong> đã được kích hoạt thành công.</p>
              <p style="color: #64748b; font-size: 14px;">Hệ thống đang tự động chuyển đến trang Đăng nhập trong 3 giây...</p>
              <div style="margin-top: 24px;">
                <a href="/#login" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                  Đăng Nhập Ngay
                </a>
              </div>
            </div>
          </body>
        </html>
      `);
    } catch (err: any) {
      return reply.type('text/html').send(`
        <html>
          <head><meta charset="utf-8"><title>Xác thực không thành công</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px; background: #f8fafc;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
              <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
              <h2 style="color: #dc2626; margin-top: 0;">Xác thực không thành công</h2>
              <p style="color: #475569;">${err?.message || 'Mã xác thực không hợp lệ hoặc đã hết hạn.'}</p>
              <div style="margin-top: 24px;">
                <a href="/" style="display: inline-block; background: #64748b; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                  Quay Về Trang Chủ
                </a>
              </div>
            </div>
          </body>
        </html>
      `);
    }
  });

  // 3. Resend Email Verification Code
  app.post(
    '/api/v1/auth/resend-verification',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const { identifier } = request.body as { identifier?: string };

    if (!identifier || !identifier.trim()) {
      return reply.status(400).send({ error: 'Vui lòng cung cấp tên đăng nhập hoặc email.' });
    }

    try {
      const appUrl = `${request.protocol}://${request.hostname}`;
      const result = await authService.resendVerification(identifier, config.APP_URL || appUrl);
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không thể gửi lại mã xác thực.' });
    }
  });

  // 4. Unified Login (Member & Admin)
  app.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
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

    const authResult = await authService.authenticate(username, password);

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
    const token = authService.createSession(session);

    reply.setCookie('session_token', token, {
      path: '/',
      httpOnly: true,
      secure: config.COOKIE_SECURE || process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400, // 24 hours
    });

    auditService.log({
      actor: session.username,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: session.userId,
      afterState: { role: session.role, memberId: session.memberId },
      ipAddress: request.ip,
    });

    let canonicalFullName = session.fullName;
    if (session.memberId) {
      const m = db.prepare('SELECT full_name, disambiguator FROM members WHERE id = ?').get(session.memberId) as any;
      if (m) {
        canonicalFullName = `${m.full_name}${m.disambiguator ? ` (${m.disambiguator})` : ''}`;
      }
    } else if (session.role === 'ADMIN') {
      const defaultAdmin = db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any;
      if (defaultAdmin) {
        canonicalFullName = defaultAdmin.full_name;
      }
    }

    const lotteryStats = session.memberId ? lotteryService.getMemberPersonalStats(session.memberId) : null;

    return {
      success: true,
      user: {
        ...session,
        fullName: canonicalFullName,
        totalContributed: lotteryStats?.totalContributed || 0,
        lotteryProbability: lotteryStats?.lotteryProbability || 0,
        lotteryProbabilityDisplay: lotteryStats?.lotteryProbabilityDisplay || '0%',
        isLotteryEligible: lotteryStats?.isLotteryEligible || false,
      },
      lottery: lotteryStats,
    };
  });

  // 5. Logout
  app.post(
    '/api/v1/auth/logout',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const sessionToken = (request.cookies as any)?.session_token;
    if (sessionToken) {
      authService.destroySession(sessionToken);
    }
    reply.clearCookie('session_token', { path: '/' });
    return { success: true };
  });

  // 6. Current User & Profile
  app.get(
    '/api/v1/auth/me',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const sessionToken = (request.cookies as any)?.session_token;
    const session = authService.validateSession(sessionToken);

    if (!session) {
      return reply.status(401).send({ user: null, error: 'Chưa đăng nhập' });
    }

    let memberDetails: any = null;
    let contributions: any[] = [];
    const lotteryStats = session.memberId ? lotteryService.getMemberPersonalStats(session.memberId) : null;

    if (session.memberId) {
      memberDetails = db
        .prepare('SELECT id, full_name, disambiguator, phone, email, notes FROM members WHERE id = ?')
        .get(session.memberId);

      contributions = db
        .prepare(`
          SELECT id, amount, created_at, match_method, notes
          FROM contributions
          WHERE member_id = ?
          ORDER BY created_at DESC
        `)
        .all(session.memberId);
    }

    const canonicalDisplayName = memberDetails
      ? `${memberDetails.full_name}${memberDetails.disambiguator ? ` (${memberDetails.disambiguator})` : ''}`
      : session.role === 'ADMIN'
      ? ((db.prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'").get() as any)?.full_name || session.fullName)
      : session.fullName;

    return {
      user: {
        ...session,
        fullName: canonicalDisplayName,
        totalContributed: lotteryStats?.totalContributed || 0,
        lotteryProbability: lotteryStats?.lotteryProbability || 0,
        lotteryProbabilityDisplay: lotteryStats?.lotteryProbabilityDisplay || '0%',
        isLotteryEligible: lotteryStats?.isLotteryEligible || false,
      },
      member: memberDetails,
      contributions,
      lottery: lotteryStats,
    };
  });

  // 7. Get Current Member Activity RSVPs
  app.get(
    '/api/v1/auth/rsvps',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const sessionToken = (request.cookies as any)?.session_token;
    const session = authService.validateSession(sessionToken);

    if (!session) {
      return reply.status(401).send({ error: 'Vui lòng đăng nhập để xem trạng thái tham gia.' });
    }

    if (!session.memberId) {
      return reply.status(400).send({ error: 'Tài khoản chưa liên kết với thành viên trong danh sách lớp.' });
    }

    const isLocked = activityService.isRsvpLocked();
    const activities = activityService.getActivities();
    const rsvps = activityService.getMemberRsvps(session.memberId);

    return {
      isLocked,
      activities,
      rsvps,
    };
  });

  // 8. Update Current Member Activity RSVPs
  app.post(
    '/api/v1/auth/rsvps',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
    const sessionToken = (request.cookies as any)?.session_token;
    const session = authService.validateSession(sessionToken);

    if (!session) {
      return reply.status(401).send({ error: 'Vui lòng đăng nhập để đăng ký tham gia.' });
    }

    if (!session.memberId) {
      return reply.status(400).send({ error: 'Tài khoản chưa liên kết với thành viên trong danh sách lớp.' });
    }

    const body = request.body as {
      rsvps?: Array<{
        activityId: string;
        participantCount: number;
        notes?: string;
      }>;
    };

    if (!body || !Array.isArray(body.rsvps)) {
      return reply.status(400).send({ error: 'Dữ liệu đăng ký không hợp lệ.' });
    }

    try {
      const result = activityService.saveMemberRsvps(
        session.memberId,
        session.userId,
        body.rsvps,
        session.username
      );
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không thể lưu đăng ký tham gia hoạt động.' });
    }
  });
}
