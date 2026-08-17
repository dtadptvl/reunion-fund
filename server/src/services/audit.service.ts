import Database from 'better-sqlite3';
import crypto from 'crypto';
import { AuditLogRow } from '../db/schema.js';

export class AuditService {
  constructor(private db: Database.Database) {}

  log(params: {
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: any;
    afterState?: any;
    ipAddress?: string | null;
  }): void {
    const id = crypto.randomUUID();
    this.db
      .prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type, entity_id, before_state, after_state, ip_address, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .run(
        id,
        params.actor,
        params.action,
        params.entityType,
        params.entityId,
        params.beforeState ? JSON.stringify(params.beforeState) : null,
        params.afterState ? JSON.stringify(params.afterState) : null,
        params.ipAddress || null
      );
  }

  getLogs(limit = 50): AuditLogRow[] {
    return this.db
      .prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as AuditLogRow[];
  }
}
