# ADR-003: VietQR 25-Character NAPAS Standard Formatting

## Status
Accepted

## Context
NAPAS standard for VietQR payment transfer content (`addInfo`) imposes a strict maximum of 25 characters without accents or special characters.

## Decision
- Transfer content pattern: `<BANK_DISPLAY_NAME> DONGQUY <CODE>`.
- Truncation priority preserves:
  1. Unique 5-char payment code (e.g. `K8P4X`)
  2. `DONGQUY` token
  3. Short recognizable name (e.g. `MINH PHUONG` or `TRI THANG`)
- Canonical roster name is never truncated in the database; only the generated `bank_display_name` is shortened for banking compatibility.
