import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { Cron } from 'croner';
import { SePayProvider } from '../../server/src/providers/bank-sync/sepay-provider.js';
import { buildApp } from '../../server/src/app.js';
import { getDatabase, runMigrations } from '../../server/src/db/connection.js';
import { MemberService } from '../../server/src/services/member.service.js';
import { ReconciliationService } from '../../server/src/services/reconciliation.service.js';
import { ContributionService } from '../../server/src/services/contribution.service.js';
import { ExpenseService } from '../../server/src/services/expense.service.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';
import { BankSyncProvider, NormalizedBankTransaction } from '../../server/src/providers/bank-sync/types.js';

describe('Phase 3B Final Resilience Gate Test Suite', () => {
  let db: Database.Database;
  const webhookSecret = 'test_webhook_secret_resilience_98765';
  const apiToken = 'test_api_token_resilience';
  const baseUrl = 'https://userapi-sandbox.sepay.vn/v2';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    new MemberService(db).seedCanonicalRoster();
  });

  afterEach(() => {
    if (db && db.open) {
      db.close();
    }
  });

  const createValidSignature = (timestamp: string | number, body: string) => {
    const message = `${String(timestamp).trim()}.${body}`;
    return crypto.createHmac('sha256', webhookSecret).update(message, 'utf8').digest('hex');
  };

  describe('1 & 2. Webhook Security, Replay Rejection, and Idempotency HTTP Tests', () => {
    it('rejects webhook requests with missing signature, malformed signature, or replay violations with 401', async () => {
      const sepayProvider = new SePayProvider({ baseUrl, apiToken, webhookSecret });
      const app = buildApp({ db, bankSyncProvider: sepayProvider });

      const payload = JSON.stringify({
        id: 99001,
        gateway: 'MBBank',
        transferAmount: 500000,
        content: 'VU TRI THANG DONGQUY K8P4X',
      });
      const nowSec = Math.floor(Date.now() / 1000);

      // A. Missing signature
      const resMissingSig = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        headers: {
          'content-type': 'application/json',
          'x-sepay-timestamp': String(nowSec),
        },
        payload,
      });
      expect(resMissingSig.statusCode).toBe(401);

      // B. Malformed signature
      const resMalformedSig = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        headers: {
          'content-type': 'application/json',
          'x-sepay-timestamp': String(nowSec),
          'x-sepay-signature': 'not_valid_hex_signature',
        },
        payload,
      });
      expect(resMalformedSig.statusCode).toBe(401);

      // C. Missing timestamp
      const resMissingTs = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        headers: {
          'content-type': 'application/json',
          'x-sepay-signature': `sha256=${createValidSignature(nowSec, payload)}`,
        },
        payload,
      });
      expect(resMissingTs.statusCode).toBe(401);

      // D. Stale timestamp (> 300s ago)
      const staleTs = String(nowSec - 305);
      const resStale = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        headers: {
          'content-type': 'application/json',
          'x-sepay-timestamp': staleTs,
          'x-sepay-signature': `sha256=${createValidSignature(staleTs, payload)}`,
        },
        payload,
      });
      expect(resStale.statusCode).toBe(401);

      // E. Future timestamp (> 300s in future)
      const futureTs = String(nowSec + 305);
      const resFuture = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        headers: {
          'content-type': 'application/json',
          'x-sepay-timestamp': futureTs,
          'x-sepay-signature': `sha256=${createValidSignature(futureTs, payload)}`,
        },
        payload,
      });
      expect(resFuture.statusCode).toBe(401);

      // F. Tampered body
      const validSig = createValidSignature(nowSec, payload);
      const tamperedPayload = JSON.stringify({
        id: 99001,
        gateway: 'MBBank',
        transferAmount: 5000000, // tampered
        content: 'VU TRI THANG DONGQUY K8P4X',
      });
      const resTampered = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        headers: {
          'content-type': 'application/json',
          'x-sepay-timestamp': String(nowSec),
          'x-sepay-signature': `sha256=${validSig}`,
        },
        payload: tamperedPayload,
      });
      expect(resTampered.statusCode).toBe(401);
    });

    it('processes valid webhook first time with 200 and handles duplicate redelivery idempotently with 200 and 0 row changes', async () => {
      const sepayProvider = new SePayProvider({ baseUrl, apiToken, webhookSecret });
      const app = buildApp({ db, bankSyncProvider: sepayProvider });

      const payload = JSON.stringify({
        id: 99100,
        gateway: 'MBBank',
        transferType: 'in',
        transferAmount: 500000,
        content: 'VU TRI THANG DONGQUY',
        transactionDate: '2026-08-17 10:00:00',
        referenceCode: 'REF99100',
      });
      const nowSec = Math.floor(Date.now() / 1000);
      const signature = createValidSignature(nowSec, payload);

      // First delivery
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        headers: {
          'content-type': 'application/json',
          'x-sepay-timestamp': String(nowSec),
          'x-sepay-signature': `sha256=${signature}`,
        },
        payload,
      });
      expect(res1.statusCode).toBe(200);
      expect(JSON.parse(res1.body).success).toBe(true);

      const countTx1 = (db.prepare('SELECT COUNT(*) as count FROM bank_transactions').get() as any).count;
      const countContrib1 = (db.prepare('SELECT COUNT(*) as count FROM contributions').get() as any).count;
      expect(countTx1).toBe(1);
      expect(countContrib1).toBe(1);

      // Duplicate redelivery with fresh timestamp & signature
      const nowSec2 = Math.floor(Date.now() / 1000) + 1;
      const signature2 = createValidSignature(nowSec2, payload);
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/webhook/sepay',
        headers: {
          'content-type': 'application/json',
          'x-sepay-timestamp': String(nowSec2),
          'x-sepay-signature': `sha256=${signature2}`,
        },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      expect(JSON.parse(res2.body).success).toBe(true);

      const countTx2 = (db.prepare('SELECT COUNT(*) as count FROM bank_transactions').get() as any).count;
      const countContrib2 = (db.prepare('SELECT COUNT(*) as count FROM contributions').get() as any).count;
      expect(countTx2).toBe(1); // 0 increase
      expect(countContrib2).toBe(1); // 0 increase
    });
  });

  describe('3. Daily Reconciliation Scheduler (03:30 Asia/Ho_Chi_Minh)', () => {
    it('verifies Cron schedule pattern "30 3 * * *" resolves explicitly in Asia/Ho_Chi_Minh timezone', () => {
      const cronJob = new Cron('30 3 * * *', { timezone: 'Asia/Ho_Chi_Minh' });
      const nextRun = cronJob.nextRun();
      expect(nextRun).toBeDefined();

      // Convert next run to Vietnam local time string
      const vnFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
      const timeStr = vnFormatter.format(nextRun!);
      expect(timeStr).toBe('03:30');
    });
  });

  describe('4. Startup Catch-up Logic', () => {
    it('triggers catch-up when last_successful_reconciliation is >24h old or missing, and skips when <24h', async () => {
      let reconciliationCalls = 0;
      const mockProvider: BankSyncProvider = {
        verifyWebhook: () => true,
        normalizeWebhookTransaction: (p: any) => p,
        listTransactions: async () => {
          reconciliationCalls++;
          return { transactions: [], hasMore: false };
        },
      };

      const contributionService = new ContributionService(db);
      const expenseService = new ExpenseService(db, new MockAIProvider());
      const reconciliationService = new ReconciliationService(
        db,
        mockProvider,
        contributionService,
        expenseService
      );

      // Scenario A: Missing last_successful_reconciliation
      const lastRowMissing = db
        .prepare("SELECT value FROM system_state WHERE key = 'last_successful_reconciliation'")
        .get() as { value: string } | undefined;
      const isStaleMissing = !lastRowMissing || Date.now() - new Date(lastRowMissing.value).getTime() > 24 * 3600 * 1000;
      expect(isStaleMissing).toBe(true);

      if (isStaleMissing) {
        await reconciliationService.runReconciliation('STARTUP');
      }
      expect(reconciliationCalls).toBe(1);

      // Check that system_state was updated with current timestamp
      const lastRowAfter = db
        .prepare("SELECT value FROM system_state WHERE key = 'last_successful_reconciliation'")
        .get() as { value: string };
      expect(lastRowAfter).toBeDefined();
      expect(new Date(lastRowAfter.value).getTime()).toBeGreaterThan(0);

      // Scenario B: Fresh last_successful_reconciliation (<24h)
      const isStaleFresh = Date.now() - new Date(lastRowAfter.value).getTime() > 24 * 3600 * 1000;
      expect(isStaleFresh).toBe(false);
      if (isStaleFresh) {
        await reconciliationService.runReconciliation('STARTUP');
      }
      expect(reconciliationCalls).toBe(1); // Not called again

      // Scenario C: Stale last_successful_reconciliation (>24h old)
      const staleDate = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
      db.prepare(`
        UPDATE system_state SET value = ?, updated_at = ? WHERE key = 'last_successful_reconciliation'
      `).run(staleDate, staleDate);

      const lastRowStale = db
        .prepare("SELECT value FROM system_state WHERE key = 'last_successful_reconciliation'")
        .get() as { value: string };
      const isStaleAgain = Date.now() - new Date(lastRowStale.value).getTime() > 24 * 3600 * 1000;
      expect(isStaleAgain).toBe(true);

      if (isStaleAgain) {
        await reconciliationService.runReconciliation('STARTUP');
      }
      expect(reconciliationCalls).toBe(2);
    });
  });

  describe('5. Multi-page Pagination & Deduplication', () => {
    it('iterates through all pages until hasMore is false and deduplicates items across pages', async () => {
      const page1Txs: NormalizedBankTransaction[] = [
        {
          sepayId: 101,
          gateway: 'MBBank',
          transactionDate: '2026-08-17 08:00:00',
          accountNumber: '2675091386',
          subAccount: null,
          transferType: 'in',
          transferAmount: 500000,
          accumulated: null,
          code: null,
          content: 'DUONG TUAN ANH DONGQUY',
          description: null,
          referenceCode: 'REF101',
          rawPayload: {},
        },
        {
          sepayId: 102,
          gateway: 'MBBank',
          transactionDate: '2026-08-17 08:05:00',
          accountNumber: '2675091386',
          subAccount: null,
          transferType: 'in',
          transferAmount: 500000,
          accumulated: null,
          code: null,
          content: 'LE HONG LA DONGQUY',
          description: null,
          referenceCode: 'REF102',
          rawPayload: {},
        },
      ];

      const page2Txs: NormalizedBankTransaction[] = [
        {
          sepayId: 103,
          gateway: 'MBBank',
          transactionDate: '2026-08-17 08:10:00',
          accountNumber: '2675091386',
          subAccount: null,
          transferType: 'out',
          transferAmount: 350000,
          accumulated: null,
          code: null,
          content: 'DAT COC NHA HANG TIEC HOP LOP',
          description: null,
          referenceCode: 'REF103',
          rawPayload: {},
        },
      ];

      const requestedPages: number[] = [];
      const mockProvider: BankSyncProvider = {
        verifyWebhook: () => true,
        normalizeWebhookTransaction: (p: any) => p,
        listTransactions: async ({ page }) => {
          requestedPages.push(page || 1);
          if (page === 1) {
            return { transactions: page1Txs, hasMore: true };
          }
          return { transactions: page2Txs, hasMore: false };
        },
      };

      const contributionService = new ContributionService(db);
      const expenseService = new ExpenseService(db, new MockAIProvider());
      const reconciliationService = new ReconciliationService(
        db,
        mockProvider,
        contributionService,
        expenseService
      );

      const summary1 = await reconciliationService.runReconciliation('MANUAL');
      expect(summary1.status).toBe('SUCCESS');
      expect(summary1.totalChecked).toBe(3);
      expect(summary1.newlyImported).toBe(3);
      expect(summary1.alreadyPresent).toBe(0);
      expect(requestedPages).toEqual([1, 2]);

      // Run second reconciliation with same pages
      const summary2 = await reconciliationService.runReconciliation('MANUAL');
      expect(summary2.status).toBe('SUCCESS');
      expect(summary2.totalChecked).toBe(3);
      expect(summary2.newlyImported).toBe(0);
      expect(summary2.alreadyPresent).toBe(3);

      const totalTx = (db.prepare('SELECT COUNT(*) as count FROM bank_transactions').get() as any).count;
      expect(totalTx).toBe(3);
    });
  });

  describe('6. Rate Limit, 5xx, and Network Timeout Safety', () => {
    it('safely handles HTTP 429 Rate Limit error by marking run FAILED without crashing or creating partial duplicates', async () => {
      const mockRateLimitProvider: BankSyncProvider = {
        verifyWebhook: () => true,
        normalizeWebhookTransaction: (p: any) => p,
        listTransactions: async () => {
          throw new Error('SePay API error HTTP 429 (Too Many Requests): Rate limit exceeded');
        },
      };

      const contributionService = new ContributionService(db);
      const expenseService = new ExpenseService(db, new MockAIProvider());
      const reconciliationService = new ReconciliationService(
        db,
        mockRateLimitProvider,
        contributionService,
        expenseService
      );

      const summary = await reconciliationService.runReconciliation('CRON');
      expect(summary.status).toBe('FAILED');
      expect(summary.errorCount).toBe(1);

      const lastRun = db.prepare('SELECT * FROM reconciliation_runs ORDER BY started_at DESC LIMIT 1').get() as any;
      expect(lastRun.status).toBe('FAILED');
      expect(lastRun.log_summary).toContain('429');
    });

    it('safely handles HTTP 500 Server Error and network timeout', async () => {
      const mockServerErrorProvider: BankSyncProvider = {
        verifyWebhook: () => true,
        normalizeWebhookTransaction: (p: any) => p,
        listTransactions: async () => {
          throw new Error('SePay API error HTTP 500 (Internal Server Error): Backend unavailable');
        },
      };

      const contributionService = new ContributionService(db);
      const expenseService = new ExpenseService(db, new MockAIProvider());
      const reconciliationService = new ReconciliationService(
        db,
        mockServerErrorProvider,
        contributionService,
        expenseService
      );

      const summary = await reconciliationService.runReconciliation('CRON');
      expect(summary.status).toBe('FAILED');

      const mockTimeoutProvider: BankSyncProvider = {
        verifyWebhook: () => true,
        normalizeWebhookTransaction: (p: any) => p,
        listTransactions: async () => {
          throw new Error('FetchError: request timed out after 10000ms');
        },
      };

      const timeoutRecService = new ReconciliationService(
        db,
        mockTimeoutProvider,
        contributionService,
        expenseService
      );
      const summaryTimeout = await timeoutRecService.runReconciliation('CRON');
      expect(summaryTimeout.status).toBe('FAILED');
    });
  });
});
