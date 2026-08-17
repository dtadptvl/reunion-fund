-- Migration 003: Add MOCK_AI to expenses classification_source CHECK constraint

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS expenses_new (
    id TEXT PRIMARY KEY,
    bank_transaction_id TEXT UNIQUE NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
    title TEXT,
    vietnamese_title TEXT,
    category TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(category IN ('FOOD', 'GIFT_TEACHER', 'FLOWERS', 'PHOTO_VIDEO', 'PRINTING', 'TRANSPORT', 'REFUND', 'FUND_TRANSFER', 'OTHER', 'UNKNOWN')),
    recipient_name TEXT,
    recipient_account TEXT,
    recipient_bank TEXT,
    amount INTEGER NOT NULL,
    classification_source TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(classification_source IN ('MANUAL_OVERRIDE', 'LEARNED_RULE', 'DETERMINISTIC_RULE', 'GEMINI_AI', 'MOCK_AI', 'UNKNOWN')),
    ai_confidence REAL,
    is_settlement_transfer INTEGER NOT NULL DEFAULT 0 CHECK(is_settlement_transfer IN (0, 1)),
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO expenses_new SELECT * FROM expenses;

DROP TABLE expenses;

ALTER TABLE expenses_new RENAME TO expenses;

CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_classification_source ON expenses(classification_source);

PRAGMA foreign_keys = ON;
