import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/src/db/connection.js';

describe('SQLite Schema & Migrations Runner', () => {
  it('applies initial migration 001 and creates all tables with constraints', () => {
    const db = new Database(':memory:');
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('schema_migrations');
    expect(tables).toContain('system_state');
    expect(tables).toContain('members');
    expect(tables).toContain('external_contributors');
    expect(tables).toContain('payment_intents');
    expect(tables).toContain('bank_transactions');
    expect(tables).toContain('contributions');
    expect(tables).toContain('expenses');
    expect(tables).toContain('classification_rules');
    expect(tables).toContain('attachments');
    expect(tables).toContain('staff_users');
    expect(tables).toContain('users');
    expect(tables).toContain('email_verifications');
    expect(tables).toContain('audit_logs');
    expect(tables).toContain('reconciliation_runs');

    // Verify foreign key enforcement
    db.pragma('foreign_keys = ON');
    expect(() => {
      db.prepare(`
        INSERT INTO contributions (id, bank_transaction_id, contributor_type, amount, match_method)
        VALUES ('c1', 'non_existent_tx', 'MEMBER', 500000, 'EXACT_PAYMENT_CODE')
      `).run();
    }).toThrow();

    db.close();
  });
});
