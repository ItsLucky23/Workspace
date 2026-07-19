---
id: 0020
title: CapacityManager — atomic hard-cap admission queue + urgent force-through
status: superseded
date: 2026-07-03
tags: [workspaces, orchestrator, capacity, concurrency, multi-instance, redis]
supersedes: []
---

# 0020 — CapacityManager: atomic admission control

## Context

Goal-item #12. The old CapacityManager (ADR 0014) was a **soft** cap: `provisionContainers`
did `agentSession.count({ status: 'busy' }) >= MAX` and deferred above it. Between the count
and `runStage`, N concurrent stage-activations all read the same "3 busy" and each start a 4th
turn — a classic TOCTOU that a burst races straight past. Deferred tickets also only re-ran on
a manual re-enter (no queue drain), so a backlog stalled until a human nudged it. And the user
wants **hotfix/security tickets to force past the cap** (still needing approval to merge, #13's
`priority=urgent` tier).

## Decision

A real admission-control module, `server/orchestrator/capacity.ts`, backed entirely by shared
Redis so it is **multi-instance-safe** (ADR 0015) — no per-instance in-memory counters.

- **Atomic acquire** via a single Lua script on a ZSET (`capacity:active`, member = ticket key,
  score = acquire-time): evict stale members, then admit iff `force` OR `ZCARD < MAX`, adding
  the member in the same round-trip. N concurrent acquires can no longer all pass — the cap is
  hard.
- **Urgent force-through:** `priority === 'urgent'` passes `force = true` — always admitted, but
  still tracked in the active set so normal tickets see true occupancy (an urgent turn does
  consume a real slot for everyone else). Merge still needs approval (ADR 0018).
- **Deduped FIFO defer queue** (`capacity:queue` LIST + `capacity:queued` SET): a rejected turn
  is parked once (repeat re-entries don't stack). On **every slot release** the conductor drains
  the next parked turn and re-provisions it at its *current* stage — the backlog drains at the
  pace turns complete, no polling.
- **Crash-leak self-healing:** slots are ZSET members scored by acquire-time and evicted once
  older than `WS_TURN_MAX_MS` (default 30 min), so an instance that dies mid-turn can never
  permanently consume capacity. The #1 watchdog is the belt to this suspenders.
- **Fail-open:** if Redis is unreachable, acquire admits (logged) rather than freezing the whole
  engine — the DB-level per-workspace serialisation still bounds real concurrency.

The slot is held for the duration of `runStage` (acquired before, released in a `finally`), so a
`needs-input` turn that parks for a human releases its slot immediately (it isn't burning compute).

## Rejected alternatives

- **Keep the `agentSession.count()` soft cap.** The TOCTOU is the whole bug; a count-then-act
  can't be a hard cap without a lock.
- **A DB row-lock / transaction for admission.** Mongo has no easy cross-document atomic
  counter with a limit; Redis Lua is one atomic round-trip and is already the multi-instance
  coordination substrate (leases, dedup — ADR 0015).
- **A plain SET + `SCARD`/`SADD`.** Two commands aren't atomic; and a SET can't self-heal
  crash-leaked members. The scored ZSET gives both atomicity (in Lua) and time-based eviction.
- **Re-run deferred tickets by polling.** A drain-on-release queue is event-driven and exact;
  polling wastes cycles and adds latency.

## Consequences

- The cap is now truly hard; `WS_MAX_CONCURRENT_TURNS` is honoured under burst.
- Hotfix/security (`urgent`) tickets are never starved by a full queue.
- Deferred work drains automatically as turns finish.
- Verified: `capacity.test.mts` (16/16) — hard cap, urgent bypass, dedup FIFO, release frees
  capacity, staleness eviction; full suite 22/22, clean runtime boot. Backend-only (the defer
  banner UI already existed), so the integration test is the real-flow verification.
