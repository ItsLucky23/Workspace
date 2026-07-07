---
title: Parametrized render formats (incl. 9:16 vertical) + .srt/.vtt caption export
status: accepted
date: 2026-07-07
tags: [content, render, export, captions, freedom-program]
---

## Context

FREEDOM_PROGRAM item **O1**. The video render was locked to a fixed 1280×720 / 30fps landscape plan — no
vertical (9:16) format for TikTok/Shorts/Reels, no square, and the `captions` metadata that already exists was
never exported as subtitle files.

## Decision

- `buildFfmpegPlan` takes an optional `RenderFormat`; `resolveRenderFormat(key)` maps `16:9` (1280×720, the
  default), `9:16` (720×1280 vertical), `1:1` (1080×1080) — the scale/pad target + fps come from the preset.
  `renderTimeline` accepts a `format` string and passes it through. Unknown/absent → the 16:9 default.
- Pure `buildSrt(captions, totalMs)` + `buildVtt(captions, totalMs)` emit well-formed subtitle files by
  distributing the (untimed) caption LINES evenly across the duration.

## Rejected alternatives

- **A free-form width×height.** The three named aspect presets cover the real platforms; arbitrary dimensions
  invite invalid ffmpeg geometry. A preset key is safer + is what a format picker offers.
- **Per-caption timestamps.** The captions metadata is plain lines with no timing; even distribution is the
  honest mapping until a timed-caption model exists. It produces valid, usable .srt/.vtt today.

## Consequences

- The render engine can produce vertical/square/landscape at chosen fps, and the piece's captions export as
  .srt/.vtt — all pure + unit-tested (`renderFormats` 16/16), so it holds under the typed-degrade path without
  ffmpeg. The remaining wiring — a format picker on the export UI + writing the .srt file into the media store
  alongside the .mp4 — is a thin follow-up on top of these tested primitives (the engine + emitters are done).
