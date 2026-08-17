# ADR-005: Disposable Workload Architecture and Teardown Safeguards

## Status
Accepted

## Context
Reunion Fund is an episodic, disposable workload hosted temporarily on the Samsung A23 server alongside critical infrastructure (`a23-cloudflare-ddns` and `server-monitor`). Once the 10-year reunion event concludes and is settled, the workload will be archived and removed.

## Decision
1. **Zero Host Pollution:** No runtime packages or dependencies are installed directly on Termux or in the Debian chroot.
2. **Container Isolation:** The application runs in a standalone container with isolated data and uploads mounts.
3. **Decommission Safety:** `ops/decommission.sh` requires explicit typed confirmation (`CONFIRM_DECOMMISSION_REUNION_FUND`) before removing containers, images, or data. Existing DNS containers are immune to teardown scripts.
4. **Long-Term Reconstructibility:** The application can be reconstructed years later from the version-controlled repository, release tag, lockfiles, and verified SQLite backup snapshot.
