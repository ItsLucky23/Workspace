---
title: Per-request cheap "preview" (dry-run) for media generation (S1)
status: accepted
date: 2026-07-07
tags: [media, cost, ux, freedom-program]
---

## Context

FREEDOM_PROGRAM item **S1**. `WS_MEDIA_CHEAP` (the fast/low-res/single-output mode) was an OPERATOR env only —
all-or-nothing for the whole deployment. A user couldn't rehearse a single generation cheaply before spending
on the full-quality run.

## Decision

- `cheapMode(reqCheap?)` is now on when the operator env is set OR a per-request flag asks for it. A
  `params.cheap === true` flag (a routing param, stripped from the fal input body like `params.model`) drives
  `falModelFor` (→ the fast `schnell` image model) + `cheapParams` (low steps / low resolution / single output)
  for that ONE request. The full-quality run is unaffected when the flag is absent.

## Rejected alternatives

- **A separate "preview" MediaFeature.** It's the SAME generation at lower fidelity — a per-request flag, not a
  new feature (which would ripple through cost tables + provider supports).
- **Adjust the cost ESTIMATE now.** The real provider cost is already lower (fewer steps / lower res = less
  compute billed). Our fixed per-feature `mediaCostTable` estimate reflecting the discount is a separate,
  documented follow-up — as is the UI "preview" toggle threading `params.cheap` through the generation flow.

## Consequences

- A generation can run in cheap-preview for a rehearsal, per request, without flipping a deployment-wide env —
  pure + unit-tested (`cheapPreview` 7/7, `falProvider` 26/26 unaffected). The UI toggle + the cost-estimate
  discount are follow-ups on top of this tested seam.
