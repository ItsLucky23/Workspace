---
title: Named design looks + references in the agent prompts
status: accepted
date: 2026-07-09
tags: [design, agent-context, rag, grounding, ai-libraries-accounts]
---

## Context

The `design-system` context-doc the coding agent reads carried ONLY the active theme + style, so a ticket
"build the dropdown in the Apple style" couldn't ground on Apple unless Apple was the active system. And the
content-script prompt's best-practices/reference injection was retrieval-tested but the INJECTION itself was
never asserted (stub mode discards the prompt). The user wants named references always available in prompts.

## Decision

- **A named-looks catalog in the design-system doc.** `buildDesignSystemDoc` now appends a catalog of every
  named look — the built-in premades (apple/material/…) AND the workspace's saved themes/styles — with each
  look's distinguishing tokens (primary/bg/text colours, radius, fonts, motion). So the agent can build in ANY
  named look, not just the active one.
- **Premades come from a compiled JSON.** `scripts/generateDesignPremades.mjs` reads the client premade
  definitions (they only import types, so a tsx script can load them) → `docs/AI_DESIGN_PREMADES.json`, which
  the server reads. No client→server duplication; regenerate with `npm run ai:design-premades`.
- **The doc exists from day one.** `rebuildDesignSystemDoc` is seeded on workspace creation and refreshed on
  every save/delete/setActive (not only setActive), so the named looks are available even before the user opens
  the Designer, and saved looks join/leave the catalog immediately.
- **`generateScript.complete` is injectable** so a test captures the composed system prompt and PROVES the
  best-practices + inspiration references are injected (closing the coverage gap the review flagged).

## Rejected alternatives

- **Seed all 8 premades as DesignArtifact rows per workspace.** 16 rows/workspace of duplicated data; the
  static JSON catalog gives the same grounding with zero DB rows and one regenerable source of truth.
- **Full 30-token dump per premade in the doc.** Too heavy for every stage's context; the compact
  distinguishing-token line is enough to build recognizably, and applying a look promotes it to the full active
  system section.

## Consequences

- "Apple style dropdown" now grounds on Apple's real tokens (#3B82F6 primary, soft radii, its fonts) from any
  workspace, and the content AI provably grounds scripts on best-practices + the workspace's inspiration
  references. Proven: designSystemCatalog 6/6 (premades + saved looks in the doc, seeded on create),
  scriptGrounding 4/4 (spy confirms injection). References are now always in both agent prompts.
