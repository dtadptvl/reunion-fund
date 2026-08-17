import argon2 from 'argon2';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { StaffUserRow } from '../db/schema.js';

export interface SessionData {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  memberId?: string | null;
}

export class AuthService {
  private sessions = new Map<string, { data: SessionData; expiresAt: number }>();

  constructor(private db: Database.Database) {}

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

  async seedInitialStaff(username: string, passwordHash?: string, fullName = 'Thủ Quỹ Lớp A1'): Promise<boolean> {
    if (!this.db.open) return false;
    const existing = this.db.prepare('SELECT id FROM staff_users WHERE username = ?').get(username);
    if (!existing) {
      const id = crypto.randomUUID();
      const finalHash = passwordHash && !passwordHash.includes('dummy')
        ? passwordHash
        : await this.hashPassword('123456');
      if (!this.db.open) return false;
      this.db.prepare(`
        INSERT INTO staff_users (id, username, password_hash, full_name, role, created_at)
        VALUES (?, ?, ?, ?, 'TREASURER', CURRENT_TIMESTAMP)
      `).run(id, username, finalHash, fullName);
      return true;
    }
    return false;
  }

  async authenticate(username: string, password: string): Promise<SessionData | null> {
    const user = this.db
      .prepare('SELECT * FROM staff_users WHERE username = ?')
      .get(username) as StaffUserRow | undefined;

    if (!user) {
      return null;
    }

    const isValid = await this.verifyPassword(password, user.password_hash);
    if (!isValid) {
      return null;
    }

    return {
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      memberId: user.member_id,
    };
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
