---
title: Content asset version lineage — a variation points at its source (parentId); compare/revert is a follow-up
status: accepted
date: 2026-07-07
tags: [content, versioning, freedom-program]
---

## Context

FREEDOM_PROGRAM item **I2**. I1 added regenerate/variations, but the new assets were unlinked from the source
— no way to tell which asset a variation came from, and no version grouping.

## Decision

- `ContentAsset.parentId` records the asset a variation was regenerated FROM. `content-regenerate` sets it on
  each new asset to the **root** of the lineage (if the source is itself a variation, chain to its parent so all
  variations share one root — a flat, not deep, tree).
- The asset summary carries a `variant` flag (has a parent) → the card shows a small **Variant** badge, so the
  user sees originals vs regenerations at a glance.

## Rejected alternatives

- **A full deep version tree.** Flat (all variations → one root) is simpler + matches how users think ("these
  are all variations of that"). A deep chain adds complexity for no clear benefit here.
- **Compare + revert UI now.** "Revert" needs a notion of the piece's PRIMARY asset, which doesn't exist yet
  (assets are a flat list). The `parentId` lineage is the foundation; a compare view + a primary/revert concept
  are a documented fast-follow on top of it.
- **Overwrite on regenerate.** Loses the comparison; keeping every variation with a lineage is the point.

## Consequences

- Every regeneration is traceable to its source, and variations are visibly badged. This is the data foundation
  for a compare/revert UI (fast-follow) and for grouping variations under their original.
