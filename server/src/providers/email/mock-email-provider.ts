import { EmailProvider, SendEmailOptions, VerificationEmailPayload } from './types.js';

export interface SentEmailRecord {
  to: string;
  subject: string;
  html: string;
  text?: string;
  token?: string;
  code?: string;
  timestamp: string;
}

export class MockEmailProvider implements EmailProvider {
  public sentEmails: SentEmailRecord[] = [];

  async sendEmail(options: SendEmailOptions): Promise<boolean> {
    this.sentEmails.push({
      ...options,
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  async sendVerificationEmail(payload: VerificationEmailPayload): Promise<boolean> {
    const subject = 'Xác thực tài khoản — Quỹ Họp Lớp A1 Khóa 48';
    const text = `Xin chào ${payload.fullName},\n\nMã xác thực tài khoản của bạn là: ${payload.code}\nHoặc truy cập liên kết sau để kích hoạt tài khoản: ${payload.verifyUrl}\n\nTrân trọng,\nBan Quản trị Lớp A1 (Khóa 48)`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1e3a8a; margin-top: 0;">KỶ NIỆM 10 NĂM RA TRƯỜNG</h2>
        <div style="font-size: 14px; color: #64748b; margin-bottom: 20px;">Lớp A1 — Khóa 48 (Niên khóa 2013–2016) — Trường THPT Văn Lâm</div>
        <p>Xin chào <strong>${payload.fullName}</strong>,</p>
        <p>Cảm ơn bạn đã đăng ký tài khoản thành viên lớp trên hệ thống Quỹ Họp Lớp. Vui lòng sử dụng mã xác thực bên dưới để kích hoạt tài khoản của bạn:</p>
        <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-radius: 8px; margin: 24px 0;">
          <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b;">MÃ XÁC THỰC KÍCH HOẠT</div>
          <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #2563eb; margin-top: 8px;">${payload.code}</div>
        </div>
        <p style="text-align: center; margin: 24px 0;">
          <a href="${payload.verifyUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Kích Hoạt Tài Khoản Ngay
          </a>
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0;">
          Nếu bạn không tạo tài khoản này, vui lòng bỏ qua email. Mã xác thực sẽ hết hạn sau 24 giờ.
        </p>
      </div>
    `;

    this.sentEmails.push({
      to: payload.to,
      subject,
      html,
      text,
      token: payload.token,
      code: payload.code,
      timestamp: new Date().toISOString(),
    });

    return true;
  }

  getLatestEmailFor(email: string): SentEmailRecord | undefined {
    return [...this.sentEmails].reverse().find((e) => e.to.toLowerCase() === email.toLowerCase());
  }

  clear(): void {
    this.sentEmails = [];
  }
}
