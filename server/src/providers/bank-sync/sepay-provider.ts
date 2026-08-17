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
   * Verifies incoming webhook request against the official SePay HMAC-SHA256 specification.
   *
   * Algorithm:
   * message = `${X-SePay-Timestamp}.${raw_request_body}`
   * expected signature: sha256=<HMAC-SHA256 hex digest using SEPAY_WEBHOOK_SECRET>
   *
   * Enforces:
   * - Required X-SePay-Timestamp header
   * - Strict replay window (±300 seconds / 5 minutes)
   * - Valid 64-character hex signature format (optional 'sha256=' prefix)
   * - Constant-time signature comparison (crypto.timingSafeEqual)
   * - Rejection of missing/invalid timestamp, expired requests, malformed signatures, or modified payloads
   */
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean {
    if (!this.webhookSecret || !rawBody) {
      return false;
    }

    // 1. Extract and validate timestamp header
    const rawTimestamp =
      headers['x-sepay-timestamp'] ||
      headers['X-SePay-Timestamp'] ||
      headers['x-timestamp'] ||
      headers['X-Timestamp'];

    if (!rawTimestamp || typeof rawTimestamp !== 'string') {
      return false;
    }

    const timestampNum = Number(rawTimestamp.trim());
    if (isNaN(timestampNum) || !isFinite(timestampNum) || timestampNum <= 0) {
      return false;
    }

    // Determine timestamp in seconds (handles either Unix seconds or milliseconds)
    const timestampSec = timestampNum > 1e11 ? Math.floor(timestampNum / 1000) : Math.floor(timestampNum);
    const nowSec = Math.floor(Date.now() / 1000);
    const REPLAY_WINDOW_SECONDS = 300; // ±5 minutes

    if (Math.abs(nowSec - timestampSec) > REPLAY_WINDOW_SECONDS) {
      return false;
    }

    // 2. Extract and validate signature header
    const rawSignature =
      headers['x-sepay-signature'] ||
      headers['X-SePay-Signature'] ||
      headers['x-signature'] ||
      headers['X-Signature'];

    if (!rawSignature || typeof rawSignature !== 'string') {
      return false;
    }

    // Signature format may be "sha256=<hex>" or "<hex>"
    const hexSignature = rawSignature.replace(/^sha256=/i, '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hexSignature)) {
      return false;
    }

    // 3. Construct signature payload: `${X-SePay-Timestamp}.${raw_request_body}`
    const message = `${rawTimestamp.trim()}.${rawBody}`;

    const computedHash = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(message, 'utf8')
      .digest('hex');

    const expectedBuffer = Buffer.from(computedHash, 'hex');
    const receivedBuffer = Buffer.from(hexSignature, 'hex');

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
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
