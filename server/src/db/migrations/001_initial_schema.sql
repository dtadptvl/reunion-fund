-- Migration 001: Initial Schema for Reunion Fund V1
-- SQLite WAL mode, foreign keys, busy timeout enabled

PRAGMA foreign_keys = ON;

-- 1. System State (key-value store for global settings and settlement state)
CREATE TABLE IF NOT EXISTS system_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Members (canonical class roster)
CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    bank_display_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_members_normalized_name ON members(normalized_name);
CREATE INDEX IF NOT EXISTS idx_members_bank_display ON members(bank_display_name);

-- 3. External Contributors (non-roster contributors)
CREATE TABLE IF NOT EXISTS external_contributors (
    id TEXT PRIMARY KEY,
    raw_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW', 'NORMALIZED', 'LINKED_TO_MEMBER', 'CONFIRMED_EXTERNAL')),
    linked_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_external_contributors_status ON external_contributors(status);

-- 4. Payment Intents (QR code generation requests)
CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    payment_code TEXT UNIQUE NOT NULL,
    member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
    external_contributor_id TEXT REFERENCES external_contributors(id) ON DELETE SET NULL,
    expected_amount INTEGER NOT NULL,
    transfer_content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'COMPLETED', 'EXPIRED')),
    expires_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_code ON payment_intents(payment_code);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);

-- 5. Bank Transactions (Immutable source of truth from SePay)
CREATE TABLE IF NOT EXISTS bank_transactions (
    id TEXT PRIMARY KEY,
    sepay_id INTEGER UNIQUE NOT NULL,
    gateway TEXT NOT NULL,
    transaction_date DATETIME NOT NULL,
    account_number TEXT NOT NULL,
    sub_account TEXT,
    transfer_type TEXT NOT NULL CHECK(transfer_type IN ('in', 'out')),
    transfer_amount INTEGER NOT NULL,
    accumulated INTEGER,
    code TEXT,
    content TEXT NOT NULL,
    description TEXT,
    reference_code TEXT,
    raw_payload TEXT NOT NULL,
    ingestion_source TEXT NOT NULL CHECK(ingestion_source IN ('WEBHOOK', 'RECONCILIATION', 'MANUAL_IMPORT')),
    is_excluded INTEGER NOT NULL DEFAULT 0 CHECK(is_excluded IN (0, 1)),
    exclusion_reason TEXT,
    excluded_by TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_sepay_id ON bank_transactions(sepay_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_type ON bank_transactions(transfer_type);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(transaction_date);

-- 6. Contributions (Recognized Money-In records)
CREATE TABLE IF NOT EXISTS contributions (
    id TEXT PRIMARY KEY,
    bank_transaction_id TEXT UNIQUE NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
    payment_intent_id TEXT REFERENCES payment_intents(id) ON DELETE SET NULL,
    contributor_type TEXT NOT NULL CHECK(contributor_type IN ('MEMBER', 'EXTERNAL', 'UNRESOLVED')),
    member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
    external_contributor_id TEXT REFERENCES external_contributors(id) ON DELETE SET NULL,
    unresolved_name TEXT,
    amount INTEGER NOT NULL,
    is_amount_mismatch INTEGER NOT NULL DEFAULT 0 CHECK(is_amount_mismatch IN (0, 1)),
    match_method TEXT NOT NULL CHECK(match_method IN ('EXACT_PAYMENT_CODE', 'DETERMINISTIC_NAME_FALLBACK', 'MANUAL_TREASURER_ASSIGNMENT', 'UNRESOLVED')),
    reviewed_by TEXT,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contributions_member_id ON contributions(member_id);
CREATE INDEX IF NOT EXISTS idx_contributions_type ON contributions(contributor_type);
CREATE INDEX IF NOT EXISTS idx_contributions_match_method ON contributions(match_method);

-- 7. Expenses (Recognized Money-Out records)
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    bank_transaction_id TEXT UNIQUE NOT NULL REFERENCES bank_transactions(id) ON DELETE RESTRICT,
    title TEXT,
    vietnamese_title TEXT,
    category TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(category IN ('FOOD', 'GIFT_TEACHER', 'FLOWERS', 'PHOTO_VIDEO', 'PRINTING', 'TRANSPORT', 'REFUND', 'FUND_TRANSFER', 'OTHER', 'UNKNOWN')),
    recipient_name TEXT,
    recipient_account TEXT,
    recipient_bank TEXT,
    amount INTEGER NOT NULL,
    classification_source TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(classification_source IN ('MANUAL_OVERRIDE', 'LEARNED_RULE', 'DETERMINISTIC_RULE', 'GEMINI_AI', 'UNKNOWN')),
    ai_confidence REAL,
    is_settlement_transfer INTEGER NOT NULL DEFAULT 0 CHECK(is_settlement_transfer IN (0, 1)),
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
CREATE INDEX IF NOT EXISTS idx_expenses_classification_source ON expenses(classification_source);

-- 8. Learned Classification Rules
CREATE TABLE IF NOT EXISTS classification_rules (
    id TEXT PRIMARY KEY,
    recipient_pattern TEXT UNIQUE NOT NULL,
    assigned_category TEXT NOT NULL,
    suggested_title TEXT,
    created_by TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Attachments (Invoices, Receipts, Photos)
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    sha256_hash TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    uploaded_by TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attachments_expense_id ON attachments(expense_id);

-- 10. Staff Users (Treasurer Accounts)
CREATE TABLE IF NOT EXISTS staff_users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'TREASURER' CHECK(role IN ('ADMIN', 'TREASURER')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 11. Audit Logs (Immutable audit trail of staff actions)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_state TEXT,
    after_state TEXT,
    ip_address TEXT,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- 12. Reconciliation Runs (History of automated and manual SePay API reconciliations)
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id TEXT PRIMARY KEY,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    status TEXT NOT NULL CHECK(status IN ('RUNNING', 'SUCCESS', 'FAILED')),
    total_checked INTEGER NOT NULL DEFAULT 0,
    already_present INTEGER NOT NULL DEFAULT 0,
    newly_imported INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    log_summary TEXT,
    triggered_by TEXT NOT NULL CHECK(triggered_by IN ('CRON', 'STARTUP', 'MANUAL'))
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_started ON reconciliation_runs(started_at);
