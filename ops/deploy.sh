#!/usr/bin/env bash
# ==============================================================================
# ops/deploy.sh — Deployment Orchestration for Samsung A23 Docker Runtime
# ==============================================================================
# Usage: ./ops/deploy.sh [stage|prod] [image_tag]
#
# Ensures isolated deployment without touching existing A23 containers.
# ==============================================================================
set -euo pipefail

TARGET_ENV="${1:-stage}"
IMAGE_TAG="${2:-latest}"
IMAGE_NAME="reunion-fund:${IMAGE_TAG}"

if [ "${TARGET_ENV}" = "prod" ]; then
  CONTAINER_NAME="reunion-fund-prod"
  HOST_PORT=3000
  ENV_FILE="/etc/a23-secrets/reunion-fund-prod.env"
  DATA_DIR="/data/reunion-fund/prod/data"
  UPLOADS_DIR="/data/reunion-fund/prod/uploads"
elif [ "${TARGET_ENV}" = "stage" ]; then
  CONTAINER_NAME="reunion-fund-stage"
  HOST_PORT=3001
  ENV_FILE="/etc/a23-secrets/reunion-fund-stage.env"
  DATA_DIR="/data/reunion-fund/stage/data"
  UPLOADS_DIR="/data/reunion-fund/stage/uploads"
else
  echo "Error: Invalid environment '${TARGET_ENV}'. Use 'stage' or 'prod'." >&2
  exit 1
fi

echo "=================================================="
echo "DEPLOYING REUNION FUND WORKLOAD"
echo "Environment:     ${TARGET_ENV}"
echo "Container Name:  ${CONTAINER_NAME}"
echo "Host Port:       ${HOST_PORT}"
echo "Image:           ${IMAGE_NAME}"
echo "Data Directory:  ${DATA_DIR}"
echo "=================================================="

# Invariant check: Protect existing production containers
if [ "${CONTAINER_NAME}" = "a23-cloudflare-ddns" ]; then
  echo "FATAL: Attempted to touch critical production infrastructure. Aborting." >&2
  exit 1
fi

# Ensure storage directories exist
mkdir -p "${DATA_DIR}" "${UPLOADS_DIR}"

# Run inside Debian Chroot via Docker CLI
DOCKER_CMD="chroot /data/local/chroot/debian /usr/bin/docker"

# 1. Stop and remove existing container if running (isolated to this container only)
if ${DOCKER_CMD} ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
  echo "[1/3] Stopping and removing previous ${CONTAINER_NAME} container..."
  ${DOCKER_CMD} stop "${CONTAINER_NAME}" || true
  ${DOCKER_CMD} rm "${CONTAINER_NAME}" || true
fi

# 2. Launch new container with restart=unless-stopped and isolated volume mounts
echo "[2/3] Starting container ${CONTAINER_NAME}..."
${DOCKER_CMD} run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  -p "${HOST_PORT}:3000" \
  -v "${DATA_DIR}:/app/data" \
  -v "${UPLOADS_DIR}:/app/uploads" \
  --env-file "${ENV_FILE}" \
  "${IMAGE_NAME}"

# 3. Verify Health Probe
echo "[3/3] Waiting for application readiness..."
sleep 3
READY=0
for i in {1..15}; do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/health/ready" >/dev/null 2>&1; then
    echo "Health check PASSED. Application is ready on port ${HOST_PORT}."
    READY=1
    break
  fi
  sleep 1
done

if [ "${READY}" -ne 1 ]; then
  echo "Warning: Health probe did not respond ready within 15 seconds. Check docker logs ${CONTAINER_NAME}." >&2
  exit 1
fi
