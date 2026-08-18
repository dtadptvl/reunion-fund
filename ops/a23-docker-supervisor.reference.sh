#!/bin/sh
# ==============================================================================
# ops/a23-docker-supervisor.reference.sh
# Reference template for Samsung A23 / Termux-Debian Docker Root Supervisor
# (Sanitized operational reference for unattended A23 environment)
# ==============================================================================
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
if [ -f "$SCRIPT_DIR/lib.sh" ]; then
    . "$SCRIPT_DIR/lib.sh"
else
    . /data/data/com.termux/files/home/a23-docker/lib.sh
fi

mkdir -p "$RUN_DIR" "$LOG_DIR"

# PHASE 1: OUTER IDEMPOTENCE & NAMESPACE ENTRY
if [ "${1:-}" != "--in-namespace" ]; then
    rotate_log_if_needed "$SUPERVISOR_LOG" "$SUPERVISOR_MAX_BYTES"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Supervisor-Outer] Starting supervisor initialization (PID: $$)..." >> "$SUPERVISOR_LOG"

    if [ -s "$SUPERVISOR_PID_FILE" ]; then
        EXISTING_SPID=$(cat "$SUPERVISOR_PID_FILE" 2>/dev/null || echo "")
        if [ -n "$EXISTING_SPID" ] && is_supervisor_proc "$EXISTING_SPID"; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Supervisor-Outer] Supervisor already running with PID $EXISTING_SPID. Exiting." >> "$SUPERVISOR_LOG"
            exit 0
        fi
        rm -f "$SUPERVISOR_PID_FILE"
    fi

    rm -f "$STOP_FLAG"
    exec "$BB" unshare -m /bin/sh "$0" --in-namespace
fi

# PHASE 2: PRIVATE MOUNT NAMESPACE & CGROUP-V2 HIERARCHY
echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Supervisor-NS] Active inside private mount namespace (PID: $$)" >> "$SUPERVISOR_LOG"
echo "$$" > "$SUPERVISOR_PID_FILE"
echo "STARTING" > "$STATUS_FILE"

ROOT="$CHROOT_DIR"

if [ ! -d "$ROOT" ] || [ ! -x "$ROOT/bin/bash" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Supervisor-NS] ERROR: Debian rootfs missing at $ROOT!" >> "$SUPERVISOR_LOG"
    echo "FAILED" > "$STATUS_FILE"
    exit 1
fi

# Isolate mount propagation
"$BB" mount --make-rprivate /
"$BB" mount --bind "$ROOT" "$ROOT"
"$BB" mount --make-rprivate "$ROOT"

# Mount Debian pseudo-filesystems defensively
mkdir -p "$ROOT/dev" "$ROOT/proc" "$ROOT/sys" "$ROOT/run" "$ROOT/var/lib/docker" "$ROOT/run/docker"
"$BB" mount -t proc proc "$ROOT/proc" 2>/dev/null || true
"$BB" mount --rbind /sys "$ROOT/sys" 2>/dev/null || true
"$BB" mount --rbind /dev "$ROOT/dev" 2>/dev/null || true

mkdir -p "$ROOT/dev/shm" "$ROOT/dev/pts"
"$BB" mount -t tmpfs -o mode=1777,nosuid,nodev tmpfs "$ROOT/dev/shm" 2>/dev/null || true
"$BB" mount -t devpts devpts "$ROOT/dev/pts" 2>/dev/null || true

# Mount project storage directories into Debian chroot
if [ -d "/data/reunion-fund" ]; then
    mkdir -p "$ROOT/data/reunion-fund"
    "$BB" mount --bind /data/reunion-fund "$ROOT/data/reunion-fund" 2>/dev/null || true
fi

# Mount pure cgroup v2 hierarchy at Debian /sys/fs/cgroup
mkdir -p "$ROOT/sys/fs/cgroup"
"$BB" mount -t cgroup2 none "$ROOT/sys/fs/cgroup"

