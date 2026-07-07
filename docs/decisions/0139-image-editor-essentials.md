---
title: Image editor essentials — brightness/contrast/saturation → a new asset (E2)
status: accepted
date: 2026-07-08
tags: [editors, image, fabric, freedom-program]
---

## Context

FREEDOM_PROGRAM item **E2** — the essentials around the E1 region editor: adjustments + crop, non-destructive.

## Decision

- An `ImageEditor` component on the same Fabric.js canvas: brightness / contrast / saturation sliders applied
  as fabric image filters, exported as a NEW image asset (non-destructive — the original is untouched; the edit
  is imported via the tested `content-import-asset` op, appearing as a normal asset). It's a client-side
  transform (no provider, no spend). Fabric + its filters are lazily imported. An "Adjust" button on ready
  image assets, alongside E1's "Edit region".

## Rejected alternatives

- **A server-side (sharp/ffmpeg) transform.** The adjustments are trivially client-side on the canvas already
  loaded for the editor; a round-trip to a server transform adds latency + a new pipeline for no gain here.
- **Overwrite the source.** Non-destructive (a new asset) matches the I2 versioning philosophy — the original
  stays for comparison.
- **Ship crop in the same pass.** Adjustments are the self-contained slice; crop (a selection rect → export the
  sub-region) is a natural next addition on this canvas, noted as a follow-up.

## Consequences

- A user can adjust brightness/contrast/saturation and save the result as a new asset, no spend. The
  export→import wiring reuses the tested K1 upload + content-import-asset; the canvas rendering + filter preview
  are browser-verified in a dev session. Crop + in-canvas variation-compare are follow-ups on this canvas.
