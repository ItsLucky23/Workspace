---
title: Media generation is queue-aware — the UI shows "in queue · position N" and only starts its elapsed timer when the job leaves the provider queue
status: accepted
date: 2026-07-07
tags: [media, content, fal, realtime, broadcast, ux]
---

## Context

fal media jobs (image/video/3d, notably triposr) can sit in the provider QUEUE before they start
processing (ADR 0096 found triposr stuck at `queue_position: 8`). The old flow discarded fal's
`IN_QUEUE`/`IN_PROGRESS` distinction + `queue_position` entirely, persisted the `MediaJob` already as
`done`, and surfaced results only via the caller's post-completion `refetch()` — there was **no
elapsed timer and no queue signal at all**. The user asked for queue support in the UI + timer logic
so the timer waits for the queue instead of starting while the job is only queued.

## Decision

End-to-end queue awareness, respecting B-23 (the Conductor stays the single writer — media gen runs
inline on its chain; we only add intermediate writes + socket emits within the same op):

- **Provider reports progress.** `MediaGenerationRequest.onProgress?(p)` carries `{ state:
  'queued'|'running', queuePosition? }`. `server/media/providers/fal.ts` reads `queue_position` +
  the `IN_QUEUE`→`IN_PROGRESS` transition in its poll loop and fires `queued` (on entry / position
  change) then `running` ONCE the job is picked up.
- **Job lifecycle is persisted.** `MediaJob` gains `queuePosition Int?` + `startedAt DateTime?`.
  `server/content/mediaAsset.ts` creates the `ContentAsset` + `MediaJob` as **`queued` up front**,
  transitions `queued → running(@startedAt) → done` (progress writes serialized onto a chain awaited
  before the final write so they can't race completion), and marks `error` cleanly on failure.
- **Live delta push.** A new `broadcastContentAssetDelta` (server/read/broadcast.ts, modeled on
  `broadcastTicketDelta`) emits the asset under `workspaces/contentAssetDelta`; the client upserts it
  by id into its piece. A broadcast-only `_sync` type-carrier route registers the payload shape.
- **UI.** The content asset card shows **"in queue · position N" (no timer)** while `queued`, and an
  **elapsed timer anchored on `startedAt`** once `processing`. The timer literally cannot start while
  the job is only queued — the whole ask.

## Rejected alternatives

- **A UI-only timer + a guessed "queued" badge.** Dishonest — the queued phase would be fabricated,
  not the real provider state. The user explicitly chose the full end-to-end option.
- **Move media gen off the single-writer chain into a background worker** (create `queued`, return,
  run async, re-enter the Conductor per transition). The correct long-term model, but a large
  leader-election/worker refactor; the inline path + mid-op socket emits deliver the exact UX now
  without it. (The pre-existing wart — the workspace write-lease is held during a long queued gen —
  is left as a separate follow-up; it is not made worse.)
- **Poll a status endpoint from the client.** Adds a new read surface + polling load; the existing
  room broadcast already fans out cross-instance via the Redis adapter.

## Consequences

- The triposr/queue case now reads honestly in the UI ("in queue · position 8") instead of a dead or
  mis-timed spinner; the timer reflects real processing time only.
- Applied to the generic `generateMediaAsset` path (avatar/music/sfx/model-3d — incl. the motivating
  triposr). The specialised flows (per-beat images, voice, short-form, reference-image) still use the
  synchronous create-as-done path and can adopt the same `queued→running→done` helper next — flagged,
  not silently skipped.
