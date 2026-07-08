---
title: B1 — client-side crop + resize in the image editor
status: accepted
date: 2026-07-08
tags: [content, image, editor, ui, idea-to-outcome]
---

## Context

The image editor already did adjustments (B/C/S), one-tap looks (B3), and a text overlay (B2), all as
non-destructive Fabric-canvas edits exported to a NEW asset via the tested `content-import-asset` flow. B1
adds the two remaining "essentials" the program calls for — crop and resize-to-preset — without leaving that
client-side, no-provider model.

## Decision

- **Crop is a draggable/resizable Fabric `Rect`** toggled on: its `getBoundingRect()` (clamped to the canvas
  by the pure `clampCropRegion`) becomes the exported sub-region via Fabric's
  `toDataURL({left,top,width,height})`. The rect is removed before export so it isn't baked into the output.
- **Resize is a preset dropdown** (`Original / 1080 / 720 / 512` px width) applied after crop through an
  offscreen 2D-canvas draw sized by the pure `resizeDimensions` (shrink-only, aspect-preserving).
- **The geometry lives in a Fabric-free helper** (`_functions/imageCrop.ts`) so `clampCropRegion` (clamp,
  invert-normalise, degenerate→null) and `resizeDimensions` are unit-tested without a canvas (11/11).
- **No new op, no provider, no spend.** Export still goes through the existing upload + `content-import-asset`
  path (B-23: the Conductor writes the asset), identical to B2/B3.

## Rejected alternatives

- **Server-side crop/resize (a new media op or ffmpeg round-trip).** Pointless for a client-side canvas edit
  that already has the pixels; it would add a provider hop, a cost, and a new verb. Crop/resize are pure
  presentation transforms — keep them local, like the other editor tools.
- **Free-form resize (arbitrary width input).** The program asked for presets; four covers the real cases
  (social 1080, HD 720, thumb 512, original) and keeps the UI a single dropdown.
- **Baking the crop rect into the export and cropping the PNG afterward.** Reading the rect's bounding box +
  Fabric's native sub-region `toDataURL` is exact and avoids a second decode.

## Consequences

- The image editor now covers crop + resize on top of adjust/looks/text, all exported as a new asset through
  the tested import path — no keys, no spend. The pure math is unit-tested; a live browser pass (drag the crop
  rect, verify the exported region + resized dimensions) is folded into the shared browser-verify step. Added a
  `crop` icon to the workspaces Icon map and 7 i18n keys ×4 locales. tsc/lint/ai-lint/build clean.
