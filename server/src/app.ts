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

import { BankSyncProvider } from './providers/bank-sync/types.js';
import { SePayProvider } from './providers/bank-sync/sepay-provider.js';
import { MockBankSyncProvider } from './providers/bank-sync/mock-provider.js';

import { AIProvider } from './providers/ai/types.js';
import { GeminiAIProvider } from './providers/ai/gemini-provider.js';
import { MockAIProvider } from './providers/ai/mock-ai-provider.js';

import { ContributionService } from './services/contribution.service.js';
import { ExpenseService } from './services/expense.service.js';
import { MemberService } from './services/member.service.js';
import { ReconciliationService } from './services/reconciliation.service.js';
import { AuthService } from './services/auth.service.js';
import { ExportService } from './services/export.service.js';
import { AuditService } from './services/audit.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BuildAppOptions {
  db: Database.Database;
  bankSyncProvider?: BankSyncProvider;
  aiProvider?: AIProvider;
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

  // Services
  const contributionService = new ContributionService(db);
  const expenseService = new ExpenseService(db, aiProvider);
  const memberService = new MemberService(db);
  const reconciliationService = new ReconciliationService(
    db,
    bankSyncProvider,
    contributionService,
    expenseService
  );
  const authService = new AuthService(db);
  authService.seedInitialStaff(config.ADMIN_USERNAME, config.ADMIN_PASSWORD_HASH);
  const exportService = new ExportService(db);
  const auditService = new AuditService(db);

  // Security Plugins
  app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.register(cookie, {
    secret: config.SESSION_SECRET,
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
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
  });
  app.register(adminRoutes, {
    db,
    authService,
    memberService,
    reconciliationService,
    auditService,
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
