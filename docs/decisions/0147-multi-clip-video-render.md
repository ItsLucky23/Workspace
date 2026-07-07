---
title: V2 — real multi-clip video render (buildVideoStitchPlan + renderScenes)
status: accepted
date: 2026-07-08
tags: [content, video, render, ffmpeg, idea-to-outcome]
---

## Context

The audit's headline finding: "video" was a still-image slideshow (`buildFfmpegPlan` — one image per beat) and
the only real video-gen clip was never used in the render. V1 added the `VideoScene` timeline model; V2 makes
the render actually STITCH real clips, so a piece can become a real multi-scene video (the marquee of the
"idea → outcome" work).

## Decision

- **`buildVideoStitchPlan(scenes, audioFile, outName, format)`** — a pure, exported ffmpeg-filter_complex plan
  that stitches real scenes: each scene is normalized to one uniform stream (a clip is `trim`med to its
  in/out-point; a still is `-loop`ed + time-bounded, then everything is scaled/fps/format-matched). Joining is
  a single exact `concat` when every transition is a hard cut, or an `xfade` chain when any scene crossfades in
  (offsets = the running composited length minus the transition, so fades overlap correctly). Optional audio is
  the last input, mapped + `-shortest`.
- **`renderScenes(...)`** — the real-video render entry (mirrors `renderTimeline`): localizes each scene's
  clip/still + the voice, builds the stitch plan, runs the SAME injectable ffmpeg-in-Docker runner, typed
  degrade on failure.
- **`assembly.ts` prefers scenes.** When the piece has a `VideoScene` timeline it renders THAT (real stitch);
  otherwise it falls back to the beat slideshow. The render metadata (`totalMs`, `sceneCount`) reflects
  whichever path ran.

## Rejected alternatives

- **The concat DEMUXER (as the slideshow uses).** It can't per-segment trim or crossfade real clips, and mixing
  video + image sources through it is fragile. The `concat` FILTER (with per-input normalization) handles mixed
  clip/still sources + trims robustly.
- **Always xfade.** A crossfade re-encodes and shortens the timeline; when every transition is a hard cut, the
  exact `concat` filter is cheaper and frame-accurate. We pick per-plan.
- **A hosted render API.** Keeps the Docker-only, cost-0 (no budget debit) render policy; no new external
  dependency.

## Consequences

- A piece's scene timeline now renders as a real stitched multi-clip mp4 with trims + transitions — the
  foundation for long videos (V3 fills scenes from a decomposed idea) and range-refine (V4 re-generates a
  scene). The slideshow path is unchanged for pieces without scenes (no regression). The stitch plan is
  unit-tested for structure (concat vs xfade, trim, loop, audio-map, monotonic offsets); the real mp4 is proven
  by the opt-in live render test (extended to a 2-scene stitch). Next: V3 (long-video decomposition).
