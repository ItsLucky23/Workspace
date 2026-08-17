---
name: totp-ciphertext-carries-a-key-id-and-legacy-keyring
title: TOTP ciphertext carries a key id and decrypt-only legacy keyring
status: accepted
date: 2026-07-21
deciders: [mathijs]
tags: [auth, 2fa, totp, encryption, rotation]
supersedes: []
relates: [0024, 0026]
---

## Context

TOTP secrets used one `TOTP_ENCRYPTION_KEY` and stored legacy
`gcm:<iv>:<tag>:<ciphertext>` values without a key identifier. Replacing the env
key immediately made every existing enrollment undecryptable. Keeping the key
immutable conflicts with normal secret-rotation policy, while bulk migration
requires decrypting every user row in one risky operation.

## Decision

`TOTP_ENCRYPTION_KEY` remains the primary write key. New ciphertext is
`enc:v2:<key-id>:<iv>:<tag>:<ciphertext>`, where the id is a domain-separated,
truncated SHA-256 fingerprint and reveals no key material.
`TOTP_ENCRYPTION_LEGACY_KEYS` is a JSON array of decrypt-only previous keys.
Versioned rows select by id; pre-v2 `gcm:` rows try the configured ring; plaintext
rows remain readable. After a successful TOTP proof, plaintext/legacy/old-key
rows are best-effort rewritten under the current primary. Failed migration never
turns a valid proof into a login failure.

## Rejected alternatives

- **Treat the original key as immutable.** Operationally simple, but one normal
  rotation locks out every enrolled user.
- **Try only primary + one previous env var.** Two overlapping or emergency
  rotations require more than one legacy key and lead back to forced lockouts.
- **Store the raw key name supplied by an operator.** Names drift and can expose
  deployment details; a deterministic non-secret fingerprint is self-contained.
- **Bulk rewrite every user before rotating.** It creates a large privileged
  migration and all-or-nothing cutover. Proof-gated lazy migration spreads risk
  and naturally touches active users first.

## Consequences

- Rotation procedure is: deploy new primary + old key in the legacy JSON array,
  observe migration coverage, then remove old keys.
- Dormant users still need their legacy key until migrated or explicitly reset.
- Malformed legacy JSON is logged and ignored fail-closed; missing key ids cannot
  decrypt.
- User adapters must allow updating only `totpSecret` for lazy migration, which
  the existing partial-update contract already supports.
