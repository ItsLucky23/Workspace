---
title: A per-workspace AI provider-per-feature picker finally feeds the resolveAssignment override seam
status: accepted
date: 2026-07-07
tags: [ai, providers, freedom-program]
---

## Context

FREEDOM_PROGRAM item **P1**. `resolveAssignment(feature, overrides)` was built to accept a per-workspace
override map, but the `overrides` arg was **never fed** at any of the 13 `runAiCompletion` call sites — the
seam was inert, and there was no UI. So every feature was locked to its hardcoded default provider.

## Decision

- A per-workspace override is stored as an EnvVar `__ai_provider_<feature>` (mirrors the media
  `__media_provider_<feature>` store), loaded by `loadWorkspaceAiOverrides` and **merged inside
  `runAiCompletion`** UNDER any explicit call-site override: `resolveAssignment(feature, { ...wsOverrides,
  ...overrides })`. This feeds the seam at ONE point — no call-site changes.
- A `save-ai-provider` control-op + a `_sync` route (returns the full override map → `snap.aiOverrides`), and a
  per-feature provider Dropdown in the AI settings tab for the curated non-coding features (Default / Claude /
  Gemini).

## Rejected alternatives

- **Pass overrides at each call site.** 13 features would each need to load + pass the map — duplication; the
  registry choke-point does it once (same shape as the Q4/K4 prefix + P-media key loading).
- **Expose every AiFeature in the picker.** The coding + chat features are subscription-billed Claude PTY by
  design (PTY-billing invariant); a picker for them invites a foot-gun. Curated to the reasoning/creative
  features where Claude↔Gemini is a real, safe choice.
- **A dedicated model table row.** Provider choice is coarser than model/param tuning (P2) — kept separate.

## Consequences

- A workspace can now steer which backend runs each reasoning/creative feature (e.g. Gemini for scripts, Claude
  for reasoning) from the UI; an explicit test/override still wins. Model + param tuning (temperature, model
  version, effort) is the next item (P2).
