---
title: V1 — the video-timeline scene model (VideoScene + content-save-scenes)
status: accepted
date: 2026-07-08
tags: [content, video, timeline, schema, idea-to-outcome]
---

## Context

The audit found "video" was a still-image slideshow — no real multi-clip video, no timeline. IDEA_TO_OUTCOME
Fase V builds real video; V1 is the data foundation the render (V2), long-video decompose (V3), range-refine
(V4) and the timeline editor (V5) all sit on. The existing `Beat` model is a slideshow still bound to a script;
it can't represent an ordered set of real clips with trims + transitions.

## Decision

- **New `VideoScene` model** (per content piece): `order`, `videoAssetId?` (a real clip) / `imageAssetId?` (a
  still/ken-burns fallback), `startTrimMs` / `endTrimMs`, `durationMs`, `transitionIn` (cut|fade|xfade),
  `prompt` (for V3/V4 regen) and `parentId` (I2-lineage — a refined version of a prior scene).
- **`videoAssetId` / `imageAssetId` are plain `String?`, not `@db.ObjectId`.** A user-editable timeline must
  never hard-fail a whole save because one ref isn't a valid ObjectId; asset refs are soft. `parentId` stays
  `@db.ObjectId` (internal lineage, always a real scene id).
- **One write op, `content-save-scenes`** (a `[control-API]` op via the contentControl route, RBAC
  `work-tickets`): the timeline editor sends the full ordered list; the Conductor UPSERTS by id (existing
  scenes keep their id + lineage, new ones are created, dropped ones removed) and re-sequences `order`. One op
  covers reorder/trim/transition/delete/add — matching how an editor saves.
- **Surfaced in the read snapshot** (`ContentPieceSummary.scenes`) for the editor + the render.

## Rejected alternatives

- **Reuse `Beat`.** A Beat is a script-bound slideshow still; overloading it with clip/trim/transition would
  conflate the slideshow path with the real-video path. A separate model keeps both clear (the render picks
  scenes when present, else falls back to the beat slideshow).
- **Granular per-scene ops (add/update/delete/reorder).** More verbs + more round-trips; a full-list upsert is
  simpler and is exactly the editor's save shape. Split/cut (V6) still map to producing a new list.
- **`@db.ObjectId` asset refs.** Strict validation made a whole timeline save throw on any non-ObjectId ref —
  wrong failure mode for user-editable data.

## Consequences

- A piece can now hold an ordered, editable set of real video scenes. V2 (the multi-clip ffmpeg stitch) reads
  them ordered; V3 fills them from a decomposed idea; V4 refines a range into a new scene version; V5 is the
  timeline UI that drives `content-save-scenes`. No behaviour change until V2 wires the render to scenes.
