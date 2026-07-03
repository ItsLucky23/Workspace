---
id: 0031
title: Multi-instance Deel B — coordination verified under concurrency + live 2-instance
status: accepted
date: 2026-07-03
tags: [workspaces, multi-instance, cluster, leader-election, verification]
supersedes: []
---

# 0031 — Multi-instance Deel B (verification)

## Context

Goal-item #15. Deel A (ADR 0015, `server/orchestrator/cluster.ts`) built the coordination primitives
— leader election (`isLeader`), per-workspace lease (`withWorkspaceLease`), cross-instance dedup
(`claimActionOnce`) — but they were never verified under real concurrency or with more than one
instance actually running. Deel B is that verification.

## Decision

Verify the coordination two ways, because the primitives are Redis atomics: N separate OS processes
use the same Redis the same way a single process using the primitives concurrently does.

- **Headless concurrency proof** (`tests/integration/multiInstance.test.mts`, 7/7): against the real
  Redis — (1) `withWorkspaceLease` SERIALIZES 5 concurrent same-workspace critical sections (observed
  max concurrency = 1); (2) two DIFFERENT workspaces run concurrently (max = 2 → the lock is
  per-workspace, not global); (3) `claimActionOnce` — exactly ONE of 8 concurrent same-key claims
  wins, three distinct keys all win; (4) the leader lease is exclusive — a second `acquireLease` while
  held returns null, and after release another instance takes over (failover).
- **Live 2-instance proof**: booted a SECOND backend (`:81`) against the same Redis/Mongo while `:80`
  ran. Both served `/healthz` 200; the `/metrics` `workspaces_is_leader` gauge (#5) read **1 on :80
  and 0 on :81**, and only `:80` logged "acquired leadership" — exactly one leader across two real
  processes, the follower idle on the background loops. Confirms the primitives hold across process
  boundaries, not just in-process.

## Rejected alternatives

- **Only unit-test the primitives.** Wouldn't prove behaviour across real process boundaries; the live
  2-instance boot closes that gap.
- **Automate an OS-process failover in CI.** The dev supervisor auto-respawns a killed backend, which
  makes a kill-the-leader test flaky; failover is instead proven deterministically at the primitive
  level (test case 4) + the live single-leader result. A real deploy's failover is the same lease TTL.

## Consequences

- The engine is verified SAFE to run as N instances: one leader runs the background loops + writes,
  per-workspace writes serialize across instances, and duplicate actions are deduped cross-instance.
- Verified: `multiInstance.test.mts` 7/7, full suite 33/33; live `:80`+`:81` with `workspaces_is_leader`
  = 1/0 respectively.
- Still operator-gated for a real deploy: running N instances in production also needs the
  `WS_MULTI_INSTANCE` realtime fan-out (pub/sub) enabled (ADR 0015) and a router in front — the
  coordination core is now proven; the deploy wiring is a hosting step (#7).
