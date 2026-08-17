import Database from 'better-sqlite3';
import crypto from 'crypto';
import { BankSyncProvider } from '../providers/bank-sync/types.js';
import { BankTransactionRow } from '../db/schema.js';
import { ContributionService } from './contribution.service.js';
import { ExpenseService } from './expense.service.js';

export interface ReconciliationSummary {
  runId: string;
  totalChecked: number;
  alreadyPresent: number;
  newlyImported: number;
  errorCount: number;
  status: 'SUCCESS' | 'FAILED';
}

export class ReconciliationService {
  private isRunning = false;

  constructor(
    private db: Database.Database,
    private bankSyncProvider: BankSyncProvider,
    private contributionService: ContributionService,
    private expenseService: ExpenseService
  ) {}

  async runReconciliation(
    triggeredBy: 'CRON' | 'STARTUP' | 'MANUAL'
  ): Promise<ReconciliationSummary> {
    if (this.isRunning) {
      throw new Error('Reconciliation job is already in progress');
    }

    this.isRunning = true;
    const runId = crypto.randomUUID();
    const startTime = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO reconciliation_runs (
          id, started_at, status, total_checked, already_present,
          newly_imported, error_count, triggered_by
        ) VALUES (?, ?, 'RUNNING', 0, 0, 0, 0, ?)
      `)
      .run(runId, startTime, triggeredBy);

    let totalChecked = 0;
    let alreadyPresent = 0;
    let newlyImported = 0;
    let errorCount = 0;

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await this.bankSyncProvider.listTransactions({
          page,
          perPage: 50,
        });

        for (const tx of result.transactions) {
          totalChecked++;

          // Check if already in bank_transactions (by sepay_id, reference_code, or unique transaction tuple)
          const existing = this.db
            .prepare(`
              SELECT id FROM bank_transactions
              WHERE (sepay_id = ? AND sepay_id != 0)
                 OR (reference_code IS NOT NULL AND reference_code = ?)
                 OR (content = ? AND transaction_date = ? AND transfer_amount = ?)
            `)
            .get(
              tx.sepayId,
              tx.referenceCode,
              tx.content,
              tx.transactionDate,
              tx.transferAmount
            ) as { id: string } | undefined;

          if (existing) {
            alreadyPresent++;
          } else {
            const txId = crypto.randomUUID();
            const bankTxRow: BankTransactionRow = {
              id: txId,
              sepay_id: tx.sepayId,
              gateway: tx.gateway,
              transaction_date: tx.transactionDate,
              account_number: tx.accountNumber,
              sub_account: tx.subAccount || null,
              transfer_type: tx.transferType,
              transfer_amount: tx.transferAmount,
              accumulated: tx.accumulated || null,
              code: tx.code || null,
              content: tx.content,
              description: tx.description || null,
              reference_code: tx.referenceCode || null,
              raw_payload: JSON.stringify(tx.rawPayload),
              ingestion_source: 'RECONCILIATION',
              is_excluded: 0,
              created_at: new Date().toISOString(),
            };

            this.db.transaction(() => {
              this.db
                .prepare(`
                  INSERT INTO bank_transactions (
                    id, sepay_id, gateway, transaction_date, account_number,
                    sub_account, transfer_type, transfer_amount, accumulated,
                    code, content, description, reference_code, raw_payload,
                    ingestion_source, is_excluded, created_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                `)
                .run(
                  bankTxRow.id,
                  bankTxRow.sepay_id,
                  bankTxRow.gateway,
                  bankTxRow.transaction_date,
                  bankTxRow.account_number,
                  bankTxRow.sub_account,
                  bankTxRow.transfer_type,
                  bankTxRow.transfer_amount,
                  bankTxRow.accumulated,
                  bankTxRow.code,
                  bankTxRow.content,
                  bankTxRow.description,
                  bankTxRow.reference_code,
                  bankTxRow.raw_payload,
                  bankTxRow.ingestion_source,
                  bankTxRow.is_excluded
                );

              if (bankTxRow.transfer_type === 'in') {
                this.contributionService.processIncomingTransaction(bankTxRow);
              }
            })();

            if (bankTxRow.transfer_type === 'out') {
              await this.expenseService.processOutgoingTransaction(bankTxRow);
            }

            newlyImported++;
          }
        }

        hasMore = result.hasMore && result.transactions.length > 0;
        page++;
      }

      // Record successful reconciliation
      this.db
        .prepare(`
          UPDATE reconciliation_runs SET
            completed_at = CURRENT_TIMESTAMP,
            status = 'SUCCESS',
            total_checked = ?,
            already_present = ?,
            newly_imported = ?,
            error_count = ?,
            log_summary = ?
          WHERE id = ?
        `)
        .run(
          totalChecked,
          alreadyPresent,
          newlyImported,
          errorCount,
          `Đối soát hoàn tất. Đã kiểm tra: ${totalChecked}, Đã có: ${alreadyPresent}, Bổ sung: ${newlyImported}, Lỗi: ${errorCount}`,
          runId
        );

      this.db
        .prepare(`
          INSERT INTO system_state (key, value, updated_at)
          VALUES ('last_successful_reconciliation', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        `)
        .run();

      return {
        runId,
        totalChecked,
        alreadyPresent,
        newlyImported,
        errorCount,
        status: 'SUCCESS',
      };
    } catch (err: any) {
      errorCount++;
      this.db
        .prepare(`
          UPDATE reconciliation_runs SET
            completed_at = CURRENT_TIMESTAMP,
            status = 'FAILED',
            total_checked = ?,
            already_present = ?,
            newly_imported = ?,
            error_count = ?,
            log_summary = ?
          WHERE id = ?
        `)
        .run(totalChecked, alreadyPresent, newlyImported, errorCount, String(err?.message || err), runId);

      return {
        runId,
        totalChecked,
        alreadyPresent,
        newlyImported,
        errorCount,
        status: 'FAILED',
      };
    } finally {
      this.isRunning = false;
    }
  }
}
