import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { SePayProvider } from '../../server/src/providers/bank-sync/sepay-provider.js';

describe('SePay Webhook HMAC-SHA256 Verification & Normalization Suite', () => {
  const webhookSecret = 'test_webhook_secret_key_12345';
  const provider = new SePayProvider({
    baseUrl: 'https://userapi-sandbox.sepay.vn/v2',
    apiToken: 'mock_token',
    webhookSecret,
  });

  const createValidSignature = (timestamp: string | number, body: string) => {
    const message = `${String(timestamp).trim()}.${body}`;
    return crypto.createHmac('sha256', webhookSecret).update(message, 'utf8').digest('hex');
  };

  it('accepts a valid HMAC-SHA256 signature with sha256= prefix and fresh timestamp', () => {
    const rawPayload = JSON.stringify({
      id: 10001,
      gateway: 'MBBank',
      transferAmount: 500000,
      content: 'VU TRI THANG DONGQUY K8P4X',
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createValidSignature(timestamp, rawPayload);

    const headers = {
      'x-sepay-timestamp': timestamp,
      'x-sepay-signature': `sha256=${signature}`,
    };

    expect(provider.verifyWebhook(headers, rawPayload)).toBe(true);
  });

  it('accepts a valid HMAC-SHA256 signature without sha256= prefix', () => {
    const rawPayload = JSON.stringify({ id: 10002, amount: 200000 });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createValidSignature(timestamp, rawPayload);

    const headers = {
      'x-sepay-timestamp': timestamp,
      'x-sepay-signature': signature,
    };

    expect(provider.verifyWebhook(headers, rawPayload)).toBe(true);
  });

  it('rejects request when X-SePay-Timestamp is missing', () => {
    const rawPayload = JSON.stringify({ id: 10003 });
    const signature = createValidSignature(Math.floor(Date.now() / 1000), rawPayload);

    const headers = {
      'x-sepay-signature': signature,
    };

    expect(provider.verifyWebhook(headers, rawPayload)).toBe(false);
  });

  it('rejects expired timestamp outside the 5-minute replay window', () => {
    const rawPayload = JSON.stringify({ id: 10004 });
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - 301).toString(); // 5 min 1 sec ago
    const signature = createValidSignature(expiredTimestamp, rawPayload);

    const headers = {
      'x-sepay-timestamp': expiredTimestamp,
      'x-sepay-signature': signature,
    };

    expect(provider.verifyWebhook(headers, rawPayload)).toBe(false);
  });

  it('rejects future timestamp outside the 5-minute window', () => {
    const rawPayload = JSON.stringify({ id: 10005 });
    const futureTimestamp = (Math.floor(Date.now() / 1000) + 305).toString();
    const signature = createValidSignature(futureTimestamp, rawPayload);

    const headers = {
      'x-sepay-timestamp': futureTimestamp,
      'x-sepay-signature': signature,
    };

    expect(provider.verifyWebhook(headers, rawPayload)).toBe(false);
  });

  it('rejects tampered / modified body', () => {
    const originalBody = JSON.stringify({ id: 10006, amount: 500000 });
    const tamperedBody = JSON.stringify({ id: 10006, amount: 5000000 });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createValidSignature(timestamp, originalBody);

    const headers = {
      'x-sepay-timestamp': timestamp,
      'x-sepay-signature': signature,
    };

    expect(provider.verifyWebhook(headers, tamperedBody)).toBe(false);
  });

  it('rejects modified timestamp even if body matches', () => {
    const rawPayload = JSON.stringify({ id: 10007 });
    const originalTimestamp = Math.floor(Date.now() / 1000).toString();
    const modifiedTimestamp = (Math.floor(Date.now() / 1000) - 10).toString();
    const signature = createValidSignature(originalTimestamp, rawPayload);

    const headers = {
      'x-sepay-timestamp': modifiedTimestamp,
      'x-sepay-signature': signature,
    };

    expect(provider.verifyWebhook(headers, rawPayload)).toBe(false);
  });

  it('rejects malformed signature (non-hex or wrong length)', () => {
    const rawPayload = JSON.stringify({ id: 10008 });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const headers = {
      'x-sepay-timestamp': timestamp,
      'x-sepay-signature': 'not_a_valid_hex_signature',
    };

    expect(provider.verifyWebhook(headers, rawPayload)).toBe(false);
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
