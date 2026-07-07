---
title: Video timeline — beat reorder + trim drives the render plan (E3, backend half)
status: accepted
date: 2026-07-08
tags: [editors, video, render, freedom-program]
---

## Context

FREEDOM_PROGRAM item **E3** — a video timeline: see the scenes (beats), reorder them, trim each. The render
reads beats `orderBy: order` with a per-beat `durationMs`, but nothing let a user change the order or the
on-screen time.

## Decision

- A `content-reorder-beats` control-op: given `[{ beatId, order?, durationMs? }]` it updates each beat's `order`
  (resequence) + `durationMs` (trim, clamped 0.5–30s). Because the assembly renders beats in `order` with each
  beat shown for its `durationMs`, this directly drives the ffmpeg plan (sequence + clip times) — verified by
  reordering + trimming and asserting the resulting `buildFfmpegPlan` concat list.

## Rejected alternatives

- **A new timeline model.** Beats already ARE the timeline (order + duration + image); reordering/trimming them
  is the timeline edit — no parallel structure needed.
- **Client-side render.** The render is ffmpeg-in-container (M4); the timeline edits the INPUT (beat order +
  durations) that plan is built from, which is the right seam.

## Consequences

- The timeline's load-bearing behaviour — reorder + trim → the expected render plan — exists + is tested
  (`reorderBeats` 6/6). The **drag-timeline UI** (and exposing beats on the piece snapshot for it to render) is
  the browser-verified follow-up on top of this op; multi-scene stitch + the music/voice mix (E4) build on the
  same beat sequence.
