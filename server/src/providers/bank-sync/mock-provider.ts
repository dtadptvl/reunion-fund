import { BankSyncProvider, NormalizedBankTransaction } from './types.js';

export class MockBankSyncProvider implements BankSyncProvider {
  public mockTransactions: NormalizedBankTransaction[] = [];
  public shouldVerifyWebhook = true;

  verifyWebhook(_headers: Record<string, string | string[] | undefined>, _rawBody: string): boolean {
    return this.shouldVerifyWebhook;
  }

  normalizeWebhookTransaction(payload: any): NormalizedBankTransaction {
    return {
      sepayId: Number(payload.id || Date.now()),
      gateway: String(payload.gateway || 'Vietcombank'),
      transactionDate: String(payload.transactionDate || new Date().toISOString()),
      accountNumber: String(payload.accountNumber || '1017588888'),
      subAccount: payload.subAccount ? String(payload.subAccount) : null,
      transferType: String(payload.transferType).toLowerCase() === 'out' ? 'out' : 'in',
      transferAmount: Number(payload.transferAmount || 0),
      accumulated: payload.accumulated ? Number(payload.accumulated) : null,
      code: payload.code ? String(payload.code) : null,
      content: String(payload.content || ''),
      description: payload.description ? String(payload.description) : null,
      referenceCode: payload.referenceCode ? String(payload.referenceCode) : null,
      rawPayload: payload,
    };
  }

  async listTransactions(params: {
    sinceId?: number;
    transactionDateMin?: string;
    transactionDateMax?: string;
    page?: number;
    perPage?: number;
  }): Promise<{
    transactions: NormalizedBankTransaction[];
    hasMore: boolean;
    total?: number;
  }> {
    let list = [...this.mockTransactions];
    if (params.sinceId) {
      list = list.filter((t) => t.sepayId >= params.sinceId!);
    }
    const page = params.page || 1;
    const perPage = params.perPage || 50;
    const start = (page - 1) * perPage;
    const paged = list.slice(start, start + perPage);

    return {
      transactions: paged,
      hasMore: start + perPage < list.length,
      total: list.length,
    };
  }
}
