---
id: 0059
title: Reference-driven photorealistic image generation (F2.1, #1 feature)
status: accepted
date: 2026-07-06
tags: [content, image, reference, photoreal, expansion-f21]
supersedes: []
depends_on: [0049, 0052, 0053, 0057]
---

# Reference-driven photorealistic image generation (F2.1)

## Context

The user's #1-priority feature: generate an image CONDITIONED on a reference image, in a chosen style (realism first) + free-form extra instructions (e.g. "dancing, brown curly hair"). The `reference-image` media feature exists (F0.3); F2.1 wires the content-side flow.

## Decision

`server/content/referenceImage.ts` `generateReferenceImage` runs the metered path: `checkMediaBudget('reference-image')` → `runMediaGeneration({feature:'reference-image', referenceUrl, style, extraInstructions})` (stub) → an image `ContentAsset` (`metadata.hasReference`) + a `MediaJob` (records the `referenceUrl` + `styleId`) → `recordMediaSpend`. **The style defaults to `realistisch`** unless overridden (realism is the priority). Driven by the `content-gen-reference-image` op (B-23, `workTickets`), which requires a `referenceUrl`.

## Rejected alternatives

- **Build custom-model / LoRA training-from-references now.** Deferred — the user's example ("make them dancing, brown curls") is per-generation reference CONDITIONING, not a persistent trained model. Training a model from a reference SET (for consistent subjects/products across many gens) is a separate, heavier follow-up item (a `MediaJob` training kind + a model registry) — noted, not built.
- **Reuse `content-gen-images` (per-beat).** Rejected — reference-image is a standalone gen (a reference + a subject), not tied to a script's beats; it gets its own op + service.
- **Force realism (no style override).** Rejected — realism is the DEFAULT, but the style system stays open (a user can pick `cinematic` etc.); the default just encodes the priority.

## Consequences

- New `server/content/referenceImage.ts` + the `content-gen-reference-image` op. Reuses the media registry stub + budget path.
- `tests/integration/referenceImage.test.mts` (10 assertions): reference-conditioned image (hasReference), realistisch style applied, extra instructions flow through, MediaJob records the reference url + routes to fal + links the asset, budget debited 5c, AND the budget-block path. Custom-model training remains a documented follow-up.
