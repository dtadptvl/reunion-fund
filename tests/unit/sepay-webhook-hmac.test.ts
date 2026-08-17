import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { SePayProvider } from '../../server/src/providers/bank-sync/sepay-provider.js';

describe('SePay Webhook HMAC-SHA256 Verification & Normalization', () => {
  const webhookSecret = 'test_webhook_secret_key_12345';
  const provider = new SePayProvider({
    baseUrl: 'https://userapi-sandbox.sepay.vn/v2',
    apiToken: 'mock_token',
    webhookSecret,
  });

  it('successfully verifies a valid HMAC-SHA256 signature header', () => {
    const rawPayload = JSON.stringify({
      id: 10001,
      gateway: 'MBBank',
      transferAmount: 500000,
      content: 'VU TRI THANG DONGQUY K8P4X',
    });

    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawPayload)
      .digest('hex');

    const headers = {
      'x-sepay-signature': signature,
    };

    const isValid = provider.verifyWebhook(headers, rawPayload);
    expect(isValid).toBe(true);
  });

  it('rejects an invalid HMAC signature', () => {
    const rawPayload = JSON.stringify({ id: 10001 });
    const headers = {
      'x-sepay-signature': '0000000000000000000000000000000000000000000000000000000000000000',
    };

    const isValid = provider.verifyWebhook(headers, rawPayload);
    expect(isValid).toBe(false);
  });

  it('verifies Apikey authorization header fallback', () => {
    const rawPayload = JSON.stringify({ id: 10001 });
    const headers = {
      authorization: `Apikey ${webhookSecret}`,
    };

    const isValid = provider.verifyWebhook(headers, rawPayload);
    expect(isValid).toBe(true);
  });

  it('normalizes incoming webhook payload correctly', () => {
    const raw = {
      id: 92704,
      gateway: 'Vietcombank',
      transactionDate: '2026-08-17 11:08:33',
      accountNumber: '1017588888',
      subAccount: null,
      code: 'K8P4X',
      content: 'VU TRI THANG DONGQUY K8P4X',
      transferType: 'in',
      description: 'NGUYEN VAN A chuyen tien',
      transferAmount: 500000,
      accumulated: 105000000,
      referenceCode: 'FT24012345678',
    };

    const normalized = provider.normalizeWebhookTransaction(raw);
    expect(normalized.sepayId).toBe(92704);
    expect(normalized.transferType).toBe('in');
    expect(normalized.transferAmount).toBe(500000);
    expect(normalized.content).toBe('VU TRI THANG DONGQUY K8P4X');
  });
});
