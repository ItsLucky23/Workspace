---
name: fenced-agent-recovery-writer
title: Watchdog and reaper recovery use a short renewable capacity lease plus a durable fenced recovery writer
status: accepted
date: 2026-07-19
deciders: [ItsLucky23]
tags: [watchdog, recovery, capacity, fencing, conductor, cron, containers, multi-instance]
supersedes: [0020, 0022]
relates: [0120, 0168, 0277]
---

## Context

The stage writer now treats a CapacityManager `runToken` + monotonic `runFence` as the authority for
all stage results, but the watchdog and worker reaper still used the pre-fence model. They directly
updated `AgentSession`/`Ticket`, selected containers by reusable ticket name, and used the hard
`WS_TURN_MAX_MS` as both the maximum turn policy and capacity-owner TTL. A healthy 30-minute owner
could therefore block boot recovery for 30 minutes, while a stale watchdog scan could kill a newer
same-container successor. Reaper idle time was process-local and ticket keys were collapsed across
workspaces. Reminder writes also lacked compare-and-set/idempotency.

## Decision

1. Capacity ownership is a short renewable lease: `WS_CAPACITY_LEASE_MS` defaults to 30 seconds.
   `WS_TURN_MAX_MS` remains only the hard watchdog policy. Active scores, heartbeat expiry, renewal,
   stale eviction, and owner checks all use the capacity lease; renewal must run by half its TTL.
2. A server-only `agent-recovery-transition` InternalOp owns `prepare|complete|cancel`:
   - prepare exact-CASes workspace/project/ticket/stage/status/needs-input plus the exact worker
     session/container/runToken/runFence/startedAt;
   - one Redis Lua operation transfers the expected old reservation to a deterministic recovery owner
     at the next fence (or rejects live/stale authority), then the session becomes `recovering`;
   - only a hard-`WS_TURN_MAX_MS` stuck prepare or an explicit manual kill may revoke a live owner;
     boot/reaper prepares require an expired/missing owner;
   - complete requires the processed durable prepare intent and exact recovery owner; strict Redis
     release certainty comes first, then the exact old session becomes `stopped` in the same writer
     ordering, and only then may awaited reprovision run;
   - cancel likewise rolls back only its still-owned provisional recovery fence before restoring the
     prior session status. Redis unavailable/invalid results throw while the row remains `recovering`;
     a retry repairs the narrow Redis-before-row crash window from the exact fence.
3. `recovering` is a transient server-only fifth `AgentSession.status`. It is not a public/client
   transition and needs no schema field because the stored column is already a string. This consciously
   supersedes the earlier canonical-four wording in 04b while preserving the four ordinary lifecycle
   states.
4. Docker work occurs outside the renewable workspace writer lease. The immutable container ID, exact
   workspace/project/ticket labels, and `/work/.workspaces-run-owner` must all match before killing the
   old Claude process or first stopping the container. An exact container already proved stopped is an
   idempotent replay after a crash between stop and complete: no second stop or impossible stopped-container
   `exec` is attempted. Nonzero inspect/exec/stop or final-state mismatch otherwise cancels; it never completes
   or reprovisions. Reusable-container stage takeover additionally holds an
   atomic `/work/.workspaces-run-owner.lock` across owner read, Redis proof, kill, Redis recheck, marker
   replace, and cleanup, so an expired A cannot interleave with successor B.
5. The watchdog is an `@luckystack/cron` overlay job with `runOnStart`; no domain `setInterval` or
   one-time `isLeader()` gate remains. Global enumeration is read-only, then each workspace runs under
   `runInTenant` and writes only through InternalOps. Worker idle timestamps are host-global Redis keys
   over the exact container identity, so cron-leader switching preserves the TTL.
6. Reminder CAS is a second InternalOp. It binds exact ticket status/archived/remindedAt/needs-input hash,
   upserts a deterministic Notification, advances `remindedAt` once, and sends push outside the writer
   behind a long-lived once claim.
7. Every successful `stage-session-start` resets `startedAt` to now and `lastHeartbeatAt` to null, so a
   successor never inherits its predecessor's watchdog age.
8. The deterministic processed prepare `WorkspaceSignal` is the durable recovery record. Terminal Redis
   dedup replay may contain only keys, and its TTL may expire; recovery reconstructs the rich prepare from
   that exact signal, reuses (never recreates/collides with) its deterministic row after TTL, and may
   restore only the same expired recovery reservation at the already-incremented fence. Cron scans
   `busy`, `recovering`, and recovery-origin `stopped` rows so prepare crashes and queued successor retries
   converge automatically.
9. Manual kill synchronously enqueues and awaits that prepare reentrantly under the current writer before
   a public success ACK. Only Docker plus complete/cancel detach. Reprovision returns an honest boolean,
   queues Docker/admission failures, and recovery reports success only after the exact logical
   `AgentSession` has a new token and higher fence in `busy` or `stopped` state.

## Rejected alternatives

- **Keep `WS_TURN_MAX_MS` as the slot TTL.** Healthy turns then make crash recovery wait for the hard
  maximum, and reducing it would falsely evict legitimate work.
- **Let watchdog/reaper write Prisma directly.** This bypasses tenant scope, the renewable workspace
  writer, durable intent, and exact CAS.
- **Kill by container name or ticket key.** Names are reusable and keys are only workspace-local; an old
  scan can kill a higher-fence successor or another tenant's same-key worker.
- **Inspect/kill first, record intent later.** An irreversible action would then have no accepted durable
  authorization and no way to distinguish stale owner A from successor B.
- **Add recovery columns.** Status + durable WorkspaceSignal intent + Redis owner/fence carry the needed
  state without a migration.

## Consequences

- Healthy renewing owners are never boot-recovered; an expired owner can be taken over once, and all old
  callbacks/releases fail against the recovery/successor fence.
- Dirty `/work` volumes survive: recovery kills only the exact old Claude process or stops the exact
  container; no container/volume removal is part of recovery.
- Recovery is fail-closed on Redis or Docker uncertainty: strict owner/release/cancel APIs throw instead
  of collapsing unavailable into not-owned, so uncertainty leaves `recovering` for cron retry. A crash
  after prepare is reconstructed from the processed signal; a completed recovery without Docker/admission
  remains a `stopped` retry and is never reported recovered until a higher-fence successor is proven.
- A manual kill cannot ACK success before its recovery fence exists, and the file-lock + second Redis
  check prevent an expired owner from killing or overwriting a newer same-container successor.
- The proxy boot leader race and pre-writer worktree orphan remain separate follow-ups and are not solved
  by this decision.
