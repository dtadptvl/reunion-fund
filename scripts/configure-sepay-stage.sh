#!/bin/sh
set -eu

ENV_FILE="/data/reunion-fund/stage/.env"

echo "============================================================"
echo "  SEPAY SANDBOX SECURE SECRET CONFIGURATION (A23 STAGE)"
echo "============================================================"
echo ""
echo "Notice: If you have not created your SePay Sandbox credentials yet:"
echo "1. Log into https://my.sepay.vn"
echo "2. Create an API Token in Sandbox / Test Mode."
echo "3. Configure Webhook URL: https://12a1-stage.tuananhdg.eu.org/api/v1/webhooks/sepay"
echo "4. Copy the Webhook Secret (HMAC secret)."
echo ""
echo "Input will be hidden (no characters will be displayed on screen)."
echo ""

# 1. Read SEPAY_API_TOKEN silently
printf "Enter SePay Sandbox API Token: "
stty -echo 2>/dev/null || true
read -r SEPAY_API_TOKEN
stty echo 2>/dev/null || true
echo ""

if [ -z "${SEPAY_API_TOKEN:-}" ]; then
  echo "Error: SePay API Token cannot be empty." >&2
  exit 1
fi

# 2. Read SEPAY_WEBHOOK_SECRET silently
printf "Enter SePay Sandbox Webhook Secret: "
stty -echo 2>/dev/null || true
read -r SEPAY_WEBHOOK_SECRET
stty echo 2>/dev/null || true
echo ""

if [ -z "${SEPAY_WEBHOOK_SECRET:-}" ]; then
  echo "Error: SePay Webhook Secret cannot be empty." >&2
  exit 1
fi

# 3. Create or update .env preserving existing non-SEPAY configuration
TMP_FILE=$(mktemp "/data/reunion-fund/stage/.env.tmp.XXXXXX")
chmod 600 "$TMP_FILE"

if [ -f "$ENV_FILE" ]; then
  # Filter out old SEPAY_ keys while preserving other configuration
  grep -v -E '^(SEPAY_ENVIRONMENT|SEPAY_BASE_URL|SEPAY_API_TOKEN|SEPAY_WEBHOOK_SECRET)=' "$ENV_FILE" > "$TMP_FILE" || true
fi

# Append new SePay sandbox configuration
{
  echo "SEPAY_ENVIRONMENT=sandbox"
  echo "SEPAY_BASE_URL=https://userapi-sandbox.sepay.vn/v2"
  printf "SEPAY_API_TOKEN=%s\n" "$SEPAY_API_TOKEN"
  printf "SEPAY_WEBHOOK_SECRET=%s\n" "$SEPAY_WEBHOOK_SECRET"
} >> "$TMP_FILE"

mv "$TMP_FILE" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Wipe variables from memory
unset SEPAY_API_TOKEN
unset SEPAY_WEBHOOK_SECRET

echo "Configuration updated successfully."
echo ""
echo "============================================================"
echo "VERIFICATION RESULT:"
echo "SEPAY_ENVIRONMENT: sandbox"
echo "SEPAY_BASE_URL: configured"
echo "SEPAY_API_TOKEN: configured"
echo "SEPAY_WEBHOOK_SECRET: configured"
echo "permissions: 600"
echo "============================================================"
echo ""
echo "Restarting reunion-fund-stage container..."
if [ -x "/usr/bin/docker" ]; then
  docker restart reunion-fund-stage
elif [ -d "/data/local/chroot/debian" ]; then
  chroot /data/local/chroot/debian /usr/bin/docker restart reunion-fund-stage
fi

echo ""
echo "Done."
