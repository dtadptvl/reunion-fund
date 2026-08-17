# ADR-004: SePay Test Mode Limits and Sandbox Quota

## Status
Accepted

## Context
During preflight research and testing preparation, we evaluated the limits and quota of the SePay Test Mode / Sandbox environment.

## Decision
1. **Simulation Quota:** Official SePay documentation specifies a limit of **500 simulated transactions per day** in Test Mode.
2. **Reset Schedule:** The simulation quota resets daily at **00:00 Vietnam Time (Asia/Ho_Chi_Minh / UTC+7)**.
3. **Sandbox Base URL:** `https://userapi-sandbox.sepay.vn/v2`.
4. **Integration Testing Strategy:** Automated tests will run offline against mock fixtures and sanitized payloads to avoid consuming the 500/day simulation quota during CI and local development. Staging acceptance tests on the A23 server will use the SePay transaction simulator within the 500/day allocation.
