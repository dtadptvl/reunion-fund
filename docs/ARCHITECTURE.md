# REUNION FUND — SYSTEM ARCHITECTURE & DESIGN SPECIFICATION

## 1. Overview
Reunion Fund is a transparent, high-efficiency web application built for Vietnamese class reunion fund management. It automates bank transaction ingestion, contribution attribution, and expense tracking via SePay Open Banking webhooks and daily reconciliation, with public transparency and treasurer management.

---

## 2. Technical Stack
- **Frontend:** React 18 + TypeScript + Vite + Vanilla CSS (BEM & HSL tokens).
- **Backend:** Node.js (LTS v20+) + TypeScript + Fastify.
- **Database:** SQLite 3 with Write-Ahead Logging (`WAL`), `busy_timeout = 5000`, `foreign_keys = ON`.
- **AI Service:** Google Gen AI SDK (`@google/genai`) using configurable `GEMINI_MODEL` for assistive expense classification only.
- **Packaging:** Lean multi-stage Docker container serving bundled static frontend and Fastify API.
- **Deployment Platform:** ARM64 Docker on Samsung Galaxy A23 (or any Linux/Docker host) behind Cloudflare Zero Trust Tunnel.

---

## 3. Core Architectural Principles & Invariants

### 3.1 Strict Contributor Identity Rule
- **Rule:** Contributor identity is determined **100% deterministically**.
- **Priority:**
  1. Unique payment code match (e.g. `K8P4X`).
  2. Safe deterministic exact name fallback (`<CANONICAL_NAME> DONGQUY`) ONLY if there is zero ambiguity.
  3. Otherwise: Unresolved incoming transaction queue (`UNRESOLVED_INCOMING`) for manual treasurer assignment.
- **Absolute Boundary:** AI/LLM is **NEVER** used to guess or match contributor identity.

### 3.2 VietQR Transfer Content Standard (25-Character Hard Limit)
- Under NAPAS / VietQR standard, payment descriptions (`addInfo`) have a strict **25-character limit** without accents or special characters.
- Transfer content pattern: `<NORMALIZED_NAME> DONGQUY <UNIQUE_CODE>`.
- Truncation priority:
  1. Unique 5-char random code (e.g. `K8P4X`).
  2. Literal token `DONGQUY`.
  3. Short recognizable name (e.g. `MINH PHUONG` or `TRI THANG`).

### 3.3 Expense Flow & Merchant QR Handling
- Treasurer transfers funds directly using banking app.
- Outgoing bank transaction is ingested via SePay webhook.
- Expense record is created automatically with raw immutable bank transaction details.
- Clean Vietnamese title & category are suggested by Gemini or learned rules, but may be overridden by the treasurer.

### 3.4 SePay Sandbox & Live Constraints
- **Staging / Test Mode:**
  - Base URL: `https://userapi-sandbox.sepay.vn/v2`
  - Quota: **500 simulated transactions per day** (resets at 00:00 Vietnam time / UTC+7).
  - Webhooks authenticated via HMAC-SHA256.
- **Production / Live:**
  - Base URL: `https://userapi.sepay.vn/v2`
  - Connected to treasurer's real bank account.
  - No staging transactions are migrated to production.

### 3.5 Language Policy
- All user-facing UI elements, messages, validation errors, and exports are in **Vietnamese (`vi-VN`)**.
- All currency formatting uses `₫` / `VND`.
- All code identifiers, database columns, commit messages, and internal documentation are in **English**.
