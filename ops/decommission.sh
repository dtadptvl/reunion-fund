#!/usr/bin/env bash
# ==============================================================================
# ops/decommission.sh — Safe Decommissioning of Reunion Fund Workload
# ==============================================================================
# WARNING: This script removes the Reunion Fund container, images, and runtime data.
# It requires EXPLICIT manual confirmation and will NEVER delete anything silently.
#
# Crucial Invariant: NEVER affects a23-cloudflare-ddns or server-monitor.
# ==============================================================================
set -euo pipefail

TARGET_ENV="${1:-}"

if [ "${TARGET_ENV}" != "stage" ] && [ "${TARGET_ENV}" != "prod" ]; then
  echo "Error: Target environment required. Usage: $0 [stage|prod]" >&2
  exit 1
fi

CONTAINER_NAME="reunion-fund-${TARGET_ENV}"
DATA_DIR="/data/reunion-fund/${TARGET_ENV}"
SECRETS_FILE="/etc/a23-secrets/reunion-fund-${TARGET_ENV}.env"
DOCKER_CMD="chroot /data/local/chroot/debian /usr/bin/docker"

echo "======================================================================"
echo "                   REUNION FUND DECOMMISSION WIZARD                   "
echo "======================================================================"
echo "Target Environment: ${TARGET_ENV}"
echo "Container to Stop & Remove: ${CONTAINER_NAME}"
echo "Data Directory to Archive/Purge: ${DATA_DIR}"
echo "Secrets File to Remove: ${SECRETS_FILE}"
echo ""
echo "CRITICAL SAFETY INVARIANT:"
echo "This script is strictly bound to ${CONTAINER_NAME}."
echo "Existing infrastructure ('a23-cloudflare-ddns', 'server-monitor') WILL NOT BE TOUCHED."
echo "======================================================================"
echo ""
echo "To proceed, you MUST type the exact confirmation phrase below:"
echo "CONFIRM_DECOMMISSION_REUNION_FUND"
echo ""
read -r -p "Enter confirmation phrase: " CONFIRMATION

if [ "${CONFIRMATION}" != "CONFIRM_DECOMMISSION_REUNION_FUND" ]; then
  echo "Confirmation phrase did not match. Decommission aborted. No changes made."
  exit 0
fi

echo ""
echo "[Step 1/5] Taking final pre-decommission backup..."
./ops/backup.sh "${TARGET_ENV}" "/data/reunion-fund/final_archives" || echo "Warning: Backup script failed or skipped."

echo "[Step 2/5] Stopping and removing container ${CONTAINER_NAME}..."
${DOCKER_CMD} stop "${CONTAINER_NAME}" 2>/dev/null || true
${DOCKER_CMD} rm "${CONTAINER_NAME}" 2>/dev/null || true

echo "[Step 3/5] Removing Docker image..."
${DOCKER_CMD} rmi "reunion-fund:latest" 2>/dev/null || true

echo "[Step 4/5] Removing runtime secrets file..."
rm -f "${SECRETS_FILE}"

echo "[Step 5/5] Removing runtime storage directory ${DATA_DIR}..."
rm -rf "${DATA_DIR}"

echo ""
echo "======================================================================"
echo "Decommission complete for ${TARGET_ENV}."
echo "Cloudflare route for ${TARGET_ENV} should now be removed via Cloudflare Zero Trust Dashboard."
echo "======================================================================"
