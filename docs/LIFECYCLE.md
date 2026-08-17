# REUNION FUND — LIFECYCLE & LONG-TERM RECONSTRUCTION GUIDE

## 1. Disposable Workload Philosophy

Reunion Fund is designed as a **disposable, single-purpose application workload**:
1. **2026 Reunion Campaign:** Deploy to host container runtime, accept contributions, record expenses, run daily reconciliation, upload receipts, settle the remaining fund, and export final financial records.
2. **Post-Reunion Archival:** Once marked `ĐÃ QUYẾT TOÁN` (settled) and the remaining balance is manually transferred to the common MoMo fund, generate final public & treasurer XLSX/CSV archives and take a verified SQLite snapshot.
3. **Decommissioning:** Remove container, images, runtime secrets, and ephemeral files from the host without impacting any other running host services.
4. **Future Campaigns (e.g. 15-Year / 20-Year Reunion):** Re-instantiate a fresh, clean application instance from the version-controlled repository using a new database.

---

## 2. Archival Deliverables at Event Close

Upon event completion, the following artifacts are preserved:
- **Verified SQLite Snapshot:** `reunion_final.db` (clean WAL-checkpointed SQLite file).
- **Receipts & Invoices Archive:** `uploads_final.tar.gz`.
- **Public & Treasurer XLSX/CSV Ledgers:** `bao_cao_thu_chi_final.xlsx`.
- **SHA256 Checksum Manifest:** `SHA256SUMS`.
- **Git Release Tag:** `v1.0.0` on GitHub repository.

---

## 3. How to Reconstruct the Application Years Later

To reproduce or inspect the system in the future:

### Method A: From Git Repository & Lockfile
1. Clone the repository at the release tag:
   ```bash
   git clone https://github.com/your-org/reunion-fund.git
   cd reunion-fund
   git checkout tags/v1.0.0
   ```
2. Install exact dependencies using lockfile:
   ```bash
   npm ci
   ```
3. Run tests or build:
   ```bash
   npm run test
   npm run build
   ```
4. Start locally with historical data:
   ```bash
   DATABASE_PATH=./reunion_final.db STORAGE_PATH=./uploads_final npm start
   ```

### Method B: From OCI / Docker Container Image
If an ARM64/AMD64 Docker image was exported:
```bash
docker load -i reunion-fund-v1.0.0.tar.gz
docker run -p 3000:3000 -v /path/to/archive/data:/app/data reunion-fund:v1.0.0
```

### Method C: Launching a New Reunion Campaign
To start a brand new reunion campaign for a future year:
1. Deploy a clean container using `ops/deploy.sh prod v1.0.0`.
2. The application automatically initializes a clean SQLite database via `001_initial_schema.sql`.
3. Import the updated class roster CSV/XLSX.
4. Connect the designated treasurer's banking details.

---

## 4. Single-Writer & Multi-Workload Isolation Invariants

When hosted on an existing shared server (such as Samsung Galaxy A23):
- The application runtime MUST remain strictly inside its own container (`reunion-fund-stage` / `reunion-fund-prod`).
- No dependencies are installed globally on the host or in the Debian chroot.
- Host DNS writer (`a23-cloudflare-ddns`) and system monitoring (`server-monitor`) are strictly isolated and never modified during deploy or decommission.
