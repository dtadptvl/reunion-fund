-- Migration 002: Name Corrections and Disambiguator Support

-- 1. Add disambiguator column to members table if not exists
ALTER TABLE members ADD COLUMN disambiguator TEXT;

-- 2. Name Correction Requests Table
CREATE TABLE IF NOT EXISTS name_correction_requests (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    current_name TEXT NOT NULL,
    requested_name TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by TEXT,
    reviewed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_name_correction_member ON name_correction_requests(member_id);
CREATE INDEX IF NOT EXISTS idx_name_correction_status ON name_correction_requests(status);
