---
id: 0043
title: User-app DB support + gated migrations
status: accepted
date: 2026-07-06
tags: [database, migrations, explorer, gated-apply, expansion-d1]
supersedes: []
depends_on: [0037]
---

# User-app DB support + gated migrations

## Context

D1 gives a user's app a database surface: a read-only explorer + migration management. It ties to B1
environments (a migration targets an env's DB) and reuses the encrypted-secret path + the container/exec
primitive. Greenfield — no DB model/op existed.

## Decision

1. **`DbConnection` model** (per project, optionally per service/env; `kind` postgres/mysql/mongo; `urlEnc`
   ENCRYPTED via `secretBox`, never client-visible). The connection store the explorer + migrations resolve.

2. **Read-only explorer first (`introspectDb` / `db-introspect` op).** Lists a connection's
   tables/collections via a READ-ONLY listing query in a throwaway DB-client container (the base image has
   psql/mysql/mongosh). Browse-before-edit — the safest first cut.

3. **`Migration` model + gated apply (`db-migrate-apply` op).** A migration (`sql` + optional `rollbackSql`)
   is authored by the coding agent (schema-diff → SQL) and applied PER ENVIRONMENT as a control-op. Gates:
   **dev applies freely; prod requires an explicit approval AND a recorded rollback plan** (B-23 + the "prod
   apply = approval + backup/rollback" decision). Applied via the connection's DB client in a throwaway
   container; `status` tracks pending→applied/failed. The Conductor is the only applier (never client-side).

## Rejected alternatives

- **A live DB pool in the orchestrator.** Rejected — a throwaway per-apply DB-client container reuses the
  existing container/egress/tenancy substrate and holds no long-lived connections; the URL is decrypted
  only for the single exec.
- **Auto-apply migrations on merge.** Rejected for prod — a schema change is exactly the irreversible-ish
  action B-23 gates; prod needs a human approval + a rollback plan. dev auto is acceptable (a follow-up
  trigger, like deploy-on-merge).
- **A full editable explorer now.** Deferred — read-only introspection ships first (browse before edit);
  a write/query surface is a later, more carefully-gated cut.

## Consequences

- Schema grows (`DbConnection`, `Migration`). `db-connect`/`db-migrate-create`/`db-migrate-apply`/
  `db-introspect` control-ops (rbac: connect/apply = settings, create = editPipeline, introspect = workTickets).
- Reuses the encrypted-secret path + the `docker run` client-container pattern; ties to B1's env kinds.
- Follow-ups: the explorer UI panel (browse tables + a gated query runner), agent-authored migration
  generation from a schema-diff, a dev auto-apply-on-merge trigger, per-row data browsing.
