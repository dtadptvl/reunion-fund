#!/usr/bin/env bash
# ==============================================================================
# ops/backup.sh — Safe Snapshot Backup for Reunion Fund
# ==============================================================================
# Usage: ./ops/backup.sh [stage|prod] [backup_dir]
#
# Creates a transactionally consistent SQLite backup snapshot and an archive
# of uploaded receipts, accompanied by SHA256 checksums.
# ==============================================================================
set -euo pipefail

ENV_TARGET="${1:-stage}"
BACKUP_ROOT="${2:-/data/reunion-fund/backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="${BACKUP_ROOT}/${ENV_TARGET}_${TIMESTAMP}"

DATA_DIR="/data/reunion-fund/${ENV_TARGET}/data"
UPLOADS_DIR="/data/reunion-fund/${ENV_TARGET}/uploads"
DB_FILE="${DATA_DIR}/reunion.db"

echo "=================================================="
echo "REUNION FUND BACKUP — Target: ${ENV_TARGET}"
echo "Timestamp: ${TIMESTAMP}"
echo "Destination: ${BACKUP_DIR}"
echo "=================================================="

if [ ! -f "${DB_FILE}" ]; then
  echo "Error: Database file ${DB_FILE} does not exist." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# 1. Transactionally Safe SQLite Backup Snapshot
# Uses sqlite3 .backup or safe VACUUM INTO to avoid copying active WAL dirty state
echo "[1/4] Taking consistent SQLite database backup..."
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "${DB_FILE}" ".backup '${BACKUP_DIR}/reunion.db'"
else
  # Fallback using node/sqlite if sqlite3 binary not installed on host
  node -e "
    const Database = require('better-sqlite3');
    const db = new Database('${DB_FILE}', { readonly: true, timeout: 5000 });
    db.backup('${BACKUP_DIR}/reunion.db').then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
  "
fi

# 2. Archive Uploaded Receipts & Invoices
echo "[2/4] Archiving receipts and attachments..."
if [ -d "${UPLOADS_DIR}" ] && [ "$(ls -A "${UPLOADS_DIR}")" ]; then
  tar -czf "${BACKUP_DIR}/uploads.tar.gz" -C "${UPLOADS_DIR}" .
else
  # Create empty archive placeholder if no uploads exist
  tar -czf "${BACKUP_DIR}/uploads.tar.gz" --files-from /dev/null
fi

# 3. Generate SHA256 Checksums & Manifest
echo "[3/4] Generating SHA256 checksums..."
(
  cd "${BACKUP_DIR}"
  sha256sum "reunion.db" "uploads.tar.gz" > "SHA256SUMS"
  cat <<EOF > "manifest.json"
{
  "environment": "${ENV_TARGET}",
  "timestamp": "${TIMESTAMP}",
  "db_size": $(wc -c < "reunion.db" | tr -d ' '),
  "uploads_archive_size": $(wc -c < "uploads.tar.gz" | tr -d ' ')
}
EOF
)

# 4. Retention Policy (Retain last 30 daily backups)
echo "[4/4] Applying 30-day retention cleanup..."
find "${BACKUP_ROOT}" -maxdepth 1 -type d -name "${ENV_TARGET}_*" -mtime +30 -exec rm -rf {} + 2>/dev/null || true

echo "Backup completed successfully at: ${BACKUP_DIR}"
