---
title: H5 — fair (round-robin) capacity draining across workspaces
status: accepted
date: 2026-07-08
tags: [capacity, fairness, scheduler, multi-tenant, adoption]
---

## Context

The CapacityManager (#12, ADR 0019-sibling) parks turns that exceed the host-wide concurrency cap on a single FIFO
queue and drains one per slot-release. FIFO is unfair across tenants: a workspace that floods the queue with 20
tickets is served entirely before another workspace's single waiting ticket — one busy tenant starves the rest.
The audit flagged this as a multi-tenant fairness gap.

## Decision

- **Drain the LEAST-LOADED workspace first** (round-robin), FIFO within a workspace. On each slot-release,
  `drainCapacityQueue` reads current occupancy per workspace and `pickFairNext` selects the earliest-queued turn
  whose workspace holds the fewest active slots (strict-less-than on ties preserves FIFO).
- **Occupancy per workspace is derived from the active set**, made possible by TAGGING each active ZSET member as
  `<workspaceId>::<ticketKey>` (was the bare ticketKey). This keeps the existing TTL self-healing (the score is
  still acquire-time, so a crashed instance's slots still evict) — no drift-prone side counter.
- **`pickFairNext` is pure** (queue items + an in-flight map → the chosen item + index), unit-tested; the Redis
  read/LREM lives in `dequeueFairDeferred`.

## Rejected alternatives

- **Keep pure FIFO.** Rejected: the starvation is real once >1 workspace is active on one host.
- **A separate per-workspace counter hash (HINCRBY on acquire/release).** Rejected: it drifts on a crash (the
  decrement never runs) and would permanently skew fairness; the TTL'd active set self-heals.
- **Per-USER fairness.** Rejected for now: the deferred item carries `workspaceId`, not the triggering user;
  workspace-level fairness is the right granularity for a host-wide cap. Per-user is a later refinement (H2 already
  attributes spend per user).

## Consequences

- The active ZSET member format changed; any old-format members orphaned at deploy self-heal via TTL eviction
  (dev/runtime state, rebuilt by the engine).
- `acquireSlot`/`releaseSlot` now take `workspaceId`; the sole callers (conductor) already have it. `capacity.test`
  updated.
- Backed by `capacityFairness.test.mts` (least-loaded-first, absent-workspace=0, FIFO-on-tie, empty) + the existing
  `capacity.test.mts` (cap/urgent/dedupe/TTL) still green.
