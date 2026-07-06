---
id: 0056
title: Voiceover generation — metered path + per-beat timing (F1.3)
status: accepted
date: 2026-07-06
tags: [content, voice, tts, budget, expansion-f13]
supersedes: []
depends_on: [0049, 0051, 0052, 0055]
---

# Voiceover generation (F1.3)

## Context

The `generate` stage turns a Script into a voice asset. This is the first item to run the FULL metered media path end-to-end (budget-check → media gen → asset + spend), and it must produce the per-beat timing the montage (F1.5) needs to align visuals to the narration.

## Decision

1. **`server/content/voice.ts` `generateVoiceover`** runs the whole path: `estimateMediaCostCents('tts')` → `checkMediaBudget` (block BEFORE the paid call) → `runMediaGeneration({feature:'tts', …})` (stub when no key) → a voice `ContentAsset` + a `MediaJob` (linked `resultAssetId`) → `recordMediaSpend`. Returns `{ ok, blocked?, assetId, costCents, stub, totalMs }`.
2. **Budget-check BEFORE gen, via `estimateMediaCostCents`** — a new registry export returning the expected cost so the guard runs before the (paid) call; the actual `result.costCents` is recorded after. A cap hit returns `blocked:true` and runs no gen.
3. **Per-beat timing** — each `Beat` gets a persisted `durationMs` (word-count-derived, min 1.5s), and the voice asset's `metadata` carries `{ totalMs, timing[] }` (cumulative start + duration per beat). Deterministic → testable.

## Rejected alternatives

- **Gen first, then budget-check the actual cost.** Rejected — the guard must precede the paid call; `estimateMediaCostCents` gives the pre-call number (the deterministic stub cost now; a live estimate later).
- **Store timing only on the asset (not the beats).** Rejected — persisting `Beat.durationMs` lets F1.4/F1.5 read timing per beat directly without re-parsing the asset metadata; the asset keeps the aggregate map for convenience.
- **A single tts call per beat.** Rejected — one narration pass over the whole script body is cheaper + more coherent; the timing map slices it per beat.

## Consequences

- New `server/content/voice.ts` + `estimateMediaCostCents` on the media registry + the `content-gen-voice` control-op (B-23, `workTickets`). F1.4 (per-beat image) + F1.5 (assembly) consume the beats' `durationMs` + the voice asset.
- `tests/integration/contentVoice.test.mts` (12 assertions): voice asset + linked MediaJob (elevenlabs) + timing map (4 beats) + persisted beat durations + a spend ledger row + budget debit (2c), AND the budget-BLOCK path (cap hit → no asset, no further debit). First full metered-path proof on dummy data.
