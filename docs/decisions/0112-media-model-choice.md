---
title: Per-request + per-workspace media model choice (low-poly / fast vs quality)
status: accepted
date: 2026-07-07
tags: [media, fal, models, freedom-program]
---

## Context

FREEDOM_PROGRAM item **P3**. The fal model per feature was **env-only** (`FAL_MODEL_*`, process-global);
`falModelFor` ignored `req.params` for model selection, so a user couldn't choose a faster/low-poly/cheaper
model per generation or per workspace.

## Decision

- `composeFalInput` now consults **`req.params.model`** (a per-request model id) → picks the fal model, and
  strips `model` from the input body (it's a routing param, not a fal input field). Falls back to the
  env/default.
- A **per-workspace** model override is stored as `__media_model_<feature>` (mirrors the provider-override
  store); `loadWorkspaceMediaConfig` loads it (`cfg.models`), and `runMediaGeneration` injects it into
  `params.model` (the caller's own `params.model` still wins). Saved via the extended `save-media-provider` op
  ('default' clears it).
- The content settings expose an advanced **free-text model id per feature** (empty = the built-in default,
  shown as the placeholder), surfaced from the snapshot (`content.mediaModels`).

## Rejected alternatives

- **A curated model-catalog dropdown.** Only image-gen has confidently-known alternates (flux dev vs schnell);
  for 3d/video the exact fal model ids vary + evolve. A free-text id is honest + flexible (paste any fal model,
  e.g. a low-poly 3d endpoint you found) and doesn't bake in ids I can't verify. A curated preset list can be
  layered on later.
- **Per-request only.** A per-workspace default means the user sets "use the fast image model" once; a
  per-request override (params.model) still wins for a one-off.

## Consequences

- A user can point any fal feature at a different model — a fast/cheap image model, a low-poly 3d model — per
  workspace (UI) or per request (params). Combines with P1/P2 to give full provider+model control. The
  triposr-queue pain (ADR 0096) now has a user-facing escape: set a different 3d model.
