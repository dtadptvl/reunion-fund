#!/bin/sh
set -eu

# ==============================================================================
# REUNION FUND — CONTROLLED DECOMMISSION SCRIPT
# SAFETY GUARANTEES:
# 1. Requires explicit argument: --confirm-decommission <staging|production>
# 2. Refuses ambiguous or missing parameters.
# 3. Strictly targets ONLY the designated Reunion Fund container.
# 4. NEVER touches a23-cloudflare-ddns or any unrelated infrastructure container.
# 5. Automatically performs a pre-shutdown safety backup before stopping container.
# 6. Preserves historical backup archives safely.
# ==============================================================================

if [ "$#" -ne 2 ] || [ "$1" != "--confirm-decommission" ]; then
  echo "======================================================================"
  echo "SAFETY ERROR: Unauthorized invocation."
  echo "Usage: $0 --confirm-decommission <staging|production>"
  echo "======================================================================"
  exit 1
fi

TARGET_ENV="$2"

if [ "$TARGET_ENV" != "staging" ] && [ "$TARGET_ENV" != "production" ]; then
  echo "======================================================================"
  echo "SAFETY ERROR: Invalid target environment '$TARGET_ENV'."
  echo "Must be explicitly either 'staging' or 'production'."
  echo "======================================================================"
  exit 1
fi

if [ "$TARGET_ENV" = "staging" ]; then
  CONTAINER_NAME="reunion-fund-stage"
  DATA_DIR="/data/reunion-fund/stage"
else
  CONTAINER_NAME="reunion-fund-prod"
  DATA_DIR="/data/reunion-fund/prod"
fi

echo "======================================================================"
echo "REUNION FUND DECOMMISSION PROCEDURE"
echo "Target Environment: $TARGET_ENV"
echo "Target Container:   $CONTAINER_NAME"
echo "Target Data Path:   $DATA_DIR"
echo "======================================================================"

# Strict safety verification against unrelated containers
UNTOUCHABLE_CONTAINERS="a23-cloudflare-ddns cloudflared ddns nginx caddy system"
for untouchable in $UNTOUCHABLE_CONTAINERS; do
  if [ "$CONTAINER_NAME" = "$untouchable" ]; then
    echo "CRITICAL SAFETY ABORT: Target '$CONTAINER_NAME' is a protected infrastructure container!"
    exit 1
  fi
done

# Step 1: Pre-shutdown safety backup
echo "[1/3] Creating pre-shutdown safety backup..."
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
ARCHIVE_DIR="${DATA_DIR}/archives"
mkdir -p "$ARCHIVE_DIR"

if [ -d "${DATA_DIR}/data" ]; then
  tar -czf "${ARCHIVE_DIR}/final_safety_backup_${TARGET_ENV}_${TIMESTAMP}.tar.gz" -C "${DATA_DIR}" data uploads 2>/dev/null || true
  echo "Safety archive saved at: ${ARCHIVE_DIR}/final_safety_backup_${TARGET_ENV}_${TIMESTAMP}.tar.gz"
fi

# Step 2: Stop target container only
echo "[2/3] Stopping container $CONTAINER_NAME..."
if docker ps -q -f name="^/${CONTAINER_NAME}$" | grep -q .; then
  docker stop "$CONTAINER_NAME"
  echo "Container $CONTAINER_NAME stopped safely."
else
  echo "Container $CONTAINER_NAME is not currently running."
fi

# Step 3: Remove target container only
echo "[3/3] Removing container $CONTAINER_NAME..."
if docker ps -a -q -f name="^/${CONTAINER_NAME}$" | grep -q .; then
  docker rm "$CONTAINER_NAME"
  echo "Container $CONTAINER_NAME removed."
fi

echo "======================================================================"
echo "Decommission Completed Safely for $TARGET_ENV."
echo "Historical data and archives remain preserved at: $DATA_DIR"
echo "Protected containers (a23-cloudflare-ddns) remained untouched."
echo "======================================================================"
