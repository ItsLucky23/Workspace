---
name: login-only-ops-signal-append
title: Login-only control-ops (create-workspace / accept-invite) were silently dropped by the workspace-scoped signal append (workspaceId '' is an invalid ObjectId)
severity: high
area: server/orchestrator
date: 2026-07-01
tags: [conductor, control-api, onboarding, prisma, objectid]
relates: [workspaces-api-framework-gotchas]
---

# 0004 — the workspace-scoped signal append silently dropped login-only ops

> Found while wiring the onboarding `create-workspace` op: the op "succeeded"
> (200 + `accepted: true`) but no workspace was ever created. A code-direct
> integration test (`tests/integration/createWorkspace.test.mts`) surfaced it;
> the live-server e2e masked it as a flaky "0 tickets".

## What happened

`enqueueControlAction` (the Conductor entry point) appends an append-only
`WorkspaceSignal` audit row BEFORE running the op, both inside the serial chain:

```ts
await prisma.workspaceSignal.create({ data: { workspaceId: action.workspaceId, ... } });
await executeAction(action);
```

For a **login-only op** — `create-workspace` / `accept-invite` — there is no
workspace yet, so the client sends `workspaceId: ''`. `WorkspaceSignal.workspaceId`
is `String @db.ObjectId`, so `create({ workspaceId: '' })` throws
`Malformed ObjectID … got: "", length 0`. That throw was swallowed by the chain's
`.catch(...)` (which only `console.error`s), so `executeAction` never ran and the
op was silently dropped — the HTTP ack still said success (the ack is returned
before the async chain runs).

## Root cause

A workspace-scoped audit-log write was placed on the path of ops that have **no
workspace**. `@db.ObjectId` string fields reject `''` (and any non-24-hex string) at
the driver level, and the serial chain's fire-and-forget `.catch` turns that into a
silent no-op rather than a surfaced error.

## How to avoid

- **Login-only ops must not append a per-workspace signal.** `enqueueControlAction`
  now branches on `!action.workspaceId`: it runs the op on the chain with no signal
  and no tenant scope (these ops use the plain client). See `server/orchestrator/conductor.ts`.
- **Never pass `''` to an `@db.ObjectId` field** — it is not "empty/null", it is a
  malformed id and throws. Guard or omit.
- **A fire-and-forget `.catch` that only logs will hide dropped writes.** When an op
  "succeeds" but nothing persists, suspect a swallowed error on the async chain — and
  validate write-ops with a **code-direct integration test**, not only the live-server
  e2e (a hot-reloaded dev server can mask or fake the result).