# Clean stale sockets and pids if no active dockerd owns them
SOCK_FILE="$ROOT/run/docker.sock"
if [ -S "$SOCK_FILE" ] || [ -f "$ROOT/run/docker.pid" ]; then
    if [ -s "$DOCKERD_PID_FILE" ]; then
        OLD_DPID=$(cat "$DOCKERD_PID_FILE" 2>/dev/null || echo "")
        if [ -n "$OLD_DPID" ] && is_dockerd_proc "$OLD_DPID"; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Supervisor-NS] Existing dockerd (PID: $OLD_DPID) owns socket. Keeping." >> "$SUPERVISOR_LOG"
        else
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Supervisor-NS] Unlinking stale socket/runtime files" >> "$SUPERVISOR_LOG"
            rm -rf "$ROOT/run/docker/containerd" "$ROOT/run/docker.sock" "$ROOT/run/docker.pid" "$ROOT/run/containerd" 2>/dev/null || true
        fi
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] [Supervisor-NS] Unlinking orphan socket/runtime files" >> "$SUPERVISOR_LOG"
        rm -rf "$ROOT/run/docker/containerd" "$ROOT/run/docker.sock" "$ROOT/run/docker.pid" "$ROOT/run/containerd" 2>/dev/null || true
    fi
fi

# PHASE 3: SUPERVISION LOOP & BACKOFF
BACKOFF=5
MAX_BACKOFF=30
CONSECUTIVE_CRASHES=0
MAX_CRASHES=10

cleanup_and_exit() {
    touch "$STOP_FLAG"
    if [ -s "$DOCKERD_PID_FILE" ]; then
        DPID=$(cat "$DOCKERD_PID_FILE" 2>/dev/null || echo "")
        if [ -n "$DPID" ] && is_dockerd_proc "$DPID"; then
            kill -15 "$DPID" 2>/dev/null || true
            sleep 2
        fi
    fi
    rm -f "$SUPERVISOR_PID_FILE" "$DOCKERD_PID_FILE"
    echo "STOPPED" > "$STATUS_FILE"
    exit 0
}

trap cleanup_and_exit INT TERM

while [ ! -f "$STOP_FLAG" ]; do
    rotate_log_if_needed "$DOCKERD_LOG" "$DOCKERD_MAX_BYTES"
    rotate_log_if_needed "$SUPERVISOR_LOG" "$SUPERVISOR_MAX_BYTES"

    START_TIME=$(date +%s)
    "$BB" chroot "$ROOT" /usr/bin/env -i \
        PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
        /usr/sbin/dockerd \
            --exec-opt native.cgroupdriver=cgroupfs \
            --storage-driver=vfs \
            --data-root=/var/lib/docker \
            --exec-root=/run/docker \
            --pidfile=/run/docker.pid \
            --host=unix:///var/run/docker.sock \
            >> "$DOCKERD_LOG" 2>&1 &
    
    DOCKERD_CHILD_PID=$!
    echo "$DOCKERD_CHILD_PID" > "$DOCKERD_PID_FILE"
    echo "RUNNING" > "$STATUS_FILE"

    set +e
    wait "$DOCKERD_CHILD_PID"
    EXIT_CODE=$?
    set -e

    END_TIME=$(date +%s)
    RUN_DURATION=$((END_TIME - START_TIME))

    if [ -f "$STOP_FLAG" ]; then
        break
    fi

    if [ "$RUN_DURATION" -ge 300 ]; then
        CONSECUTIVE_CRASHES=0
        BACKOFF=5
    else
        CONSECUTIVE_CRASHES=$((CONSECUTIVE_CRASHES + 1))
        echo "DEGRADED" > "$STATUS_FILE"
    fi

    if [ "$CONSECUTIVE_CRASHES" -ge "$MAX_CRASHES" ]; then
        echo "FAILED" > "$STATUS_FILE"
        while [ ! -f "$STOP_FLAG" ]; do
            sleep 10
        done
        break
    fi

    sleep "$BACKOFF"
    BACKOFF=$((BACKOFF * 2))
    if [ "$BACKOFF" -gt "$MAX_BACKOFF" ]; then
        BACKOFF="$MAX_BACKOFF"
    fi
done

rm -f "$SUPERVISOR_PID_FILE" "$DOCKERD_PID_FILE"
echo "STOPPED" > "$STATUS_FILE"
exit 0
