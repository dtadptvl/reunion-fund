import { AIProvider, AIClassificationResult } from './types.js';
import { ClassificationSource } from '../../db/schema.js';
import { removeVietnameseDiacritics } from '../../services/vietqr.service.js';

export class MockAIProvider implements AIProvider {
  readonly source: ClassificationSource = 'MOCK_AI';

  async classifyExpense(
    description: string,
    _recipient?: string | null,
    _amount?: number
  ): Promise<AIClassificationResult> {
    const desc = removeVietnameseDiacritics(description).toUpperCase();
    if (desc.includes('DAT COC') || desc.includes('NHA HANG') || desc.includes('BUFFET') || desc.includes('TIEC')) {
      return { title: 'Đặt cọc nhà hàng', category: 'FOOD', confidence: 0.95 };
    }
    if (desc.includes('HOA TUOI') || desc.includes('HOA TANG') || desc.includes('FLOWERS')) {
      return { title: 'Hoa tươi tặng thầy cô', category: 'FLOWERS', confidence: 0.92 };
    }
    if (desc.includes('PHOTOBOOK') || desc.includes('IN AN') || desc.includes('BANNER') || desc.includes('BANG RON') || desc.includes('AO LOP')) {
      return { title: 'In photobook và băng rôn kỷ niệm', category: 'PRINTING', confidence: 0.90 };
    }
    if (desc.includes('CHUP ANH') || desc.includes('QUAY PHIM')) {
      return { title: 'Quay phim chụp ảnh kỷ niệm', category: 'PHOTO_VIDEO', confidence: 0.92 };
    }
    if (desc.includes('QUA TANG THAY CO') || desc.includes('TRI AN')) {
      return { title: 'Quà tặng tri ân thầy cô', category: 'GIFT_TEACHER', confidence: 0.95 };
    }
    if (desc.includes('THUE XE') || desc.includes('XE DI LAI')) {
      return { title: 'Chi phí xe cộ đi lại', category: 'TRANSPORT', confidence: 0.90 };
    }
    if (desc.includes('HOAN TIEN')) {
      return { title: 'Hoàn tiền thành viên', category: 'REFUND', confidence: 0.95 };
    }
    if (desc.includes('MOMO') || desc.includes('QUY CHUNG')) {
      return { title: 'Chuyển số dư về quỹ chung của lớp', category: 'FUND_TRANSFER', confidence: 0.98 };
    }

    // Default for ambiguous / insufficient evidence transactions (e.g. "QR839281923", "NGUYEN VAN HUNG")
    return { title: null, category: 'UNKNOWN', confidence: 0.0 };
  }
}
