import { Cron } from 'croner';
import { getDatabase } from './db/connection.js';
import { buildApp } from './app.js';
import { config } from './config/env.js';
import { SePayProvider } from './providers/bank-sync/sepay-provider.js';
import { MockBankSyncProvider } from './providers/bank-sync/mock-provider.js';
import { ContributionService } from './services/contribution.service.js';
import { ExpenseService } from './services/expense.service.js';
import { MemberService } from './services/member.service.js';
import { ReconciliationService } from './services/reconciliation.service.js';
import { GeminiAIProvider } from './providers/ai/gemini-provider.js';
import { MockAIProvider } from './providers/ai/mock-ai-provider.js';

async function bootstrap() {
  const db = getDatabase();

  // Seed canonical roster (40 members) if database is freshly initialized
  const memberService = new MemberService(db);
  const seeded = memberService.seedCanonicalRoster();
  if (seeded > 0) {
    console.log(`[Startup] Seeded ${seeded} canonical class members into database.`);
  }

  const app = buildApp({ db });

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`==================================================`);
    console.log(`REUNION FUND SERVER RUNNING`);
    console.log(`Listening on: http://${config.HOST}:${config.PORT}`);
    console.log(`Environment:  ${config.NODE_ENV}`);
    console.log(`SePay Mode:   ${config.SEPAY_ENVIRONMENT}`);
    console.log(`==================================================`);

    // Setup Reconciliation Services
    const bankSyncProvider =
      config.BANK_SYNC_PROVIDER === 'MOCK' ||
      (config.SEPAY_ENVIRONMENT === 'sandbox' && config.SEPAY_API_TOKEN === 'placeholder_api_token')
        ? new MockBankSyncProvider()
        : new SePayProvider({
            baseUrl: config.SEPAY_BASE_URL,
            apiToken: config.SEPAY_API_TOKEN,
            webhookSecret: config.SEPAY_WEBHOOK_SECRET,
          });

    const aiProvider =
      config.GEMINI_API_KEY === 'placeholder_gemini_key'
        ? new MockAIProvider()
        : new GeminiAIProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL);

    const contributionService = new ContributionService(db);
    const expenseService = new ExpenseService(db, aiProvider);
    const reconciliationService = new ReconciliationService(
      db,
      bankSyncProvider,
      contributionService,
      expenseService
    );

    // Startup Catch-up Reconciliation
    if (config.AUTO_RECONCILE_ON_STARTUP) {
      const lastRow = db
        .prepare("SELECT value FROM system_state WHERE key = 'last_successful_reconciliation'")
        .get() as { value: string } | undefined;

      const isStale =
        !lastRow ||
        Date.now() - new Date(lastRow.value).getTime() > 24 * 60 * 60 * 1000;

      if (isStale) {
        console.log('[Startup] Executing catch-up SePay reconciliation...');
        reconciliationService
          .runReconciliation('STARTUP')
          .then((res) => console.log('[Startup] Reconciliation completed:', res))
          .catch((err) => console.error('[Startup] Reconciliation error:', err));
      }
    }

    // Schedule Daily Reconciliation at 03:30 Asia/Ho_Chi_Minh
    new Cron(
      config.RECONCILIATION_CRON,
      { timezone: 'Asia/Ho_Chi_Minh' },
      async () => {
        console.log('[Cron] Triggering daily 03:30 AM SePay reconciliation...');
        try {
          const result = await reconciliationService.runReconciliation('CRON');
          console.log('[Cron] Daily reconciliation result:', result);
        } catch (err) {
          console.error('[Cron] Daily reconciliation failed:', err);
        }
      }
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();
