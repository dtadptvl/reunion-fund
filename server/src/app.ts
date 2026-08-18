import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { config } from './config/env.js';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhook.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';

import { BankSyncProvider } from './providers/bank-sync/types.js';
import { SePayProvider } from './providers/bank-sync/sepay-provider.js';
import { MockBankSyncProvider } from './providers/bank-sync/mock-provider.js';

import { AIProvider } from './providers/ai/types.js';
import { GeminiAIProvider } from './providers/ai/gemini-provider.js';
import { MockAIProvider } from './providers/ai/mock-ai-provider.js';

import { EmailProvider } from './providers/email/types.js';
import { MockEmailProvider } from './providers/email/mock-email-provider.js';

import { ContributionService } from './services/contribution.service.js';
import { ExpenseService } from './services/expense.service.js';
import { MemberService } from './services/member.service.js';
import { ReconciliationService } from './services/reconciliation.service.js';
import { AuthService } from './services/auth.service.js';
import { ExportService } from './services/export.service.js';
import { AuditService } from './services/audit.service.js';
import { ActivityService } from './services/activity.service.js';
import { LotteryService } from './services/lottery.service.js';

import multipart from '@fastify/multipart';
import { AttachmentService } from './services/attachment.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BuildAppOptions {
  db: Database.Database;
  bankSyncProvider?: BankSyncProvider;
  aiProvider?: AIProvider;
  emailProvider?: EmailProvider;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  // Preserve original raw body for cryptographic HMAC verification
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const json = body ? JSON.parse(body as string) : {};
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const db = options.db;

  // Providers
  const bankSyncProvider =
    options.bankSyncProvider ||
    new SePayProvider({
      baseUrl: config.SEPAY_BASE_URL,
      apiToken: config.SEPAY_API_TOKEN,
      webhookSecret: config.SEPAY_WEBHOOK_SECRET,
    });

  const aiProvider =
    options.aiProvider ||
    (config.GEMINI_API_KEY === 'placeholder_gemini_key'
      ? new MockAIProvider()
      : new GeminiAIProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL));

  const emailProvider = options.emailProvider || new MockEmailProvider();

  // Services
  const contributionService = new ContributionService(db);
  const expenseService = new ExpenseService(db, aiProvider);
  const memberService = new MemberService(db);
  memberService.seedCanonicalRoster();
  const reconciliationService = new ReconciliationService(
    db,
    bankSyncProvider,
    contributionService,
    expenseService
  );
  const authService = new AuthService(db, emailProvider);
  authService.seedInitialStaff(config.ADMIN_USERNAME, config.ADMIN_PASSWORD_HASH).catch(console.error);
  const exportService = new ExportService(db);
  const auditService = new AuditService(db);
  const attachmentService = new AttachmentService(db, config.STORAGE_PATH);
  const activityService = new ActivityService(db);
  const lotteryService = new LotteryService(db);

  // Security Plugins
  app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.register(cookie, {
    secret: config.SESSION_SECRET,
  });

  app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    allowList: (req: any) => {
      const rawUrl = req.raw?.url || req.url || '';
      return rawUrl.startsWith('/assets/') || rawUrl === '/vite.svg' || rawUrl === '/favicon.ico' || (!rawUrl.startsWith('/api') && !rawUrl.startsWith('/health'));
    },
  });

  app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 5,
    },
  });

  // Security Headers Hook
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https://img.vietqr.io; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'"
    );

    if (config.COOKIE_SECURE || process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (request.raw.url && (request.raw.url.startsWith('/api/v1/admin') || request.raw.url.startsWith('/api/v1/auth'))) {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      reply.header('Pragma', 'no-cache');
    }
  });

  // Ensure upload storage directory exists
  if (!fs.existsSync(config.STORAGE_PATH)) {
    fs.mkdirSync(config.STORAGE_PATH, { recursive: true });
  }

  // Register Routes
  app.register(healthRoutes, { db });
  app.register(webhookRoutes, {
    db,
    bankSyncProvider,
    contributionService,
    expenseService,
  });
  app.register(publicRoutes, {
    db,
    memberService,
    exportService,
    attachmentService,
    activityService,
    lotteryService,
  });
  app.register(authRoutes, {
    db,
    authService,
    auditService,
    activityService,
    lotteryService,
  });
  app.register(adminRoutes, {
    db,
    authService,
    memberService,
    reconciliationService,
    auditService,
    attachmentService,
    activityService,
    lotteryService,
  });

  // Serve static client bundle if available
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && req.raw.url.startsWith('/api')) {
        return reply.status(404).send({ error: 'Endpoint không tồn tại' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
