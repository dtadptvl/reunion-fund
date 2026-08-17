# ADR-002: Deterministic Contributor Identity Rule (AI Forbidden)

## Status
Accepted

## Context
Financial attribution must be 100% reliable. Attributing financial contributions to the wrong person is catastrophic to class trust.

## Decision
1. **Deterministic Attribution Hierarchy:**
   - Case A: Matching by unique non-sequential 5-character payment code.
   - Case B: Conservative deterministic fallback matching exact canonical name + literal token `DONGQUY` with zero ambiguity.
   - Case C: Ambiguous or destroyed content is classified as `UNRESOLVED_INCOMING` and queued for manual treasurer assignment.
2. **Absolute Prohibition:** AI / LLMs (including Gemini) are strictly forbidden from attributing or guessing contributor identities.
