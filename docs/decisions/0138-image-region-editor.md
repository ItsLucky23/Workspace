---
title: The image region editor — Fabric.js mask-draw → inpaint (E1, canvas half)
status: accepted
date: 2026-07-08
tags: [editors, image, inpaint, fabric, freedom-program]
---

## Context

FREEDOM_PROGRAM item **E1** — the headline "circle a spot → change the colour / make it bigger" editor. The
backend (inpaint feature ADR 0132 + the content-inpaint op ADR 0137) was complete + tested; the missing piece
was the canvas UI that lets a user DRAW the region → produce the mask the op consumes.

## Decision

- An `ImageRegionEditor` React component (OV-1 = Fabric.js): the source asset is the display background; a white
  free-draw brush paints the edit region. On apply, the strokes are exported as a **white-on-black mask** from a
  fresh `StaticCanvas` that only ever holds the cloned stroke paths — the source image never touches that canvas,
  so the export is never tainted (no CORS export failure). The mask PNG is uploaded via the K1 `/media/upload`
  route → a `maskUrl`, then `content-inpaint` (ADR 0137) region-edits into a new asset (I2 lineage).
- Fabric is **lazily imported** (`await import('fabric')`) so it lands in its own chunk, never in a non-editor
  route bundle (OV-1). Surfaced as an "Edit region" button on ready image assets in the piece page.

## Rejected alternatives

- **Export the mask straight off the drawing canvas.** The drawing canvas holds the (possibly cross-origin)
  source image → `toDataURL` can taint-throw. Cloning the strokes onto a clean StaticCanvas sidesteps it.
- **A plain `<canvas>` mask layer.** Fabric gives brush size, stroke objects, and clone/transform for free (and
  is the OV-1 decision) — worth the dependency for the editor surface (E2 builds on the same canvas).

## Consequences

- The full region-edit loop exists: draw → mask → inpaint → a new versioned asset. The op path + provider shape
  are unit-tested (`contentInpaint` 4/4, `inpaint` 6/6); the **canvas rendering itself is verified in a browser
  dev session** (the server must be running — a developer action) — that live pass + a visual-diff are the
  remaining verification, not more code. E2 (crop/resize/adjust) extends this same canvas.
