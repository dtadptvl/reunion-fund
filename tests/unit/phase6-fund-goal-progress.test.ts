import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import supertest from 'supertest';
import crypto from 'crypto';
import { buildApp } from '../../server/src/app.js';
import { runMigrations } from '../../server/src/db/connection.js';
import { MockBankSyncProvider } from '../../server/src/providers/bank-sync/mock-provider.js';
import { MockAIProvider } from '../../server/src/providers/ai/mock-ai-provider.js';

function insertContribution(db: Database.Database, amount: number) {
  const bankTxId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO bank_transactions (id, sepay_id, gateway, transaction_date, account_number, transfer_type, transfer_amount, content, raw_payload, ingestion_source)
    VALUES (?, ?, 'MB', datetime('now'), '0123', 'in', ?, 'test', '{}', 'WEBHOOK')
  `).run(bankTxId, Math.floor(Math.random() * 10000000) + 1000, amount);

  db.prepare(`
    INSERT INTO contributions (id, bank_transaction_id, contributor_type, amount, match_method)
    VALUES (?, ?, 'MEMBER', ?, 'EXACT_PAYMENT_CODE')
  `).run(crypto.randomUUID(), bankTxId, amount);
}

describe('V2 Phase 6 — Fund Goal Progress & Fire Overgoal', () => {
  let db: Database.Database;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db);

    app = buildApp({
      db,
      bankSyncProvider: new MockBankSyncProvider(),
      aiProvider: new MockAIProvider(),
    });

    await app.ready();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db && db.open) db.close();
  });

  it('1. Target calculation: dynamic target is always suggestedAmount * 18 with default fallback', async () => {
    // Default suggested amount = 500,000 -> target = 9,000,000
    const res1 = await supertest(app.server).get('/api/v1/public/overview');
    expect(res1.status).toBe(200);
    expect(res1.body.fundGoal).toBeDefined();
    expect(res1.body.fundGoal.suggestedAmount).toBe(500000);
    expect(res1.body.fundGoal.targetAmount).toBe(9000000);
    expect(res1.body.fundGoal.targetMultiplier).toBe(18);

    // Also verified via /api/v1/public/config
    const configRes = await supertest(app.server).get('/api/v1/public/config');
    expect(configRes.status).toBe(200);
    expect(configRes.body.suggestedAmount).toBe(500000);
    expect(configRes.body.targetAmount).toBe(9000000);
  });

  it('2. 0% state: when totalIncome is 0, progressPercent is 0 and isGoalReached is false', async () => {
    const res = await supertest(app.server).get('/api/v1/public/overview');
    expect(res.body.totalIncome).toBe(0);
    expect(res.body.fundGoal.progressPercent).toBe(0);
    expect(res.body.fundGoal.isGoalReached).toBe(false);
    expect(res.body.fundGoal.overGoalPercent).toBe(0);
  });

  it('3. Normal state (<100%): calculates correct percentage (e.g. 12.6M / 18M = 70%)', async () => {
    // Set suggested amount to 1,000,000 (target = 18,000,000)
    db.prepare("INSERT OR REPLACE INTO system_state (key, value) VALUES ('suggested_contribution_amount', '1000000')").run();

    // Insert 12,600,000 income
    insertContribution(db, 12600000);

    const res = await supertest(app.server).get('/api/v1/public/overview');
    expect(res.body.totalIncome).toBe(12600000);
    expect(res.body.fundGoal.targetAmount).toBe(18000000);
    expect(res.body.fundGoal.progressPercent).toBe(70);
    expect(res.body.fundGoal.isGoalReached).toBe(false);
    expect(res.body.fundGoal.overGoalPercent).toBe(0);
  });

  it('4. Exactly 100% state: isGoalReached is true, progressPercent is 100, overGoalPercent is 0', async () => {
    db.prepare("INSERT OR REPLACE INTO system_state (key, value) VALUES ('suggested_contribution_amount', '1000000')").run();
    insertContribution(db, 18000000);

    const res = await supertest(app.server).get('/api/v1/public/overview');
    expect(res.body.totalIncome).toBe(18000000);
    expect(res.body.fundGoal.progressPercent).toBe(100);
    expect(res.body.fundGoal.isGoalReached).toBe(true);
    expect(res.body.fundGoal.overGoalPercent).toBe(0);
  });

  it('5. Overgoal fire state: 127% progress -> overGoalPercent is 27%', async () => {
    db.prepare("INSERT OR REPLACE INTO system_state (key, value) VALUES ('suggested_contribution_amount', '1000000')").run();
    // 22,860,000 / 18,000,000 = 127%
    insertContribution(db, 22860000);

    const res = await supertest(app.server).get('/api/v1/public/overview');
    expect(res.body.totalIncome).toBe(22860000);
    expect(res.body.fundGoal.progressPercent).toBe(127);
    expect(res.body.fundGoal.isGoalReached).toBe(true);
    expect(res.body.fundGoal.overGoalPercent).toBe(27);
  });

  it('6. Dynamic Admin setting interaction: changing suggested amount immediately changes target', async () => {
    // 1. Initial 500,000 -> target 9,000,000
    const res1 = await supertest(app.server).get('/api/v1/public/overview');
    expect(res1.body.fundGoal.targetAmount).toBe(9000000);

    // 2. Admin updates suggested amount to 1,000,000
    db.prepare("INSERT OR REPLACE INTO system_state (key, value) VALUES ('suggested_contribution_amount', '1000000')").run();

    const res2 = await supertest(app.server).get('/api/v1/public/overview');
    expect(res2.body.fundGoal.suggestedAmount).toBe(1000000);
    expect(res2.body.fundGoal.targetAmount).toBe(18000000);

    // 3. Admin updates suggested amount to 1,500,000
    db.prepare("INSERT OR REPLACE INTO system_state (key, value) VALUES ('suggested_contribution_amount', '1500000')").run();

    const res3 = await supertest(app.server).get('/api/v1/public/overview');
    expect(res3.body.fundGoal.suggestedAmount).toBe(1500000);
    expect(res3.body.fundGoal.targetAmount).toBe(27000000);
  });

  it('7. Edge cases: handles corrupted or negative suggested amount safely', async () => {
    // Negative or NaN in system_state
    db.prepare("INSERT OR REPLACE INTO system_state (key, value) VALUES ('suggested_contribution_amount', '-500000')").run();

    const res = await supertest(app.server).get('/api/v1/public/overview');
    expect(res.status).toBe(200);
    expect(res.body.fundGoal.suggestedAmount).toBe(500000); // Safe fallback
    expect(res.body.fundGoal.targetAmount).toBe(9000000);
    expect(isNaN(res.body.fundGoal.progressPercent)).toBe(false);
  });
});
