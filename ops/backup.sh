#!/bin/sh
set -eu

# ==============================================================================
# REUNION FUND — WAL-SAFE BACKUP SCRIPT
# Planned Schedule: Daily at 04:00 Asia/Ho_Chi_Minh (after 03:30 reconciliation)
# Does NOT include environment secrets or .env files.
# ==============================================================================

DB_PATH="${DB_PATH:-/app/data/reunion-fund.db}"
STORAGE_PATH="${STORAGE_PATH:-/app/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TEMP_WORK_DIR=$(mktemp -d "/tmp/rf_backup_${TIMESTAMP}_XXXXXX")
ARCHIVE_NAME="reunion-fund-backup-${TIMESTAMP}.tar.gz"

echo "=================================================="
echo "Starting Reunion Fund Backup: $TIMESTAMP"
echo "Database source: $DB_PATH"
echo "Storage source:  $STORAGE_PATH"
echo "Backup output:   $BACKUP_DIR/$ARCHIVE_NAME"
echo "=================================================="

mkdir -p "$BACKUP_DIR"
mkdir -p "$TEMP_WORK_DIR/data"
mkdir -p "$TEMP_WORK_DIR/uploads"

# 1. WAL-safe SQLite snapshot
if [ -f "$DB_PATH" ]; then
  echo "[1/4] Creating WAL-safe database backup..."
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(TRUNCATE);"
    sqlite3 "$DB_PATH" ".backup '$TEMP_WORK_DIR/data/reunion-fund.db'"
  else
    # Fallback using node SQLite checkpoint if sqlite3 CLI not in container
    node -e "
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync('$DB_PATH');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      db.close();
    " 2>/dev/null || true
    cp "$DB_PATH" "$TEMP_WORK_DIR/data/reunion-fund.db"
    if [ -f "${DB_PATH}-wal" ]; then cp "${DB_PATH}-wal" "$TEMP_WORK_DIR/data/" 2>/dev/null || true; fi
    if [ -f "${DB_PATH}-shm" ]; then cp "${DB_PATH}-shm" "$TEMP_WORK_DIR/data/" 2>/dev/null || true; fi
  fi
else
  echo "WARNING: Database file not found at $DB_PATH"
fi

# 2. Backup uploaded receipts/proofs
if [ -d "$STORAGE_PATH" ]; then
  echo "[2/4] Archiving uploaded receipts..."
  cp -r "$STORAGE_PATH"/* "$TEMP_WORK_DIR/uploads/" 2>/dev/null || true
fi

# 3. Create Manifest and SHA-256 Checksums
echo "[3/4] Generating checksums and manifest..."
cd "$TEMP_WORK_DIR"
cat <<EOF > manifest.json
{
  "backup_timestamp": "$TIMESTAMP",
  "app": "reunion-fund",
  "db_source": "$DB_PATH",
  "storage_source": "$STORAGE_PATH"
}
EOF

find data uploads manifest.json -type f -exec sha256sum {} + > checksums.sha256

# 4. Package compressed archive
echo "[4/4] Creating compressed archive..."
tar -czf "$BACKUP_DIR/$ARCHIVE_NAME" data uploads manifest.json checksums.sha256

# Cleanup temp work dir
cd /
rm -rf "$TEMP_WORK_DIR"

ARCHIVE_SIZE=$(ls -lh "$BACKUP_DIR/$ARCHIVE_NAME" | awk '{print $5}')
ARCHIVE_HASH=$(sha256sum "$BACKUP_DIR/$ARCHIVE_NAME" | awk '{print $1}')

echo "=================================================="
echo "Backup Completed Successfully!"
echo "Archive:  $BACKUP_DIR/$ARCHIVE_NAME"
echo "Size:     $ARCHIVE_SIZE"
echo "SHA-256:  $ARCHIVE_HASH"
echo "=================================================="
