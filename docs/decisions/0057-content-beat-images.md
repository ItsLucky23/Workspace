---
id: 0057
title: Per-beat image generation (F1.4)
status: accepted
date: 2026-07-06
tags: [content, image, media, budget, expansion-f14]
supersedes: []
depends_on: [0049, 0052, 0053, 0056]
---

# Per-beat image generation (F1.4)

## Context

Each storyboard `Beat` needs a visual for the montage. F1.4 generates one image per beat via `image-gen` (stub, no key), in the chosen style + extra instructions, and links it on the beat.

## Decision

`server/content/images.ts` `generateBeatImages` loops the script's beats: per beat it budget-checks (`estimateMediaCostCents('image-gen')` → `checkMediaBudget`), runs `runMediaGeneration({feature:'image-gen', prompt: beat.visualPrompt})`, writes a `MediaJob` + an image `ContentAsset`, links `Beat.imageAssetId`, and records the spend. It **stops early (partial result) if the budget cap is hit** mid-loop. Driven by the `content-gen-images` control-op (B-23, `workTickets`).

## Rejected alternatives

- **One batch gen for all beats.** Rejected — per-beat gen lets each visual match its beat's `visualPrompt` + attach individually + budget per image (and stop cleanly mid-way on a cap).
- **Abort the whole run if one beat's budget check fails.** Rejected — a partial result (the beats done before the cap) is more useful; the caller sees `blocked:true` + `imageCount`.
- **Store the image url on the beat directly.** Rejected — a first-class `ContentAsset` (linked via `Beat.imageAssetId`) keeps every produced asset uniform (same MediaJob/spend trail) for the assembly + the asset views.

## Consequences

- New `server/content/images.ts` + the `content-gen-images` op. F1.5 assembles the beats' images + the voice into the final render.
- `tests/integration/contentImages.test.mts` (7 assertions): 4 image assets (one per beat), style applied, every beat linked, a MediaJob per image (fal + linked asset), budget debited 4×4c=16c.
