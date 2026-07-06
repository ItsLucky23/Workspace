---
id: 0079
title: Real Fal.ai media generation behind available() (stub = no-key fallback)
status: accepted
date: 2026-07-06
tags: [content, media, fal, generation, depth-program]
supersedes: []
depends_on: [0072, 0052]
---

# M1 — write the live image/video/3d/reference gen code

## Context

`GAP_ANALYSIS.md` content #2: the Fal provider's `generate()` returned `media.notImplemented` — the
whole image/video/3d/reference-image surface was fake `stub://`. The user clarified: fake CODE was
never asked for (only fake TESTS for the no-key rounds). This item writes the REAL fal.ai code behind
`available()`, keeping the stub as the pure no-key fallback.

## Decision

- `server/media/providers/fal.ts` now has a LIVE `generate()`: it composes the prompt (style
  system-prompt + prompt + extra instructions, ADR 0053), builds the fal model + input
  (reference-image/model-3d carry the reference as `image_url`), runs a real fal.ai **queue** request
  (submit → poll status → fetch result, with retry/backoff), and extracts the produced asset URL
  per model shape (`images[]`/`video`/`model_mesh`) + a metered € cost.
- The HTTP transport is an injectable `FalTransport` so `generate` + the pure helpers
  (`composeFalInput`/`extractFalAsset`/`liveMediaCostCents`) are unit-tested with FIXTURES — no key,
  no network. The real transport (`realFalTransport`) is used by default.
- `available()` still gates on `FAL_KEY`: no key → the registry never calls `generate` and returns the
  valid-shaped stub, so the dummy-data pipeline stays green.

## Rejected alternatives

- **The fal synchronous `fal.run` endpoint.** Rejected as the default — video/3d take minutes; the
  queue API (submit + poll) is the robust path. Fast models still work through it.
- **Add the `@fal-ai/serverless-client` SDK.** Rejected — a raw fetch keeps the no-extra-dep posture
  (boot-crash risk) and is trivially testable via the injected transport.

## Consequences

- `fal.ts` rewritten with the live path + pure helpers + injectable transport. `tests/unit/
  falProvider.test.mts` (19/19) covers prompt composition, request shape (incl. reference image_url),
  per-model asset extraction, typed failures, and the `available()` gate. `mediaRegistry` 18/18
  (stub-fallback) unaffected. Model ids + costs are env-overridable (`FAL_MODEL_*`, `FAL_COST_*`).
  Live generation against real fal.ai is part of the deferred post-keys e2e (needs `FAL_KEY` + budget).
