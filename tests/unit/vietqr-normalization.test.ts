import { describe, it, expect } from 'vitest';
import {
  removeVietnameseDiacritics,
  generateBankDisplayName,
  formatTransferContent,
  parseTransferContent,
  generatePaymentCode,
} from '../../server/src/services/vietqr.service.js';

describe('VietQR Normalization & 25-Character Constraint', () => {
  it('removes Vietnamese accents and converts to uppercase alphanumeric', () => {
    const input = 'Nguyễn Thị Minh Phương';
    const normalized = removeVietnameseDiacritics(input);
    expect(normalized).toBe('NGUYEN THI MINH PHUONG');
  });

  it('generates concise bank display name for long names', () => {
    expect(generateBankDisplayName('Nguyễn Thị Minh Phương')).toBe('MINH PHUONG');
    expect(generateBankDisplayName('Vũ Trí Thắng')).toBe('TRI THANG');
    expect(generateBankDisplayName('Nguyễn Văn An')).toBe('VAN AN');
    expect(generateBankDisplayName('Lê An')).toBe('LE AN');
  });

  it('strictly enforces the 25-character VietQR NAPAS limit', () => {
    const paymentCode = 'K8P4X';
    const bankDisplayName = 'MINH PHUONG';
    const content = formatTransferContent(bankDisplayName, paymentCode);

    expect(content.length).toBeLessThanOrEqual(25);
    expect(content).toBe('MINH PHUONG DONGQUY K8P4X');
  });

  it('preserves payment code and DONGQUY when name is extremely long', () => {
    const paymentCode = 'K7F3P';
    const longName = 'HOANG NGUYEN PHUONG THAO LINH';
    const content = formatTransferContent(longName, paymentCode);

    expect(content.length).toBeLessThanOrEqual(25);
    expect(content).toContain('DONGQUY');
    expect(content).toContain(paymentCode);
  });

  it('generates 5-character payment code with safe alphabet', () => {
    const code = generatePaymentCode(5);
    expect(code.length).toBe(5);
    expect(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(code)).toBe(true);
  });

  it('extracts payment code and recognizes DONGQUY token in transfer content', () => {
    const parsed1 = parseTransferContent('VU TRI THANG DONGQUY K8P4X');
    expect(parsed1.extractedCode).toBe('K8P4X');
    expect(parsed1.hasDongQuyToken).toBe(true);

    const parsed2 = parseTransferContent('ABC K8P4X XYZ');
    expect(parsed2.extractedCode).toBe('K8P4X');

    const parsed3 = parseTransferContent('TIEN HOP LOP 10 NAM');
    expect(parsed3.extractedCode).toBeNull();
    expect(parsed3.hasDongQuyToken).toBe(false);
  });
});
