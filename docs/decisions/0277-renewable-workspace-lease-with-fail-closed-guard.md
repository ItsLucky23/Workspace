---
name: renewable-workspace-lease-with-fail-closed-guard
title: Renewable workspace lease with fail-closed Conductor guard, without claiming database fencing
status: accepted
date: 2026-07-18
deciders: [ItsLucky23]
tags: [multi-instance, conductor, redis, lease, fencing, correctness]
supersedes: [0015]
relates: [0031]
---

## Context

ADR 0015 put the complete workspace-scoped Conductor critical section behind a fixed 15-second Redis
lease, but did not renew it. If an action exceeded that TTL, a second instance could acquire the lease
while the original callback kept running. The original caller could then complete successfully without
observing that ownership had expired. Owner-checked release already prevented the stale owner from
deleting its successor's lease, but it did not prevent or surface the overlapping work.

ADR 0031 verified only short critical sections (60–80 ms) and leader exclusivity. Its broad conclusion
that the engine was proven safe for N instances did not cover a greater-than-TTL action, lease loss
mid-action, or cross-store fencing. Those claims must now be read through the limitations below.

## Decision

Workspace-scoped Conductor actions use a renewable owner-checked Redis lease and an explicit fail-closed
lease guard; this strengthens mutual exclusion for normal asynchronous actions but is not database fencing.

1. `withWorkspaceLease` renews sequentially every 5 seconds for a 15-second TTL. The next renewal is not
   scheduled until the previous owner-checked renewal settles. Production timings stay fixed by default;
   the full timing set is injectable so real-Redis expiry tests run in hundreds of milliseconds.
2. The lease callback receives `WorkspaceLeaseGuard { assertHeld, signal }`. A failed/false renewal, a
   renewal that does not settle before the locally-known expiry, or a non-owner release marks the lease
   lost, aborts the signal, and rejects the caller with `WorkspaceLeaseLostError`.
3. The Conductor calls `assertHeld()` immediately before allocating `seq`, before appending the durable
   `WorkspaceSignal`, before executing the authoritative action, and before reporting successful
   completion. An observed loss therefore never becomes a successful control ACK.
4. Release remains owner-checked. A stale holder cannot delete a successor's lease. The recovered
   per-workspace promise-chain remains the queue tail, so a failed action cannot poison later actions.
5. Leader election, local execution, cross-instance dedup, and the existing control surface are unchanged.
   This does not introduce leader forwarding, a new product verb, or another authoritative writer.

This is deliberately an honest guard rather than a claim of complete fencing. Redis lease ownership is
not atomically coupled to MongoDB writes. A long event-loop stall can prevent both renewal and loss
observation until after the TTL, and an already-issued Prisma/provider operation cannot generally be
cancelled by `AbortSignal`. Lease loss may therefore be detected only after one DB write has landed; the
final guard then fails the ACK, but it cannot roll that write back. Strict fencing would require a
monotonic fencing token enforced by every authoritative datastore write (or one datastore/transaction
that atomically owns both lock and mutation), which this architecture does not currently have.

## Rejected alternatives

- **Only increase the fixed TTL.** Rejected because every finite TTL can still be exceeded, while a very
  long TTL slows crash recovery.
- **Renew with `setInterval`.** Rejected because a slow Redis call can overlap later renewals and obscure
  lease state. The awaited loop permits exactly one renewal attempt at a time.
- **Treat an eventual renew/release ambiguity as success.** Rejected because caller-visible failure is
  safer than acknowledging a write after ownership is uncertain.
- **Route all writes to the elected leader.** Rejected for the same reason as ADR 0015: it adds a
  forwarding protocol and changes the local await/broadcast model; this task does not add that product
  architecture.
- **Claim that guard checkpoints are full database fencing.** Rejected because Redis and MongoDB are
  separate stores and current mutations do not carry an enforced fencing token.

## Consequences

- Ordinary actions can exceed the original 15-second TTL while continuing to exclude a contender.
- Observed renewal loss is visible through `AbortSignal`/`assertHeld`, fails the caller, preserves the
  successor's lease, and leaves the workspace queue usable.
- A real-Redis two-contender test uses a 120 ms TTL and proves non-overlap across a 320 ms action; lease
  loss and owner-safe release are also exercised against real Redis. Control-ACK tests inject loss at all
  four Conductor boundaries and prove caller failure plus queue recovery.
- Residual risk remains during event-loop stalls and inside an in-flight non-abortable/cross-store DB
  write. Do not describe this mechanism as strict fencing or as proof that concurrent DB effects are
  impossible under every process-pause/network-failure schedule.
