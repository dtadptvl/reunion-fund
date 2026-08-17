export function formatVND(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(amount);
}

export function formatDateVN(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return dateStr;
  }
}

export function getCategoryLabelVN(category: string): string {
  const map: Record<string, string> = {
    FOOD: 'Ăn uống / Nhà hàng',
    GIFT_TEACHER: 'Quà tặng thầy cô',
    FLOWERS: 'Hoa tươi',
    PHOTO_VIDEO: 'Quay phim / Chụp ảnh',
    PRINTING: 'In ấn / Backdrop / Kỷ yếu',
    TRANSPORT: 'Xe cộ / Đi lại',
    REFUND: 'Hoàn tiền',
    FUND_TRANSFER: 'Chuyển về quỹ chung',
    OTHER: 'Chi phí khác',
    UNKNOWN: 'Chưa xác định',
  };
  return map[category] || category;
}
