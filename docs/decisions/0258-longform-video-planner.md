---
title: M3 — pick-a-look + long-form video duration planner
status: accepted
date: 2026-07-08
tags: [content, video, planner, style, ai-libraries-accounts]
---

## Context

The pipeline emitted a fixed 4–8 beats → ~20–40s videos; there was no way to ask for a longer video, and
"pick a look + topic → make a video" needed the style to reach the video path (M2, done). M3 adds the
duration planner so "a 10-minute video about the moon landing in stick-man figures" is expressible.

## Decision

- **A pure `planBeatCount(targetDurationMs, sceneDurationMs)`** maps a target duration to ~N beats/scenes
  (each ≈ sceneDuration), bounded to [2, `MAX_BEATS` = 40]. The media budget stays the true hard cap; 40 is the
  planner ceiling so a runaway target can't fan out to hundreds of paid clips.
- **`generateScript` gained `targetBeats`** → `scriptFormat(targetBeats)` asks the model for ~N beats, and the
  stub script yields exactly N (deterministic in the stub world). `runContentPipeline` gained `durationMs` +
  `sceneDurationMs`, plans the beat count, threads it to the script + the per-scene length to decompose. The
  `content-run-pipeline` op forwards both.
- **A Length picker** (Auto / Short / Normal / Long) on the piece page sets `durationMs`; combined with the M1
  style picker, that IS "pick a look + a length → make a video". 0 = auto (the default arc).

## Rejected alternatives

- **Uncapped beat count from the duration.** A 10-min target at 5s/scene = 120 paid video clips; the cap +
  budget guard keep cost sane while still delivering a genuinely long, multi-scene video.
- **A separate long-form pipeline.** The existing pipeline already scripts → decomposes → assembles; only the
  beat COUNT needed to scale with a target. One parameter beats a parallel path.

## Consequences

- A user can now pick a style + a length + a topic and get a styled, duration-targeted multi-scene video.
  Proven: `planBeatCount` unit 8/8, a stub-world pipeline E2E 4/4 (35s → 7 beats; no target → the 4-beat arc);
  the styled scenes come from M2, and a short REAL render is covered by renderLive (2-clip stitch). This closes
  the "idea + look → video" flow; M4 adds media-style upload/copy/customize.
