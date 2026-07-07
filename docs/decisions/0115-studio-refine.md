---
title: Studio artifact regenerate takes a free-text refine instruction (not a blind re-roll)
status: accepted
date: 2026-07-07
tags: [studio, iteration, freedom-program]
---

## Context

FREEDOM_PROGRAM item **I4**. Studio's regenerate re-ran the same brief with no delta — a blind re-roll. The
only way to steer a studio output was to edit the whole brief and regenerate; you couldn't say "make the
landing page bolder".

## Decision

- `generateArtifact` takes an optional `tweak`; a pure `applyRefine(prompt, tweak)` appends it to the built
  prompt ("Refine with this specific direction: …") after the brand-seeded brief. Threaded through the
  `workspaces/studioGenerate` API + the client `generateArtifact(briefId, kind, tweak?)`.
- The studio page has a single **Refine** input applied to every (re)generation — type "make it more playful",
  hit a generate/regenerate, and the direction is honoured.

## Rejected alternatives

- **A per-artifact tweak field.** One shared refine input matches the studio flow (one brief, many artifact
  kinds) and is less clutter; a per-artifact override can be layered later.
- **Edit the brief.** That's the coarse status quo — it changes the whole brief for a one-off refinement.

## Consequences

- Studio outputs are now steerable with a one-off instruction, not just a brief edit — the same iteration
  freedom I1 gave content assets. `applyRefine` is pure + unit-tested.
