export interface NormalizedBankTransaction {
  sepayId: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount?: string | null;
  transferType: 'in' | 'out';
  transferAmount: number;
  accumulated?: number | null;
  code?: string | null;
  content: string;
  description?: string | null;
  referenceCode?: string | null;
  rawPayload: Record<string, unknown>;
}

export interface BankSyncProvider {
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean;
  normalizeWebhookTransaction(payload: unknown): NormalizedBankTransaction;
  listTransactions(params: {
    sinceId?: number;
    transactionDateMin?: string;
    transactionDateMax?: string;
    page?: number;
    perPage?: number;
  }): Promise<{
    transactions: NormalizedBankTransaction[];
    hasMore: boolean;
    total?: number;
  }>;
}
