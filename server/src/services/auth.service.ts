import argon2 from 'argon2';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { StaffUserRow, UserRow, UserRole, EmailVerificationRow, MemberRow } from '../db/schema.js';
import { EmailProvider } from '../providers/email/types.js';
import { MockEmailProvider } from '../providers/email/mock-email-provider.js';
import { removeVietnameseDiacritics } from './vietqr.service.js';

export interface SessionData {
  userId: string;
  username: string;
  fullName: string;
  role: UserRole;
  memberId?: string | null;
  email?: string | null;
}

export interface AuthResult {
  session?: SessionData;
  error?: string;
  status: 'SUCCESS' | 'INVALID_CREDENTIALS' | 'PENDING_VERIFICATION' | 'LOCKED' | 'NOT_FOUND';
  email?: string | null;
  userId?: string;
}

export const DEFAULT_ADMIN_NAMES = ['Dương Tuấn Anh', 'Hoàng Thị Nhàn'];

export function isDefaultAdminMember(fullName: string): boolean {
  const norm = removeVietnameseDiacritics(fullName).toLowerCase().trim();
  return DEFAULT_ADMIN_NAMES.some(
    (adm) => removeVietnameseDiacritics(adm).toLowerCase().trim() === norm
  );
}

export class AuthService {
  private sessions = new Map<string, { data: SessionData; expiresAt: number }>();
  public emailProvider: EmailProvider;

  constructor(private db: Database.Database, emailProvider?: EmailProvider) {
    this.emailProvider = emailProvider || new MockEmailProvider();
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async seedInitialStaff(username: string, passwordHash?: string, fullName = 'Dương Tuấn Anh'): Promise<boolean> {
    if (!this.db.open) return false;

    // Find Dương Tuấn Anh in canonical members table
    const tuanAnh = this.db
      .prepare("SELECT id, full_name FROM members WHERE full_name = 'Dương Tuấn Anh'")
      .get() as { id: string; full_name: string } | undefined;

    const finalFullName = tuanAnh ? tuanAnh.full_name : fullName;
    const finalMemberId = tuanAnh ? tuanAnh.id : null;

    // Check staff_users table
    const existingStaff = this.db.prepare('SELECT id FROM staff_users WHERE username = ?').get(username);
    const finalHash =
      passwordHash && !passwordHash.includes('dummy')
        ? passwordHash
        : await this.hashPassword('123456');

    if (!existingStaff) {
      const id = crypto.randomUUID();
      this.db
        .prepare(`
          INSERT INTO staff_users (id, username, password_hash, full_name, role, created_at)
          VALUES (?, ?, ?, ?, 'ADMIN', CURRENT_TIMESTAMP)
        `)
        .run(id, username, finalHash, finalFullName);
    } else {
      this.db
        .prepare(`
          UPDATE staff_users SET password_hash = ?, full_name = ? WHERE username = ?
        `)
        .run(finalHash, finalFullName, username);
    }

    // If another account is duplicate-linked to tuanAnh, decouple it safely
    if (!this.db.open) return false;
    if (finalMemberId) {
      this.db
        .prepare('UPDATE users SET member_id = NULL, role = \'MEMBER\' WHERE member_id = ? AND username != ?')
        .run(finalMemberId, username);
    }

    // Also ensure admin exists in users table linked to Dương Tuấn Anh
    if (!this.db.open) return false;
    const existingUser = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined;
    if (!existingUser) {
      const id = crypto.randomUUID();
      this.db
        .prepare(`
          INSERT INTO users (id, member_id, username, email, password_hash, full_name, role, status, email_verified, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'ADMIN', 'ACTIVE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `)
        .run(id, finalMemberId, username, `${username}@reunion.local`, finalHash, finalFullName);
    } else {
      this.db
        .prepare(`
          UPDATE users SET member_id = ?, password_hash = ?, full_name = ?, role = 'ADMIN', status = 'ACTIVE', email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE username = ?
        `)
        .run(finalMemberId, finalHash, finalFullName, username);
    }

    this.seedDefaultAdmins();
    return true;
  }

  seedDefaultAdmins(): void {
    if (!this.db.open) return;

    const adminMemberIds: string[] = [];

    for (const adminName of DEFAULT_ADMIN_NAMES) {
      const normalized = removeVietnameseDiacritics(adminName);
      const members = this.db
        .prepare('SELECT id, full_name FROM members WHERE normalized_name = ?')
        .all(normalized) as MemberRow[];

      for (const m of members) {
        adminMemberIds.push(m.id);
        // Upgrade accounts linked to this member to ADMIN role and sync canonical name
        this.db
          .prepare("UPDATE users SET role = 'ADMIN', full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE member_id = ?")
          .run(m.full_name, m.id);
      }
    }

    // Downgrade any non-default-admin member accounts to MEMBER role
    if (adminMemberIds.length > 0) {
      const placeholders = adminMemberIds.map(() => '?').join(',');
      this.db
        .prepare(`UPDATE users SET role = 'MEMBER', updated_at = CURRENT_TIMESTAMP WHERE member_id IS NOT NULL AND member_id NOT IN (${placeholders}) AND role = 'ADMIN'`)
        .run(...adminMemberIds);
    }
  }

  /**
   * Register a new account for a canonical class member.
   * Enforces 1-account-per-member constraint, unique username, and valid email.
   */
  async registerMember(params: {
    memberId: string;
    username: string;
    email: string;
    password: string;
    appUrl?: string;
  }): Promise<{ user: UserRow; verification: { token: string; code: string; expiresAt: string } }> {
    const { memberId, username, email, password, appUrl } = params;

    // 1. Validate member existence
    const member = this.db.prepare('SELECT * FROM members WHERE id = ?').get(memberId) as MemberRow | undefined;
    if (!member) {
      throw new Error('Không tìm thấy thành viên trong danh sách lớp');
    }

    // 2. Check 1 account per member constraint
    const existingMemberAccount = this.db
      .prepare('SELECT id, username FROM users WHERE member_id = ?')
      .get(memberId) as UserRow | undefined;
    if (existingMemberAccount) {
      throw new Error('Thành viên này đã đăng ký tài khoản. Vui lòng đăng nhập hoặc liên hệ Admin.');
    }

    // 3. Validate username format & uniqueness
    const cleanUsername = username.trim();
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(cleanUsername)) {
      throw new Error('Tên đăng nhập phải từ 3–30 ký tự, chỉ chứa chữ cái, số, gạch dưới hoặc gạch ngang.');
    }

    const existingUsername = this.db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(cleanUsername);
    if (existingUsername) {
      throw new Error('Tên đăng nhập đã được sử dụng. Vui lòng chọn tên đăng nhập khác.');
    }

    // 4. Validate email format & uniqueness
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Địa chỉ email không đúng định dạng.');
    }

