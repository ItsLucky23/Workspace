---
name: multi-instance-safety-deel-a
title: Multi-instance safety (Deel A) — leader-elected loops, a per-workspace cross-instance write-lease, and cross-instance dedup
status: superseded
date: 2026-07-03
deciders: [ItsLucky23]
tags: [multi-instance, conductor, redis, scale, engine]
supersedes: []
relates: [0013, 0014]
---

## Context

The engine's authoritative-write path (the Conductor) was built single-instance: a global in-process
promise chain (`chain`) serialised all writes, an in-process `Set` deduped re-sends, and the GitLab
poller + editor reaper ran on `setInterval` in every process. Running 2+ instances behind the router
would give: concurrent authoritative writes on the same workspace (races, double AI-turns on one
container), un-deduped re-sends across instances, an unboundedly growing dedup Set, and N× duplicated
background work. The user chose to do this RIGHT ONCE now — not because scale is here, but because the
single-instance assumption is baked into the engine core and is far cheaper to remove now than to
retrofit after more code depends on it. Scope = **Deel A: make the engine multi-instance-SAFE while
still running one instance** (spinning up N later is then config, "Deel B", not a rewrite).

Redis is already a hard dependency (session, `nextSignalSeq` via `redis.incr`, rate-limit), and the
framework already exposes lease primitives (`acquireLease`/`renewLease`/`releaseLease`, atomic
`SET NX PX`) and a socket Redis adapter — so this is wiring existing primitives, not greenfield.

## Decision

New module `server/orchestrator/cluster.ts` with three Redis-backed primitives, all ALWAYS ON
(uncontended cost on one instance is one `SET`/`DEL` per user-initiated action, so every path is
exercised — no "untested when you scale" cliff):

1. **Leader election** (`startLeaderElection`/`isLeader`) — one renewable lease; only the leader runs
   the background loops (GitLab poller, editor reaper now gate on `isLeader()`), so N instances don't
   duplicate them. A single instance is always the leader.
2. **Per-workspace mutual exclusion** (`withWorkspaceLease`) — the Conductor's global `chain` is
   replaced by (a) a per-workspace IN-PROCESS chain (`wsChains`, so unrelated workspaces run in
   parallel — no head-of-line blocking) and (b) inside it a per-workspace cross-instance Redis lease
   held while allocating the seq + appending the signal + running the write. No two instances ever
   perform a concurrent authoritative write on the same workspace.
3. **Cross-instance dedup** (`claimActionOnce`) — replaces the in-process `Set` (which also leaked);
   a TTL-bounded idempotency marker that survives whichever instance a re-send lands on.

`nextSignalSeq` already uses `redis.incr` (atomic across instances) → unchanged. Cross-instance
realtime fan-out (`attachSocketRedisAdapter`) is the ONE piece gated behind `WS_MULTI_INSTANCE=1`,
since its pub/sub overhead is only needed by a real N-instance deploy.

## Rejected alternatives

- **Leader-owned Conductor (only the leader writes; others forward via RPC-over-Redis).** Rejected:
  the forwarding + ack round-trip is complex and changes the await-and-broadcast latency model. The
  per-workspace lease keeps writes LOCAL to whichever instance served the request.
- **Keep the global in-process `chain` and add the lease on top.** Rejected: a write waiting on a
  cross-instance lease would block ALL local writes (head-of-line blocking). Per-workspace chains fix
  this at the correct (tenant) granularity.
- **Gate the whole mechanism behind a flag (off single-instance).** Rejected for the lease/dedup: an
  un-exercised path is the one that breaks when you finally scale. Only the realtime adapter (real
  overhead, zero single-instance value) is flag-gated.
- **Defer entirely (my earlier advice).** Reversed: correct for *operating* N instances, wrong for the
  *foundation*, which is a painful retrofit once more code assumes single-instance.

## Consequences

- The engine is now multi-instance-SAFE: verified by `scripts/spike/clusterSpike.mts` (dedup wins once;
  same-workspace serialised / no overlap; different workspaces parallel) + integration 14/14 (the new
  path runs against real Redis).
- Behavioural change: unrelated workspaces' authoritative writes now run in parallel within one
  instance (previously globally serialised). This is the correct granularity (per-tenant isolation).
- `withWorkspaceLease` throws on an 8s wait-timeout (fails a write rather than racing it); the critical
  section must stay quick — AI turns run OFF this path, so it stays sub-second.
- **Deel B (deferred, config-only):** run N instances behind the router + set `WS_MULTI_INSTANCE=1`.
  A transient Redis blip can briefly drop/re-elect leadership (TTL-bounded) — acceptable.
