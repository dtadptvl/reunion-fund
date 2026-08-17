# ADR-001: SQLite with WAL Mode as Primary Database

## Status
Accepted

## Context
The Reunion Fund application runs on resource-constrained hardware (Samsung Galaxy A23 with 4GB RAM) as an isolated container workload. It requires minimal RAM footprint, zero external network dependency for storage, and high transactional reliability.

## Decision
- Use embedded SQLite via `better-sqlite3`.
- Configure `journal_mode = WAL` (Write-Ahead Logging) to allow concurrent readers without blocking writes.
- Configure `busy_timeout = 5000` and `foreign_keys = ON`.
- Run database migrations on startup using versioned `.sql` files.
- Persistent database file stored on host volume outside container.
