export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface VerificationEmailPayload {
  to: string;
  fullName: string;
  username: string;
  token: string;
  code: string;
  verifyUrl: string;
}

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<boolean>;
  sendVerificationEmail(payload: VerificationEmailPayload): Promise<boolean>;
}
