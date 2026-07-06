---
id: 0074
title: Secret encryption is fail-closed — WORKSPACES_ENC_KEY is mandatory
status: accepted
date: 2026-07-06
tags: [security, secrets, hardening, depth-program]
supersedes: []
depends_on: [0072, 0004]
---

# H2 — hard-force `WORKSPACES_ENC_KEY` (no more fail-OPEN plaintext)

## Context

`GAP_ANALYSIS.md` cross-cutting #2: `secretBox` silently fell back to storing
`plain:<base64>` (UNENCRYPTED) when `WORKSPACES_ENC_KEY` was unset, with only a one-time
console warning. A `plain:` credential in production is unacceptable — the per-workspace
GitLab/GitHub token, DB-connection URLs, and the editor profile blob would land at rest as
recoverable plaintext.

## Decision

Make at-rest encryption **fail-closed**:

- `encryptSecret` and `encryptBuffer` now **THROW** a clear error when no key is configured —
  they never emit a `plain:`/`0x00` plaintext envelope again.
- New `assertEncryptionConfigured()` is called at **boot** (in `server.ts`, right after the
  secret-manager resolves) so the server refuses to start into a state where a stored secret
  would be plaintext — a loud fatal, not a lazy surprise.
- `encryptionConfigured()` is exported for precondition checks.
- **Migration path preserved:** `decryptSecret`/`decryptBuffer` STILL read any LEGACY
  `plain:`/`0x00` values written before this change, so pre-hardening dev data stays readable
  (re-save such secrets to encrypt them at rest). This closes the fail-OPEN *write* — the actual
  gap — without silently losing existing data.
- **Tests:** `tests/unit/secretBox.test.mts` (14/14) asserts round-trip with a key, tamper→null,
  encrypt/assert THROW without a key, never-plain:, and legacy decrypt. The test harness
  (`tests/_helpers.mts`) sets a deterministic `WORKSPACES_ENC_KEY` after secret resolution so all
  integration tests exercise the real fail-closed path (forgeConnect 13/13, dbMigrate 8/8 verified).

## Rejected alternatives

- **Keep the `plain:` fallback but warn louder.** Rejected — a warning is not a guarantee; the
  gap is that plaintext is *written at all*.
- **Also reject legacy `plain:` on decrypt.** Rejected for now — it would lose existing dev
  secrets with no security gain (writing plaintext is already blocked); a DB-write attacker who
  could inject `plain:` already has full compromise. Documented as a migration nuance.

## Consequences

- **Developer action (load-bearing):** `WORKSPACES_ENC_KEY` MUST be set (a secret-manager pointer
  or a literal) or the server will not boot — this is the intended fail-closed posture. Documented
  in the KEY_SETUP_GUIDE (D1) and `.env.local_template`.
- Any code path that stores a secret without a key now fails loudly instead of silently degrading.
