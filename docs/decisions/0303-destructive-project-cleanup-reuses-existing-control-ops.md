---
id: 0303
title: Destructive project cleanup reuses existing ControlOps and exact runtime identity
status: accepted
date: 2026-07-28
tags: [control-api, containers, git, forge, cleanup, security]
supersedes: []
---

# 0303 — destructive project cleanup reuses existing ControlOps and exact runtime identity

## Context

The ticket detail showed both `Stop AI` and `Teardown container`. The latter opened a type-confirm dialog but
executed nothing, while the former's existing `kill` ControlOp had drifted from the locked feature-24 contract:
it killed only the Claude process instead of tearing down the ticket container. Repository and forge setup also
supported connect/re-link but offered no way to remove stale encrypted credentials or a dead server-side clone.

The structured 7+6 agent verb surface is frozen. These are human control-plane writes, so they belong behind the
existing ControlOps and the Conductor—not in a new LLM verb or a direct browser/Prisma/Docker mutation.

## Decision

- Restore the existing Admin+ `kill` ControlOp to feature 24's destructive meaning: park the ticket, fence and stop
  an active session, then remove only the canonical container carrying the exact workspace/project/ticket labels
  and its deterministic named volume. Branch and event history remain; explicit Resume AI reprovisions later.
- Show one type-confirmed `Teardown container` action instead of a duplicate stop action plus a known no-op.
- Reuse `forge-connect` with `disconnect:true` to delete the exact project's `ForgeConnection`, including its
  encrypted credential. An explicit operator-only `clearExternalRefs:true` additionally clears dead ticket/MR URLs
  and closes affected open MRs after an external repository has been removed; sibling projects remain untouched.
- Reuse `link-repo` with `disconnect:true` to remove the exact project's host clone/worktree registrations and set
  `Project.gitUrl=null`. Refuse while project containers exist, and fail closed when Docker state is unavailable.
- Both disconnects remain `workspaceSettings`-gated and Conductor-executed. No structured-channel verb is added.

## Rejected alternatives

- **Add new agent verbs:** rejected because cleanup is a human ControlAPI concern and the structured surface is
  frozen/read-or-propose only.
- **Keep process-stop and teardown as two actions:** rejected because the locked `kill` contract already owns
  teardown; the duplicate created contradictory semantics and one deceptive no-op.
- **Delete repository/forge rows directly from the UI or an operator script:** rejected because it bypasses B-23,
  RBAC, tenant scope, durable ordering and realtime reconciliation.
- **Unlink a repository while containers still run:** rejected because they can still produce unpushed commits and
  would become detached from their authoritative project baseline.

## Consequences

- Destructive cleanup is honest, tenant-scoped and repeatable through existing public write paths.
- A killed ticket remains paused until an explicit human resume, preventing a race that recreates its container
  during teardown.
- Repository disconnect may first require teardown of the project's ticket containers.
- External repositories/accounts are never deleted by disconnect; only Workspaces-owned state and encrypted
  credentials are removed.
