---
id: 0058
title: Assembly / render — the complete downloadable output (F1.5)
status: accepted
date: 2026-07-06
tags: [content, assembly, remotion, render, expansion-f15]
supersedes: []
depends_on: [0049, 0056, 0057]
---

# Assembly / render (F1.5)

## Context

The final `assemble` stage composes a piece's beats (+ their images) + the voiceover into the COMPLETE downloadable output. This closes Fase 1 — the content pipeline produces a finished asset end-to-end. No keys, so the render is a stub; the render itself is Remotion (local CPU), not a metered API.

## Decision

1. **`server/content/assembly.ts` `assembleContent`** builds a Remotion timeline (`{ order, text, imageAssetId, durationMs }` per beat, over the voice asset, `totalMs` summed), writes a `RenderJob` (`composition:'faceless'`, `status:'done'`), and produces the final `ContentAsset` (`kind:'render'`, `metadata.downloadable=true` + `hasVoice`/`hasAllImages`/`beatCount`/`totalMs`), linking `RenderJob.resultAssetId`.
2. **Local render is FREE (`costCents:0`)** — Remotion renders on CPU, not a metered media API, so it does NOT debit the €-budget (only the gen calls do: voice + images). This keeps the cost model honest.
3. **The render asset IS the deliverable** — its `stub://render/<piece>` url + `downloadable` flag is the complete output the user downloads + posts manually (the primary near-term path). A real HTTP download route is F3.3.
4. Driven by the `content-assemble` control-op (B-23, `workTickets`).

## Rejected alternatives

- **Debit the budget for the render.** Rejected — Remotion is local CPU; only metered API gens (voice/images/video) cost €. Charging for the render would double-count / misprice.
- **Render per beat then concatenate.** Rejected — one composition over the full timeline is how Remotion works; per-beat clips are the timeline entries, not separate renders.
- **Skip the RenderJob row (just make the asset).** Rejected — a `RenderJob` gives the render its own status/provenance/cost trail (like `MediaJob` for gens), needed when a live renderer + progress lands.

## Consequences

- New `server/content/assembly.ts` + the `content-assemble` op. **Fase 1 is complete** — a piece runs script → voice → images → assemble into a downloadable output, all metered + style-driven, on dummy data.
- `tests/integration/contentAssembly.test.mts` (11 assertions) is the Fase-1 DoD proof: the full pipeline end-to-end → a render asset (downloadable, has voice + all images, 4 beats, duration), a done RenderJob (linked, free), total metered spend voice(2)+images(16)=18. F3 adds the HTTP download + publish; F2 adds the other modalities.
