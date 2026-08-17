import { GoogleGenAI } from '@google/genai';
import { AIProvider, AIClassificationResult } from './types.js';
import { ExpenseCategory, ClassificationSource } from '../../db/schema.js';

export class GeminiAIProvider implements AIProvider {
  readonly source: ClassificationSource = 'GEMINI_AI';
  private ai: GoogleGenAI | null = null;
  private modelName: string;

  constructor(apiKey: string, modelName = 'gemini-2.5-flash') {
    this.modelName = modelName;
    if (apiKey && apiKey !== 'placeholder_gemini_key') {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  async classifyExpense(
    description: string,
    recipient?: string | null,
    amount?: number
  ): Promise<AIClassificationResult> {
    if (!this.ai) {
      return { title: null, category: 'UNKNOWN', confidence: 0 };
    }

    try {
      const prompt = `
Bạn là trợ lý tài chính lớp kỷ niệm 10 năm ra trường. Nhiệm vụ của bạn là chuẩn hóa nội dung chuyển khoản chi tiêu thành tiêu đề tiếng Việt tự nhiên và phân loại chi tiêu.

Dữ liệu giao dịch chuyển tiền đi (chi tiêu):
- Nội dung gốc từ ngân hàng: "${description}"
- Người nhận: "${recipient || 'Không có'}"
- Số tiền: ${amount ? amount.toLocaleString('vi-VN') + ' đ' : 'Không rõ'}

Danh mục hợp lệ (chỉ chọn 1):
- FOOD (Ăn uống / Nhà hàng / Tiệc)
- GIFT_TEACHER (Quà tặng thầy cô)
- FLOWERS (Hoa tươi)
- PHOTO_VIDEO (Quay phim / Chụp ảnh)
- PRINTING (In ấn / Backdrop / Photobook / Áo lớp)
- TRANSPORT (Xe cộ / Đi lại)
- REFUND (Hoàn tiền)
- FUND_TRANSFER (Chuyển số dư về quỹ chung của lớp)
- OTHER (Chi phí khác)
- UNKNOWN (Chưa xác định)

Quy tắc quan trọng:
1. Tiêu đề tiếng Việt phải tự nhiên, chuẩn chính tả (ví dụ: "Đặt cọc nhà hàng", "Hoa tặng cô giáo", "In photobook").
2. Nếu nội dung vô nghĩa, mã QR merchant (ví dụ "QR839281923", "chuyen tien"), hoặc không đủ căn cứ, BẮT BUỘC trả về category: "UNKNOWN", title: null, confidence thấp.
3. TUYỆT ĐỐI KHÔNG tự bịa đặt mục đích khi không có dữ liệu chứng minh.

Hãy trả về định dạng JSON thuần túy theo schema sau:
{
  "title": string | null,
  "category": "FOOD" | "GIFT_TEACHER" | "FLOWERS" | "PHOTO_VIDEO" | "PRINTING" | "TRANSPORT" | "REFUND" | "FUND_TRANSFER" | "OTHER" | "UNKNOWN",
  "confidence": number (từ 0.0 đến 1.0)
}
`;

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const text = response.text?.trim();
      if (!text) {
        return { title: null, category: 'UNKNOWN', confidence: 0 };
      }

      const parsed = JSON.parse(text);
      const validCategories: ExpenseCategory[] = [
        'FOOD',
        'GIFT_TEACHER',
        'FLOWERS',
        'PHOTO_VIDEO',
        'PRINTING',
        'TRANSPORT',
        'REFUND',
        'FUND_TRANSFER',
        'OTHER',
        'UNKNOWN',
      ];

      const category = validCategories.includes(parsed.category) ? parsed.category : 'UNKNOWN';

      return {
        title: parsed.title || null,
        category,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      };
    } catch (error) {
      console.warn('Gemini classification fallback to UNKNOWN:', error);
      return { title: null, category: 'UNKNOWN', confidence: 0 };
    }
  }
}
