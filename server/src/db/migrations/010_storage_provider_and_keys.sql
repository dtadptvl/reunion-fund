-- Migration 010: Add storage_provider and storage_key to attachments table for portable object identity
-- Preserves existing storage_path and fields for rollback and backward compatibility

ALTER TABLE attachments ADD COLUMN storage_provider TEXT DEFAULT 'LOCAL';
ALTER TABLE attachments ADD COLUMN storage_key TEXT;

CREATE INDEX IF NOT EXISTS idx_attachments_storage_key ON attachments(storage_key);

-- Backfill legacy records to LOCAL provider and receipts/<file_name> key format
UPDATE attachments
SET storage_provider = 'LOCAL',
    storage_key = 'receipts/' || file_name
WHERE storage_key IS NULL;
