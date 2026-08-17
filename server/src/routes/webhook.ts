import { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { BankSyncProvider } from '../providers/bank-sync/types.js';
import { ContributionService } from '../services/contribution.service.js';
import { ExpenseService } from '../services/expense.service.js';
import { BankTransactionRow } from '../db/schema.js';

export async function webhookRoutes(
  app: FastifyInstance,
  options: {
    db: Database.Database;
    bankSyncProvider: BankSyncProvider;
    contributionService: ContributionService;
    expenseService: ExpenseService;
  }
) {
  // SePay Webhook Endpoint
  app.post(
    '/api/v1/webhook/sepay',
    async (request, reply) => {
      const rawBody = JSON.stringify(request.body || {});
      const headers = request.headers;

      // 1. Verify Webhook Signature (HMAC / Apikey)
      const isValid = options.bankSyncProvider.verifyWebhook(headers, rawBody);
      if (!isValid && process.env.NODE_ENV === 'production') {
        request.log.warn({ headers }, 'Unauthorized webhook attempt');
        return reply.status(401).send({ success: false, error: 'Unauthorized webhook signature' });
      }

      // 2. Normalize transaction payload
      let normalized;
      try {
        normalized = options.bankSyncProvider.normalizeWebhookTransaction(request.body);
      } catch (err: any) {
        request.log.error({ err }, 'Invalid webhook transaction structure');
        return reply.status(400).send({ success: false, error: 'Malformed transaction payload' });
      }

      // 3. Race-safe Idempotent Ingestion
      const db = options.db;
      let bankTxRow: BankTransactionRow | undefined;

      try {
        const txId = crypto.randomUUID();
        const insertStmt = db.prepare(`
          INSERT INTO bank_transactions (
            id, sepay_id, gateway, transaction_date, account_number,
            sub_account, transfer_type, transfer_amount, accumulated,
            code, content, description, reference_code, raw_payload,
            ingestion_source, is_excluded, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WEBHOOK', 0, CURRENT_TIMESTAMP)
        `);

        insertStmt.run(
          txId,
          normalized.sepayId,
          normalized.gateway,
          normalized.transactionDate,
          normalized.accountNumber,
          normalized.subAccount || null,
          normalized.transferType,
          normalized.transferAmount,
          normalized.accumulated || null,
          normalized.code || null,
          normalized.content,
          normalized.description || null,
          normalized.referenceCode || null,
          JSON.stringify(normalized.rawPayload)
        );

        bankTxRow = db
          .prepare('SELECT * FROM bank_transactions WHERE id = ?')
          .get(txId) as BankTransactionRow;
      } catch (err: any) {
        // Unique constraint violation on sepay_id -> transaction already processed!
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          request.log.info({ sepayId: normalized.sepayId }, 'Duplicate webhook delivery acknowledged idempotently');
          return reply.status(200).send({ success: true, message: 'Duplicate transaction ignored idempotently' });
        }
        throw err;
      }

      // 4. Process Incoming / Outgoing
      if (bankTxRow) {
        if (bankTxRow.transfer_type === 'in') {
          options.contributionService.processIncomingTransaction(bankTxRow);
        } else {
          await options.expenseService.processOutgoingTransaction(bankTxRow);
        }
      }

      // Respond immediately with required SePay contract
      return reply.status(200).send({ success: true });
    }
  );
}
