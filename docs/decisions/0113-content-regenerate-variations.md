---
title: Regenerate + variations on a produced content asset (with a tweak), via the queue-aware lifecycle
status: accepted
date: 2026-07-07
tags: [content, media, iteration, freedom-program]
---

## Context

FREEDOM_PROGRAM item **I1**. Content assets were pure one-shot: no regenerate, no variations, no "make it more
X" — if you didn't like a result your only recourse was to fire a whole new generation from the direction
inputs. The MediaJob stored the input, but nothing re-used it.

## Decision

- A `content-regenerate` control-op: given an asset id, it loads the asset's `MediaJob` (feature + prompt +
  referenceUrl + style), and re-runs `generateMediaAsset` **N times** (`count`, 1–4) with an optional `tweak`
  appended to the instructions — each variation goes through the queue-aware lifecycle (queued → processing →
  ready + live delta), so the timer/queue UX is identical to a fresh gen.
- The asset card shows **Regenerate** + a variations (×3) button for a **`regenerable`** asset (a ready,
  AI-generated, non-imported asset — a new summary flag from `toContentAssetSummary`), using the piece's
  current free-form direction as the tweak. Behind the cost confirm (B-23; it spends).

## Rejected alternatives

- **Overwrite the asset in place.** A regeneration is a NEW variation the user compares to the original; keeping
  both is what "variations" means (versioning/compare is I2).
- **Regenerate the per-beat / voice flows too.** Those produce N/coupled assets; the generic single-asset
  features (image/reference-image/video/avatar/music/sfx/3d) are the re-runnable ones. Beat-image re-roll can
  reuse the same helper later.
- **A free-text tweak field per asset.** Reused the piece's existing direction box as the tweak — no new UI,
  and it's the same mental model as the initial generation.

## Consequences

- A user iterates: regenerate, ask for 3 variations, or "make it more X" via the direction box + regenerate.
  Imported assets (no MediaJob) aren't regenerable (the flag hides the buttons + the op no-ops). Version
  history / compare / revert is the next item (I2).
