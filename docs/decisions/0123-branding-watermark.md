---
title: Logo watermark overlay in the render plan (O4); intro/outro concat deferred
status: accepted
date: 2026-07-07
tags: [content, render, branding, freedom-program]
---

## Context

FREEDOM_PROGRAM item **O4** (branding). The render produced un-branded video — no way to stamp a logo
watermark from the brand kit onto the output.

## Decision

- `buildFfmpegPlan` takes an optional `Watermark { file, position }`. When present it switches from the simple
  `-vf` scale path to a `-filter_complex` graph — `[0:v]<scale>[bg];[bg][N:v]overlay=<xy>[outv]` with explicit
  `-map [outv]` (+ `-map 1:a` when there's audio) — placing the logo in a corner (default bottom-right, 24px
  margin). `renderTimeline` localizes an optional `watermarkUrl` (a brand-kit logo) and skips it cleanly if it
  can't be localized. All pure + unit-tested.

## Rejected alternatives

- **`drawtext` for a text watermark.** A logo IMAGE overlay is the brand-kit case; a text watermark needs a
  font file in the container + escaping — a separate, later addition.
- **Intro/outro clip concat now.** Prepending/appending brand clips means a second concat pass (different
  durations/streams) — meaningfully more complex than the overlay. Deferred as a documented follow-up; the
  overlay is the high-value, self-contained half of O4.
- **Always use filter_complex.** Kept the simple `-vf` path when there's no watermark (unchanged behaviour for
  every existing render).

## Consequences

- A render can carry a corner logo watermark fed from the brand kit, pure + unit-tested (`renderFormats` 24/24)
  so it holds under the typed-degrade path. Intro/outro clips + a text/`drawtext` watermark + the brand-asset
  wiring (which logo, which corner, from the UI) are follow-ups on top of this tested primitive.
