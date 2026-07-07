---
title: V4 — range-refine (content-refine-range)
status: accepted
date: 2026-07-08
tags: [content, video, editing, lineage, idea-to-outcome]
---

## Context

The user's editing vision: "select seconds 13–18 and say refine the transition / voice-over" — iterate a long
video without redoing the whole thing. V1–V3 built the scene timeline, stitch, and decomposition; V4 is the
targeted edit.

## Decision

- **`scenesInRange(scenes, startMs, endMs)`** (pure, tested): maps the ordered scenes onto a cumulative
  timeline and returns those whose interval overlaps the selected range (half-open `[start,end)`), each with
  its computed `startMs`/`endMs`.
- **`refineSceneRange(...)`** regenerates every covered scene as a NEW version: a fresh `video-gen` clip with
  the instruction folded into the scene's prompt (`<prompt>. Refinement: <instruction>`), a new `VideoScene`
  with `parentId` = the old scene (I2 lineage) keeping the same order/duration/transition, then the old scene
  is removed — so the timeline keeps its shape and the edit is traceable.
- **`content-refine-range`** control-op (contentControl route, RBAC work-tickets): `{ startMs, endMs,
  instruction }`; a range that hits no scene is a no-op.

## Rejected alternatives

- **Edit the scene in place (mutate the clip).** Loses the version history; a refine you dislike couldn't be
  traced back. `parentId` lineage (matching I2) lets a later revert/compare feature exist.
- **Refine only the single scene at the range midpoint.** A selection that straddles two scenes should refine
  both — the overlap test covers exactly the scenes the user sees under their selection.
- **Re-run the whole decomposition.** Wasteful + throws away the parts the user was happy with; V4 touches only
  the selected span.

## Consequences

- A user can now iterate a specific span of a long video ("13–18s → smoother transition") and only that span
  regenerates, with lineage preserved. Combined with V1–V3 the backend "idea → editable multi-scene video"
  pipeline is complete. Pure range-mapping is unit-tested; the op is integration-tested (straddle two scenes,
  parentId lineage, prompt fold, out-of-range no-op). Next: V5 — the timeline editor UI that drives
  save-scenes / decompose / refine-range (browser-verified).
