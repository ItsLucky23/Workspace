---
title: content-inpaint op — thread a mask through the content flow to the inpaint feature (E1, wiring half)
status: accepted
date: 2026-07-07
tags: [content, inpaint, editors, freedom-program]
---

## Context

FREEDOM_PROGRAM item **E1**. ADR 0132 added the `inpaint` MediaFeature + `composeFalInput` mask plumbing. The
remaining backend gap: a content-flow op that takes a source image + a mask + an instruction and produces a new
region-edited asset (so the eventual canvas editor has a write path to call).

## Decision

- `generateMediaAsset` threads a `maskUrl` into the media request. A `content-inpaint` control-op
  (`{ contentProjectId, referenceUrl, maskUrl, prompt, parentAssetId? }`) runs the inpaint feature → a NEW
  asset, chained to the source via `parentId` (I2 lineage). No-ops without a mask/prompt. workTickets
  capability, single-writer.

## Rejected alternatives

- **Overwrite the source asset.** A region-edit is a new version to compare (I2); keeping both with the lineage
  is the established pattern.
- **Build the canvas now.** The Fabric.js draw-region → mask-export UI needs a browser to build + verify well;
  it's a separate fresh-context task. This op is its testable server-side write path — the mask URL it will
  produce flows straight through.

## Consequences

- The full region-edit BACKEND is now complete + tested end-to-end: a mask + instruction → a new region-edited
  asset chained to its source (`contentInpaint` 4/4, on top of `inpaint` 6/6 for the provider shape). The only
  remaining piece of E1 is the **Fabric.js canvas** that produces the mask + calls this op — a browser-dependent
  UI follow-up.
