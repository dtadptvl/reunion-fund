#!/bin/sh
set -eu

# ==============================================================================
# REUNION FUND — RESTORE SCRIPT
# Validates checksums, checks database integrity, and restores files safely.
# ==============================================================================

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <backup-archive.tar.gz> [target-db-dir] [target-storage-dir]"
  exit 1
fi

ARCHIVE_FILE="$1"
TARGET_DB_DIR="${2:-/app/data}"
TARGET_STORAGE_DIR="${3:-/app/uploads}"

if [ ! -f "$ARCHIVE_FILE" ]; then
  echo "ERROR: Backup archive file not found: $ARCHIVE_FILE"
  exit 1
fi

TEMP_RESTORE_DIR=$(mktemp -d "/tmp/rf_restore_XXXXXX")

echo "=================================================="
echo "Starting Reunion Fund Restore Test / Execution"
echo "Archive source:   $ARCHIVE_FILE"
echo "Target DB dir:    $TARGET_DB_DIR"
echo "Target upload dir:$TARGET_STORAGE_DIR"
echo "=================================================="

# 1. Extract to temporary sandbox
echo "[1/4] Extracting archive..."
tar -xzf "$ARCHIVE_FILE" -C "$TEMP_RESTORE_DIR"

# 2. Verify SHA-256 Checksums
echo "[2/4] Verifying checksums..."
cd "$TEMP_RESTORE_DIR"
if [ -f checksums.sha256 ]; then
  sha256sum -c checksums.sha256
  echo "Checksum verification: PASS"
else
  echo "WARNING: No checksums.sha256 manifest found in archive"
fi

# 3. Database Integrity Check
echo "[3/4] Validating database integrity..."
RESTORED_DB="$TEMP_RESTORE_DIR/data/reunion-fund.db"
if [ -f "$RESTORED_DB" ]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    INTEGRITY=$(sqlite3 "$RESTORED_DB" "PRAGMA integrity_check;")
    if [ "$INTEGRITY" != "ok" ]; then
      echo "ERROR: Database integrity check FAILED: $INTEGRITY"
      exit 1
    fi
    ROSTER_COUNT=$(sqlite3 "$RESTORED_DB" "SELECT COUNT(*) FROM members;")
    echo "Database integrity: OK (Canonical members count: $ROSTER_COUNT)"
  else
    node -e "
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync('$RESTORED_DB');
      const integrity = db.prepare('PRAGMA integrity_check;').get();
      if (integrity.integrity_check !== 'ok') {
        console.error('Integrity check failed');
        process.exit(1);
      }
      const count = db.prepare('SELECT COUNT(*) as c FROM members;').get().c;
      console.log('Database integrity: OK (Members count: ' + count + ')');
      db.close();
    "
  fi
else
  echo "ERROR: No database file found in archive"
  exit 1
fi

# 4. Copy to Target Destination
echo "[4/4] Deploying restored files to target destination..."
mkdir -p "$TARGET_DB_DIR" "$TARGET_STORAGE_DIR"

cp "$RESTORED_DB" "$TARGET_DB_DIR/reunion-fund.db"
if [ -f "$TEMP_RESTORE_DIR/data/reunion-fund.db-wal" ]; then
  cp "$TEMP_RESTORE_DIR/data/reunion-fund.db-wal" "$TARGET_DB_DIR/"
fi
if [ -f "$TEMP_RESTORE_DIR/data/reunion-fund.db-shm" ]; then
  cp "$TEMP_RESTORE_DIR/data/reunion-fund.db-shm" "$TARGET_DB_DIR/"
fi

if [ -d "$TEMP_RESTORE_DIR/uploads" ]; then
  cp -r "$TEMP_RESTORE_DIR/uploads"/* "$TARGET_STORAGE_DIR/" 2>/dev/null || true
fi

# Cleanup
cd /
rm -rf "$TEMP_RESTORE_DIR"

echo "=================================================="
echo "Restore Process Completed Successfully!"
echo "Target DB:      $TARGET_DB_DIR/reunion-fund.db"
echo "Target Storage: $TARGET_STORAGE_DIR"
echo "=================================================="
