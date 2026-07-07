---
title: The inpaint MediaFeature — region-edit backend (E1, server half)
status: accepted
date: 2026-07-07
tags: [media, inpaint, editors, freedom-program]
---

## Context

FREEDOM_PROGRAM item **E1** — the headline "circle a spot → change the colour / make it bigger" region editor.
Its backend needs a media feature that takes a source image + a mask + an instruction and produces a
region-edited image. No such feature existed (media was gen-only, no masking).

## Decision

- A new `inpaint` `MediaFeature` + a `maskUrl` on `MediaGenerationRequest`. `composeFalInput` builds the fal
  flux-inpaint input shape: `image_url` (the source, from `referenceUrl`) + `mask_url` (the mask, white = edit
  region) + the instruction as the `prompt`, routed to an **env-overridable** model
  (`FAL_MODEL_INPAINT`, default `fal-ai/flux-general/inpainting`). All the `Record<MediaFeature, …>` maps
  (kind / provider / cost / support) gained an `inpaint` entry (image kind, fal provider, ~5¢).

## Rejected alternatives

- **Reuse `reference-image`.** That's reference-CONDITIONED whole-image gen with no mask; inpaint is a distinct
  masked region-edit with a different provider input (`mask_url`).
- **Hardcode the exact fal model id.** The precise flux-inpaint endpoint evolves; `FAL_MODEL_INPAINT` lets the
  operator pin their verified endpoint (per the OV-2 decision) without a code change — and the per-request P3
  model override also works.

## Consequences

- The region-edit backend exists + is tested: a mask + instruction reach the provider in the correct shape
  (`inpaint` 6/6), a new asset version chains via I2. The **Fabric.js canvas** that draws the region → exports
  the mask + a `content-inpaint` op threading `maskUrl` through the content flow are the remaining (UI) half of
  E1 — a separate, fresh-context task; this ships the load-bearing provider seam.
