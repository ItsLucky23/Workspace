---
title: Public API via scoped Personal Access Tokens over the control-API (X3)
status: accepted
date: 2026-07-07
tags: [api, auth, extensibility, security, freedom-program]
---

## Context

FREEDOM_PROGRAM item **X3**. There was no way to drive a workspace from OUTSIDE the app — no token-gated API.
The hard constraint: an external caller must respect the SAME single-writer + RBAC invariants as the in-app
path (never a direct writer), and tokens must be scoped + revocable + never stored in the clear.

## Decision

- A `PersonalAccessToken` model storing only the **SHA-256 hash** (raw shown once at issue) + a display prefix
  + `scopes` + a `revoked` flag. `generateToken`/`hashToken`/`resolvePat` are the token layer;
  `driveViaPat(token, op, payload)` authenticates → checks the op's required scope → enqueues on the
  **single-writer Conductor** (same RBAC as the app — the PAT only authenticates + scopes, never writes
  directly). Only an allow-listed set of ops is exposed (`quick-add` = tickets:write, `content-create` =
  content:write).
- Transport: a `POST /api/public/v1/op` custom route (origin-exempt, `Authorization: Bearer wsk_…` + a JSON
  `{ op, payload }`), + `issuePat`/`revokePat` membership-gated `_api` routes.

## Rejected alternatives

- **Store the raw token / a reversible cipher.** A hash means a DB leak can't replay tokens; the raw is the
  user's responsibility (shown once), matching every well-behaved PAT system.
- **A parallel REST writer bypassing the Conductor.** That would break single-writer + B-23. The PAT path goes
  through `enqueueControlAction` exactly like the UI — RBAC + the single-writer lock still apply.
- **Expose every control-op.** The public surface is an explicit allow-list (`OP_SCOPE`); an unlisted op is
  400, so the blast radius is deliberately small + grows only by conscious addition.

## Consequences

- A scoped, revocable PAT can drive create-ops externally, verified end-to-end (`personalAccessToken` 13/13: a
  scoped PAT creates a ticket; insufficient scope → 403; unlisted op → 400; revoked → 401; unknown → null). The
  scope catalog + a token-management UI are follow-ups on top of this tested auth core.
