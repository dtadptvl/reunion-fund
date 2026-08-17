#!/bin/sh
set -eu
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Export environment variables from .env
set -a
. /data/reunion-fund/stage/.env
set +a

node /data/reunion-fund/stage/verify-sepay.mjs
