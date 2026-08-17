import { describe, it, expect } from 'vitest';
import { formatVND, formatDateVN, getCategoryLabelVN } from '../../client/src/utils/format.js';

describe('Vietnamese Language Policy & Formatting Verification', () => {
  it('formats currency strictly as VND (₫)', () => {
    const formatted = formatVND(500000);
    expect(formatted).toContain('500.000');
    expect(formatted).toMatch(/(₫|VND)/i);
  });

  it('formats dates in Vietnamese format (dd/mm/yyyy)', () => {
    const date = '2026-08-17T10:30:00.000Z';
    const formatted = formatDateVN(date);
    expect(formatted).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('translates all internal expense categories into Vietnamese labels', () => {
    expect(getCategoryLabelVN('FOOD')).toBe('Ăn uống / Nhà hàng');
    expect(getCategoryLabelVN('GIFT_TEACHER')).toBe('Quà tặng thầy cô');
    expect(getCategoryLabelVN('FLOWERS')).toBe('Hoa tươi');
    expect(getCategoryLabelVN('PHOTO_VIDEO')).toBe('Quay phim / Chụp ảnh');
    expect(getCategoryLabelVN('PRINTING')).toBe('In ấn / Backdrop / Kỷ yếu');
    expect(getCategoryLabelVN('TRANSPORT')).toBe('Xe cộ / Đi lại');
    expect(getCategoryLabelVN('REFUND')).toBe('Hoàn tiền');
    expect(getCategoryLabelVN('FUND_TRANSFER')).toBe('Chuyển về quỹ chung');
    expect(getCategoryLabelVN('OTHER')).toBe('Chi phí khác');
    expect(getCategoryLabelVN('UNKNOWN')).toBe('Chưa xác định');
  });
});
