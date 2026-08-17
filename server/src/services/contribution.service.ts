import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  BankTransactionRow,
  ContributionRow,
  PaymentIntentRow,
  MemberRow,
} from '../db/schema.js';
import { parseTransferContent } from './vietqr.service.js';

export interface IngestIncomingResult {
  transactionId: string;
  contributionId: string;
  contributorType: 'MEMBER' | 'EXTERNAL' | 'UNRESOLVED';
  memberId?: string | null;
  amount: number;
  matchMethod: string;
  isAmountMismatch: boolean;
}

export class ContributionService {
  constructor(private db: Database.Database) {}

  /**
   * Process an incoming bank transaction and determine attribution deterministically.
   * AI is NEVER used here.
   */
  processIncomingTransaction(
    bankTx: BankTransactionRow
  ): IngestIncomingResult {
    return this.db.transaction(() => {
      // 1. Check if contribution already exists for this bank transaction
      const existingContribution = this.db
        .prepare('SELECT * FROM contributions WHERE bank_transaction_id = ?')
        .get(bankTx.id) as ContributionRow | undefined;

      if (existingContribution) {
        return {
          transactionId: bankTx.id,
          contributionId: existingContribution.id,
          contributorType: existingContribution.contributor_type,
          memberId: existingContribution.member_id,
          amount: existingContribution.amount,
          matchMethod: existingContribution.match_method,
          isAmountMismatch: Boolean(existingContribution.is_amount_mismatch),
        };
      }

      // 2. Parse transfer content (strictly from NAPAS memo content)
      const { extractedCode, hasDongQuyToken, normalizedContent } = parseTransferContent(
        bankTx.content || ''
      );

      let matchedIntent: PaymentIntentRow | undefined;
      let matchedMember: MemberRow | undefined;
      let matchMethod: ContributionRow['match_method'] = 'UNRESOLVED';
      let contributorType: ContributionRow['contributor_type'] = 'UNRESOLVED';
      let memberId: string | null = null;
      let externalId: string | null = null;
      let isAmountMismatch = false;

      // Strategy A: Match by extracted unique payment code
      if (extractedCode) {
        matchedIntent = this.db
          .prepare('SELECT * FROM payment_intents WHERE payment_code = ?')
          .get(extractedCode) as PaymentIntentRow | undefined;

        if (matchedIntent) {
          matchMethod = 'EXACT_PAYMENT_CODE';
          if (matchedIntent.member_id) {
            contributorType = 'MEMBER';
            memberId = matchedIntent.member_id;
          } else if (matchedIntent.external_contributor_id) {
            contributorType = 'EXTERNAL';
            externalId = matchedIntent.external_contributor_id;
          }
          if (matchedIntent.expected_amount !== bankTx.transfer_amount) {
            isAmountMismatch = true;
          }

          // Mark intent as completed
          this.db
            .prepare("UPDATE payment_intents SET status = 'COMPLETED' WHERE id = ?")
            .run(matchedIntent.id);
        }
      }

      // Strategy B: Conservative deterministic fallback (Exact recognizable name + DONGQUY)
      if (!matchedIntent && hasDongQuyToken) {
        // Query all members to check if exactly one member's normalized name matches
        const allMembers = this.db
          .prepare('SELECT * FROM members')
          .all() as MemberRow[];

        const plausibleMembers: MemberRow[] = [];
        for (const member of allMembers) {
          const normName = member.normalized_name;
          const bankName = member.bank_display_name;
          // Check if normalizedContent contains the full normalized name or bank display name
          if (
            normalizedContent.includes(normName) ||
            (bankName.length >= 5 && normalizedContent.includes(bankName))
          ) {
            plausibleMembers.push(member);
          }
        }

        if (plausibleMembers.length === 1) {
          matchedMember = plausibleMembers[0];
          contributorType = 'MEMBER';
          memberId = matchedMember.id;
          matchMethod = 'DETERMINISTIC_NAME_FALLBACK';
        }
      }

      // Strategy C: Everything useful destroyed -> UNRESOLVED
      const contributionId = crypto.randomUUID();
      this.db
        .prepare(`
          INSERT INTO contributions (
            id, bank_transaction_id, payment_intent_id, contributor_type,
            member_id, external_contributor_id, unresolved_name, amount,
            is_amount_mismatch, match_method, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `)
        .run(
          contributionId,
          bankTx.id,
          matchedIntent ? matchedIntent.id : null,
          contributorType,
          memberId,
          externalId,
          contributorType === 'UNRESOLVED' ? (bankTx.description || bankTx.content) : null,
          bankTx.transfer_amount,
          isAmountMismatch ? 1 : 0,
          matchMethod
        );

      return {
        transactionId: bankTx.id,
        contributionId,
        contributorType,
        memberId,
        amount: bankTx.transfer_amount,
        matchMethod,
        isAmountMismatch,
      };
    })();
  }
}
