---
title: Post scheduling — a leader-gated loop fires PublishJobs at their scheduledAt
status: accepted
date: 2026-07-07
tags: [content, publish, scheduling, freedom-program, multi-instance]
---

## Context

FREEDOM_PROGRAM item **O3**. Publishing was immediate-only: accepting a publish suggestion posted right then.
No way to queue a post for a future time (a content calendar).

## Decision

- `PublishJob.scheduledAt` + a `scheduled` status. The upload implementation was extracted into a
  `performUpload` helper (no job write) shared by both paths. `publishAsset` with a future `scheduledAt` parks
  a `scheduled` job (no post); an immediate publish posts + records a `done` job as before.
- `runScheduledPublish(prisma, now)` fires every due (`scheduledAt <= now`) scheduled job through
  `performUpload` + flips it to `done`/`error`. `now` is injected for deterministic tests; a `startScheduledPublisher`
  interval runs it **leader-gated** (ADR 0015 — exactly one instance fires each due post), mirroring the
  watchdog loop.
- Reschedule = updating `PublishJob.scheduledAt` (the loop honours the new time).

## Rejected alternatives

- **A dedicated scheduler service / cron table.** The existing leader-lease + interval pattern (watchdog) is
  already multi-instance-safe; reusing it avoids a second scheduling mechanism.
- **Fire from the request path with a timer.** An in-process `setTimeout` dies on restart + isn't
  leader-coordinated; a persisted `scheduledAt` polled by the leader survives restarts + multi-instance.

## Consequences

- A post can be queued for any future time and fires once, on the leader, at that time; rescheduling just moves
  `scheduledAt`. The engine is unit-tested with an injected clock (`scheduledPublish` 9/9). The request→schedule
  UI (a content calendar + threading `scheduledAt` through the publish-suggestion accept flow) is a follow-up on
  top of this tested engine.
