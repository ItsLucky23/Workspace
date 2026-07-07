---
title: All media flows share one queue-aware lifecycle helper; content state syncs to the whole workspace with reconnect + staleness safety nets
status: accepted
date: 2026-07-07
tags: [media, content, realtime, broadcast, race-conditions, robustness]
supersedes: []
---

## Context

ADR 0098 made the *generic* media path (avatar/music/sfx/3d) queue-aware. But the specialised content
flows (per-beat images, voice, short-form, reference-image, ffmpeg render) still used the old
synchronous "create-as-done" path with no queued state and no broadcast, so other workspace members saw
nothing live for them. Beyond that, the realtime layer had two robustness holes: (1) a client that
briefly disconnects **misses every delta and is dropped from the room** with no recovery, and (2) the
structural content mutations (piece create/advance/archive, script gen, settings) broadcast **nothing**
— they reached only the caller's own refetch. The user asked for *all* flows queue-aware, everything
synced to everyone across the workspace, and race conditions covered.

## Decision

- **One shared lifecycle helper** — `server/content/queuedMediaJob.ts:runQueuedMediaAsset`. It creates
  the `MediaJob` + `ContentAsset` as `queued` up front, threads a serialized queue→running `onProgress`,
  finalizes to `ready`/`error`, and broadcasts a content-asset delta at every transition. All five media
  flows (`mediaAsset`, `images` [per-beat loop], `voice`, `shortForm`, `referenceImage`) delegate to it,
  each supplying only its specifics via hooks (`onComplete` → `Beat.imageAssetId`; `finalizeMetadata` →
  voice timing map / short-form hook+captions). `assembly` (ffmpeg render, no provider queue) gets a
  `processing`→`ready` asset + broadcast manually (a plain spinner, no elapsed timer).
- **Whole-workspace sync = fine-grained deltas + a coarse nudge + reconnect healing:**
  - Per-asset timer state → `broadcastContentAssetDelta` (upsert-by-id into the piece).
  - Structural changes → a new `broadcastContentDirty(workspaceId)` fired after every `contentControl`
    and `contentSettings` op; the client refetches **debounced (400ms)**, coalescing bursts.
  - Reconnect → the provider subscribes to `useSocketStatus`; on a transition back to `CONNECTED` from a
    dropped/reconnecting state it **re-joins the room and refetches**, healing any missed deltas.
- **Race + edge-case coverage:**
  - Progress writes are serialized on a promise chain awaited before the final write (can't race
    completion). Deltas are ordered (TCP + serialized emits). Client merges are idempotent upserts by id.
  - Orphaned in-flight jobs (server crash mid-gen → asset stuck `queued`/`processing`) are surfaced as
    `error` by a **read-side staleness guard** in `toContentAssetSummary` (no heartbeat for >20 min → the
    UI never spins forever). `nowMs` is injectable for deterministic tests.
  - Stub/instant gen → `queued`→`ready` (brief flash, harmless). fal timeout → clean `error` (ADR 0096).
  - Concurrent same-piece gen → serialized by the single-writer Conductor; distinct asset ids.

## Rejected alternatives

- **Duplicate the lifecycle into each flow.** Five copies of the queued→running→done + broadcast dance
  is a maintenance trap; a parameterized helper with per-flow hooks keeps one source of truth.
- **Per-mutation fine-grained deltas for every content op** (new piece, advance, archive, script). Much
  more surface + type-carrier routes for marginal gain over a debounced refetch nudge; the nudge already
  converges every client cheaply. Fine-grained deltas are reserved for the high-frequency asset timer.
- **A background reaper for orphaned jobs.** A leader-loop sweep is heavier infra; a pure read-side
  staleness guard needs no writes, no scheduler, and is trivially testable.
- **Ignore reconnect** (rely only on the next user action). Leaves a client silently stale after any
  network blip — unacceptable for "everything synced to everyone".

## Consequences

- Every media generation — image, video, 3d, voice, music, sfx, avatar, reference-image, render — now
  shows the same live queued/processing state to the whole room, and (for provider-queue features) the
  timer that only starts when the job leaves the queue.
- Content changes propagate to all members within one debounced refetch; a reconnecting client self-heals.
- The specialised flows now create an asset even on failure (marked `error`) — a visible failed card,
  which is the desired behaviour (was: silently skipped). `imageCount`/spend still count only successes.