    const existingEmail = this.db
      .prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)')
      .get(cleanEmail);
    if (existingEmail) {
      throw new Error('Địa chỉ email này đã được sử dụng cho một tài khoản khác.');
    }

    // 5. Validate password
    if (!password || password.length < 6) {
      throw new Error('Mật khẩu phải có độ dài tối thiểu 6 ký tự.');
    }

    // 6. Determine role (ADMIN for Dương Tuấn Anh / Hoàng Thị Nhàn, MEMBER otherwise)
    const role: UserRole = isDefaultAdminMember(member.full_name) ? 'ADMIN' : 'MEMBER';

    // 7. Hash password with Argon2id
    const passwordHash = await this.hashPassword(password);
    const userId = crypto.randomUUID();

    // 8. Generate verification token and 6-digit code
    const token = crypto.randomBytes(32).toString('hex');
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    const verificationId = crypto.randomUUID();

    const createdUser: UserRow = {
      id: userId,
      member_id: member.id,
      username: cleanUsername,
      email: cleanEmail,
      password_hash: passwordHash,
      full_name: member.full_name + (member.disambiguator ? ` (${member.disambiguator})` : ''),
      role,
      status: 'PENDING_VERIFICATION',
      email_verified: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 9. Atomic insert into database
    this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO users (
            id, member_id, username, email, password_hash, full_name, role, status, email_verified, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_VERIFICATION', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `)
        .run(
          createdUser.id,
          createdUser.member_id,
          createdUser.username,
          createdUser.email,
          createdUser.password_hash,
          createdUser.full_name,
          createdUser.role
        );

      this.db
        .prepare(`
          INSERT INTO email_verifications (
            id, user_id, email, token, code, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `)
        .run(verificationId, userId, cleanEmail, token, code, expiresAt);
    })();

    // 10. Send verification email via EmailProvider
    const baseUrl = appUrl || 'http://localhost:3000';
    const verifyUrl = `${baseUrl}/api/v1/auth/verify-email?token=${token}`;

    await this.emailProvider.sendVerificationEmail({
      to: cleanEmail,
      fullName: createdUser.full_name,
      username: createdUser.username,
      token,
      code,
      verifyUrl,
    });

    return {
      user: createdUser,
      verification: { token, code, expiresAt },
    };
  }

  /**
   * Verify account email via link token or 6-digit code.
   */
  async verifyEmail(params: { token?: string; code?: string; email?: string }): Promise<{ success: boolean; user: UserRow }> {
    const { token, code, email } = params;

    let verification: EmailVerificationRow | undefined;

    if (token) {
      verification = this.db
        .prepare('SELECT * FROM email_verifications WHERE token = ? AND used_at IS NULL')
        .get(token) as EmailVerificationRow | undefined;
    } else if (code && email) {
      verification = this.db
        .prepare('SELECT * FROM email_verifications WHERE LOWER(email) = LOWER(?) AND code = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1')
        .get(email.trim(), code.trim()) as EmailVerificationRow | undefined;
    } else {
      throw new Error('Vui lòng cung cấp mã xác thực hoặc liên kết xác thực.');
    }

    if (!verification) {
      throw new Error('Mã hoặc liên kết xác thực không hợp lệ hoặc đã được sử dụng.');
    }

    if (new Date(verification.expires_at).getTime() < Date.now()) {
      throw new Error('Mã xác thực đã hết hạn. Vui lòng yêu cầu gửi lại mã xác thực mới.');
    }

    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(verification.user_id) as UserRow | undefined;
    if (!user) {
      throw new Error('Không tìm thấy tài khoản người dùng.');
    }

    // Activate user account
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE email_verifications SET used_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(verification.id);

      this.db
        .prepare("UPDATE users SET email_verified = 1, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(user.id);

      if (user.member_id && user.email) {
        this.db
          .prepare('UPDATE members SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(user.email, user.member_id);
      }
    })();

    const updatedUser = this.db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow;
    return { success: true, user: updatedUser };
  }

  /**
   * Resend verification email for an unverified account.
   */
  async resendVerification(identifier: string, appUrl?: string): Promise<{ success: boolean; message: string; email: string }> {
    const cleanId = identifier.trim();
    const user = this.db
      .prepare('SELECT * FROM users WHERE username = ? OR LOWER(email) = LOWER(?)')
      .get(cleanId, cleanId.toLowerCase()) as UserRow | undefined;

    if (!user) {
      throw new Error('Không tìm thấy tài khoản.');
    }

    if (user.email_verified === 1 && user.status === 'ACTIVE') {
      throw new Error('Tài khoản này đã được xác thực email thành công. Bạn có thể đăng nhập ngay.');
    }

    if (!user.email) {
      throw new Error('Tài khoản không có địa chỉ email hợp lệ.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const verificationId = crypto.randomUUID();

    this.db
      .prepare(`
        INSERT INTO email_verifications (
          id, user_id, email, token, code, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .run(verificationId, user.id, user.email, token, code, expiresAt);

    const baseUrl = appUrl || 'http://localhost:3000';
    const verifyUrl = `${baseUrl}/api/v1/auth/verify-email?token=${token}`;

    await this.emailProvider.sendVerificationEmail({
      to: user.email,
      fullName: user.full_name,
      username: user.username,
      token,
      code,
      verifyUrl,
    });

    return {
      success: true,
      message: 'Đã gửi lại mã xác thực tới email của bạn.',
      email: user.email,
    };
  }

  /**
   * Authenticate user by username/email and password.
   */
  async authenticate(usernameOrEmail: string, password: string): Promise<AuthResult> {
    const cleanIdentifier = usernameOrEmail.trim();

    // 1. First check users table
    const user = this.db
      .prepare('SELECT * FROM users WHERE username = ? OR LOWER(email) = LOWER(?)')
      .get(cleanIdentifier, cleanIdentifier.toLowerCase()) as UserRow | undefined;

    if (user) {
      const isValid = await this.verifyPassword(password, user.password_hash);
      if (!isValid) {
        return { status: 'INVALID_CREDENTIALS', error: 'Tên đăng nhập hoặc mật khẩu không chính xác' };
      }

      if (user.status === 'LOCKED') {
        return { status: 'LOCKED', error: 'Tài khoản đã bị khóa. Vui lòng liên hệ Admin.' };
      }

      if (user.email_verified === 0 || user.status === 'PENDING_VERIFICATION') {
        return {
          status: 'PENDING_VERIFICATION',
          error: 'Tài khoản chưa xác thực email. Vui lòng kiểm tra hộp thư để kích hoạt tài khoản.',
          email: user.email,
          userId: user.id,
        };
      }

      return {
        status: 'SUCCESS',
        session: {
          userId: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role,
          memberId: user.member_id,
          email: user.email,
        },
      };
    }

    // 2. Backward compatibility fallback: staff_users table
    const staff = this.db
      .prepare('SELECT * FROM staff_users WHERE username = ?')
      .get(cleanIdentifier) as StaffUserRow | undefined;

    if (staff) {
      const isValid = await this.verifyPassword(password, staff.password_hash);
      if (!isValid) {
        return { status: 'INVALID_CREDENTIALS', error: 'Tên đăng nhập hoặc mật khẩu không chính xác' };
      }

      return {
        status: 'SUCCESS',
        session: {
          userId: staff.id,
          username: staff.username,
          fullName: staff.full_name,
          role: 'ADMIN',
          memberId: staff.member_id,
          email: null,
        },
      };
    }

    return { status: 'NOT_FOUND', error: 'Tên đăng nhập hoặc mật khẩu không chính xác' };
  }

  createSession(user: SessionData, ttlMs = 86400000): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + ttlMs;
    this.sessions.set(token, { data: user, expiresAt });
    return token;
  }

  validateSession(token?: string): SessionData | null {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }

    return session.data;
  }

  destroySession(token: string): void {
    this.sessions.delete(token);
  }
}
