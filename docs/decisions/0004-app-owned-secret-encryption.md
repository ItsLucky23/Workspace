---
title: App-owned AES-256-GCM encryption for per-workspace secrets
status: accepted
date: 2026-07-01
tags: [security, secrets, workspaces, gitlab]
---

# 0004 — App-owned encryption for per-workspace secrets at rest

## Context

Workspaces stores credentials it must replay to third parties — first the per-workspace
GitLab token (`Workspace.gitlabTokenEnc`), later others. These cannot be one-way hashed
(they must be decrypted to use) and must not sit in the DB as plaintext (B-07). The
`@luckystack/secret-manager` resolves *deploy-time* env pointers at boot; it is not a
per-row, per-tenant, runtime write-path for user-entered credentials, so it doesn't fit.

## Decision

Encrypt these secrets in the app with **AES-256-GCM**, in `server/crypto/secretBox.ts`
(`encryptSecret`/`decryptSecret`), keyed by a single app key from `WORKSPACES_ENC_KEY`
(any string, SHA-256-hashed to 32 bytes; resolved at boot like any env, so it can be a
secret-manager pointer). Stored format is self-describing: `v1:<iv>:<tag>:<ct>` (base64).
The **Conductor** is the only writer (B-23) — `gitlab-settings` encrypts on write; a
Fase-2 GitLab client decrypts on use.

When `WORKSPACES_ENC_KEY` is unset, secrets are stored `plain:<b64>` with a loud one-time
boot warning. This keeps local dev frictionless while making the unencrypted state
obvious + greppable; `decryptSecret` reads both forms, so setting the key later is
non-breaking for new writes.

## Rejected alternatives

- **Plaintext in the DB** — the status quo being replaced; unacceptable for real tokens.
- **Store via the secret-manager** — it's a boot-time env resolver, not a per-tenant
  runtime KV write-path; wrong tool, and it would leak per-workspace secrets into a
  deploy-wide namespace.
- **KMS / envelope encryption** — correct at scale, but V1 is single-host, single-tenant-
  operator; a KMS dependency is out of scope (revisit if multi-operator hosting lands).
- **Per-workspace keys** — more isolation, but key management explodes; one app key with
  GCM integrity is sufficient for V1's threat model (DB dump ≠ credential disclosure).

## Consequences

- A new required-for-production env: `WORKSPACES_ENC_KEY` (documented in
  `.env.local_template`). Unset ⇒ dev-only plaintext with a warning.
- Rotating the key invalidates existing `v1:` values (they fail the auth-tag → decrypt
  returns null); a rotation needs a re-encrypt migration. Acceptable for V1.
- `gitlabTokenEnc` is written encrypted now, though it isn't consumed until the Fase-2
  GitLab engine — deliberate: encrypt-at-write so no plaintext window ever exists.
