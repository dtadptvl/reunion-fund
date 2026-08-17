#!/usr/bin/env bash
# ==============================================================================
# ops/restore.sh — Verified Safe Restore for Reunion Fund
# ==============================================================================
# Usage: ./ops/restore.sh <backup_dir_path> <target_env>
#
# Verifies SHA256 checksums before applying restore to target environment.
# Target environment must be offline or safely isolated.
# ==============================================================================
set -euo pipefail

BACKUP_DIR="${1:-}"
TARGET_ENV="${2:-stage}"

if [ -z "${BACKUP_DIR}" ] || [ ! -d "${BACKUP_DIR}" ]; then
  echo "Error: Backup directory does not exist or was not specified." >&2
  echo "Usage: $0 <backup_dir_path> [stage|prod]" >&2
  exit 1
fi

DEST_DATA_DIR="/data/reunion-fund/${TARGET_ENV}/data"
DEST_UPLOADS_DIR="/data/reunion-fund/${TARGET_ENV}/uploads"

echo "=================================================="
echo "REUNION FUND RESTORE — Source: ${BACKUP_DIR}"
echo "Target Environment: ${TARGET_ENV}"
echo "Destination Data: ${DEST_DATA_DIR}"
echo "Destination Uploads: ${DEST_UPLOADS_DIR}"
echo "=================================================="

# 1. Verify SHA256 Checksums
echo "[1/4] Verifying SHA256 integrity checksums..."
(
  cd "${BACKUP_DIR}"
  if [ -f "SHA256SUMS" ]; then
    sha256sum -c "SHA256SUMS"
  else
    echo "Warning: No SHA256SUMS file found in backup directory." >&2
  fi
)

# 2. Prepare Destination Directories
echo "[2/4] Preparing target directories..."
mkdir -p "${DEST_DATA_DIR}" "${DEST_UPLOADS_DIR}"

# 3. Restore SQLite Database
echo "[3/4] Restoring SQLite database file..."
if [ -f "${BACKUP_DIR}/reunion.db" ]; then
  cp -f "${BACKUP_DIR}/reunion.db" "${DEST_DATA_DIR}/reunion.db"
  # Remove stale journal or WAL files from previous runtime if any
  rm -f "${DEST_DATA_DIR}/reunion.db-wal" "${DEST_DATA_DIR}/reunion.db-shm" "${DEST_DATA_DIR}/reunion.db-journal"
else
  echo "Error: ${BACKUP_DIR}/reunion.db not found!" >&2
  exit 1
fi

# 4. Restore Uploads / Attachments
echo "[4/4] Extracting uploads archive..."
if [ -f "${BACKUP_DIR}/uploads.tar.gz" ]; then
  tar -xzf "${BACKUP_DIR}/uploads.tar.gz" -C "${DEST_UPLOADS_DIR}"
fi

echo "=================================================="
echo "Restore completed successfully into ${TARGET_ENV}."
echo "=================================================="
