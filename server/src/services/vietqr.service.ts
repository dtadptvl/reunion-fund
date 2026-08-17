import crypto from 'crypto';

// Characters chosen for readability (avoiding 0, O, 1, I)
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const VIETQR_MAX_LENGTH = 25;

/**
 * Remove Vietnamese accents/diacritics and normalize whitespace/casing.
 */
export function removeVietnameseDiacritics(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Generate a concise recognizable bank display name from a full Vietnamese name.
 * e.g., "NGUYỄN THỊ MINH PHƯƠNG" -> "MINH PHUONG"
 *       "VŨ TRÍ THẮNG" -> "TRI THANG"
 *       "NGUYỄN VĂN AN" -> "VAN AN" or "AN"
 */
export function generateBankDisplayName(fullName: string): string {
  const normalized = removeVietnameseDiacritics(fullName);
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }
  // For names with 3+ words, take last 2 words (e.g. "MINH PHUONG")
  return parts.slice(-2).join(' ');
}

/**
 * Generate a random non-sequential 5-character payment code.
 */
export function generatePaymentCode(length = 5): string {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  return code;
}

/**
 * Formats VietQR transfer content adhering strictly to the 25-character NAPAS limit.
 * Priority:
 * 1. Unique code (e.g. "K8P4X" - 5 chars)
 * 2. "DONGQUY" (7 chars)
 * 3. Short recognizable name
 *
 * Example: "MINH PHUONG DONGQUY K8P4X" (25 chars)
 */
export function formatTransferContent(bankDisplayName: string, paymentCode: string): string {
  const normalizedName = removeVietnameseDiacritics(bankDisplayName);
  const code = paymentCode.toUpperCase().trim();
  const token = 'DONGQUY';

  // Base required suffix: " DONGQUY <CODE>"
  const suffix = ` ${token} ${code}`;
  const maxNameLength = VIETQR_MAX_LENGTH - suffix.length;

  let namePart = normalizedName;
  if (namePart.length > maxNameLength) {
    // If too long, try single last name word or truncate
    const words = namePart.split(' ');
    const lastWord = words[words.length - 1];
    if (lastWord && lastWord.length <= maxNameLength) {
      namePart = lastWord;
    } else {
      namePart = namePart.substring(0, maxNameLength).trim();
    }
  }

  const result = `${namePart}${suffix}`.trim();
  if (result.length > VIETQR_MAX_LENGTH) {
    // Ultimate fallback guarantee within 25 chars
    return `${token} ${code}`.substring(0, VIETQR_MAX_LENGTH);
  }
  return result;
}

/**
 * Parses bank transaction content to extract payment code or identify fallback patterns.
 */
export function parseTransferContent(rawContent: string): {
  extractedCode: string | null;
  hasDongQuyToken: boolean;
  normalizedContent: string;
} {
  const normalized = removeVietnameseDiacritics(rawContent);
  const hasDongQuyToken = /DONG\s*QUY/i.test(normalized);

  let extractedCode: string | null = null;

  // 1. First check if a code directly follows DONGQUY (e.g. "DONGQUY K8P4X" or "DONG QUY K8P4X")
  const dongQuyMatch = normalized.match(/DONG\s*QUY\s+([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5})\b/i);
  if (dongQuyMatch && dongQuyMatch[1]) {
    extractedCode = dongQuyMatch[1].toUpperCase();
  } else {
    // 2. Otherwise scan words of length 5, prioritizing tokens that contain at least one digit
    const words = normalized.split(/[^A-Z0-9]/).filter((w) => w.length === 5);
    // Find first 5-char word with digits
    const codeWithDigits = words.find(
      (w) => /\d/.test(w) && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(w)
    );
    if (codeWithDigits) {
      extractedCode = codeWithDigits;
    } else {
      // Fallback: reverse scan (codes are typically near the end)
      const validCode = words.reverse().find(
        (w) => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(w)
      );
      if (validCode) {
        extractedCode = validCode;
      }
    }
  }

  return {
    extractedCode,
    hasDongQuyToken,
    normalizedContent: normalized,
  };
}
