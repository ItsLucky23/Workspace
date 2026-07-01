---
name: fase1-inprocess-conductor
title: In Fase 1 the control-API enqueues to an in-process serial Conductor; the Redis signal-log + lease land in Fase 2
status: accepted
date: 2026-07-01
deciders: [ItsLucky23]
tags: [workspaces, control-api, conductor, fase-1, orchestrator]
relates: [workspaces-v1-schema-shape]
---

## Context

`CONTROL_API.md` (§3/§7) specifies that every user-initiated write goes: `_api`
route → `preApiExecute` RBAC → **append a `WorkspaceSignal` to a Redis-backed serial
signal-log** → the **single-instance Conductor** (running in the separate orchestrator
process under `lease:orchestrator`) drains it and writes. That async signal-log +
lease exists to keep the write path safe across the **web-app ↔ orchestrator process
split** (the web-app scales horizontally; the orchestrator is single-instance).

Fase 1 (basisplatform, no AI) ships the non-AI control-API ops (workspace/member/
RBAC/settings/board CRUD) BEFORE the orchestrator process exists — that process, its
lease, the PTY/container engine, and the Redis drain loop are all Fase 2 (Lane A,
spike-gated). If Fase 1 handlers enqueued to a Redis signal-log, nothing would drain
it (no Conductor process yet) and nothing would persist.

## Decision

**In Fase 1 the control-API handler enqueues to an IN-PROCESS serial Conductor
executor** (a single-writer promise-chain/mutex inside the one running web-app/dev
process), which executes each op via `tenantDb` under `runInTenant(workspaceId)`. The
**Redis-backed signal-log + `lease:orchestrator` + the out-of-process drain loop land
in Fase 2** when the orchestrator process actually splits out (Lane A, A3). The
`ControlRequest`/`ControlAck` contract and the enqueue→Conductor→`ws-ai:*` shape are
unchanged — only the *transport* of the enqueue (in-memory queue vs Redis list) and
the *host* of the drain (same process vs leased orchestrator) differ between phases.

## Rejected alternatives

- **Build the full Redis signal-log + lease + out-of-process Conductor now** —
  rejected for Fase 1: there is no orchestrator process yet to hold the lease or drain
  the log (that is spike-gated Fase-2 work), and the multi-process safety it buys is
  moot while everything runs in one process. It would be untestable scaffolding built
  ahead of its lane (Rule 7b).
- **Let the `_api` handler write authoritative state directly (skip the Conductor)** —
  rejected: it breaks the load-bearing single-writer invariant (B-23, `01 §3.3`) and
  would have to be un-picked when the AI orchestrator arrives and starts competing to
  write the same board/status rows. The in-process Conductor preserves "only the
  Conductor writes" from day one — the seam is real, only its host changes.

## Consequences

- The single-writer invariant (B-23) holds in both phases: one process → one writer,
  trivially. The Fase-2 migration is "swap the in-process queue for the Redis list +
  move the drain into the leased orchestrator", not a rewrite of the handlers or the
  contract.
- `WorkspaceSignal` rows are still written (the append-only audit trail, B-O6) even in
  Fase 1 — the in-process Conductor consumes them serially; the durable log survives a
  restart, matching the Fase-2 shape.
- A monotonic per-workspace signal `seq` (Redis `INCR`) is allocated at enqueue so the
  client's optimistic-then-merge-on-`seq` reconciliation (CONTROL_API §6.3) works
  identically in both phases.
- Fase 1 may also collapse the "one `_api` route per op" (CONTROL_API §3) into a single
  dispatching `control_v1` route keyed by `op` — a boilerplate reduction; splitting
  per-op (for per-route rate-limits + the auto-sweep) is a later, mechanical change.
- This is recorded so a future session does NOT "discover" the missing Redis signal-log
  as a bug and prematurely build the Fase-2 orchestrator to satisfy it.
