import crypto from 'crypto';
import { BankSyncProvider, NormalizedBankTransaction } from './types.js';

export interface SePayProviderOptions {
  baseUrl: string;
  apiToken: string;
  webhookSecret: string;
}

export class SePayProvider implements BankSyncProvider {
  private baseUrl: string;
  private apiToken: string;
  private webhookSecret: string;

  constructor(options: SePayProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiToken = options.apiToken;
    this.webhookSecret = options.webhookSecret;
  }

  /**
   * Verifies incoming webhook request using HMAC-SHA256 signature or API Key header.
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean {
    // 1. Check HMAC Signature header
    const signatureHeader =
      headers['x-sepay-signature'] ||
      headers['x-signature'] ||
      headers['X-SePay-Signature'];

    if (signatureHeader && typeof signatureHeader === 'string') {
      const computedHash = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(rawBody)
        .digest('hex');

      const expectedBuffer = Buffer.from(computedHash, 'hex');
      const signatureBuffer = Buffer.from(signatureHeader.replace(/^sha256=/i, ''), 'hex');

      if (expectedBuffer.length === signatureBuffer.length) {
        return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
      }
    }

    // 2. Check Authorization / Apikey header fallback
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const match = authHeader.match(/^Apikey\s+(.+)$/i);
      if (match && match[1]) {
        const apiKey = match[1].trim();
        const expectedBuffer = Buffer.from(this.webhookSecret);
        const receivedBuffer = Buffer.from(apiKey);
        if (expectedBuffer.length === receivedBuffer.length) {
          return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
        }
      }
    }

    return false;
  }

  normalizeWebhookTransaction(payload: any): NormalizedBankTransaction {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid SePay webhook payload');
    }

    return {
      sepayId: Number(payload.id),
      gateway: String(payload.gateway || 'Unknown'),
      transactionDate: String(payload.transactionDate || new Date().toISOString()),
      accountNumber: String(payload.accountNumber || ''),
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
    const page = params.page || 1;
    const perPage = params.perPage || 50;

    const url = new URL(`${this.baseUrl}/transactions`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    if (params.transactionDateMin) url.searchParams.set('transaction_date_min', params.transactionDateMin);
    if (params.transactionDateMax) url.searchParams.set('transaction_date_max', params.transactionDateMax);
    if (params.sinceId) url.searchParams.set('since_id', String(params.sinceId));

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const statusText = response.statusText;
      const body = await response.text().catch(() => '');
      throw new Error(`SePay API error HTTP ${response.status} (${statusText}): ${body}`);
    }

    const data: any = await response.json();
    const rawList: any[] = Array.isArray(data.transactions) ? data.transactions : Array.isArray(data.data) ? data.data : [];

    const transactions = rawList.map((item) => this.normalizeWebhookTransaction(item));
    const hasMore = data.meta?.pagination?.has_more ?? (transactions.length === perPage);

    return {
      transactions,
      hasMore,
      total: data.meta?.pagination?.total,
    };
  }
}
