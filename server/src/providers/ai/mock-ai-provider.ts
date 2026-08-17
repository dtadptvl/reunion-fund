import { AIProvider, AIClassificationResult } from './types.js';

export class MockAIProvider implements AIProvider {
  async classifyExpense(
    description: string,
    _recipient?: string | null,
    _amount?: number
  ): Promise<AIClassificationResult> {
    const desc = description.toUpperCase();
    if (desc.includes('DAT COC NHA HANG') || desc.includes('NHA HANG')) {
      return { title: 'Đặt cọc nhà hàng', category: 'FOOD', confidence: 0.95 };
    }
    if (desc.includes('HOA') || desc.includes('FLOWERS')) {
      return { title: 'Hoa tươi tặng thầy cô', category: 'FLOWERS', confidence: 0.92 };
    }
    if (desc.includes('PHOTOBOOK') || desc.includes('IN AN')) {
      return { title: 'In photobook kỷ niệm', category: 'PRINTING', confidence: 0.90 };
    }
    if (desc.includes('MOMO') || desc.includes('QUY CHUNG')) {
      return { title: 'Chuyển số dư về quỹ chung của lớp', category: 'FUND_TRANSFER', confidence: 0.98 };
    }

    return { title: null, category: 'UNKNOWN', confidence: 0.1 };
  }
}
