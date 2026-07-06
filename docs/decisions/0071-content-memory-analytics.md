---
id: 0071
title: Per-channel brand-RAG + content-analytics (F5.1)
status: accepted
date: 2026-07-06
tags: [content, rag, brand, analytics, expansion-f51]
supersedes: []
depends_on: [0049, 0045, 0047]
---

# Per-channel brand-RAG + content-analytics (F5.1)

## Context

The final item: a per-channel brand/style memory (so a channel's generations stay on-brand) + a content-analytics fold (what ships, where pieces sit, the metered cost).

## Decision

1. **Per-channel brand memory** (`server/content/brandMemory.ts`) reuses the SINGLE unified RAG store + `retrieve()` under a per-channel sentinel commit `brand:<channelId>` (mirrors the institutional-memory sentinel, ADR 0045). `indexChannelBrand` (re-)indexes a channel's brand snippets; `retrieveChannelBrand` retrieves them for that channel only — no parallel index, no cross-channel leakage.
2. **A PURE content-analytics fold** (`server/content/contentAnalytics.ts` `computeContentAnalytics`) over pieces + media spend + publish jobs → `totalPieces`, `doneCount`, `publishedCount`, `byStage`, `byFormat`, `totalCostCents`, `costByFeature`. Deterministic → testable; views/CTR are placeholders until platform keys land.

## Rejected alternatives

- **A separate brand vector store / index path.** Rejected — ADR 0045 mandates ONE store + one `retrieve()`; a sentinel commit scopes brand rows without a parallel path (same decision as institutional memory).
- **A stateful analytics rollup.** Rejected — a pure fold over the existing rows (like delivery-analytics, ADR 0047) is cheap + testable; no new write path.
- **Global (workspace-wide) brand memory.** Rejected — brand is PER-CHANNEL (each channel has its own voice); the per-channel sentinel keeps them isolated.

## Consequences

- New `server/content/brandMemory.ts` + `server/content/contentAnalytics.ts`. Brand retrieval conditions a channel's gens (wired at the gen call site as a follow-up); the analytics fold is ready for a per-channel dashboard. **Closes the Content Platform Program (F5.1 = the last item).**
- `tests/integration/contentMemory.test.mts` (12): the analytics fold (archived excluded, done/published counts, by-format, cost-by-feature folding) + brand index/retrieve round-trip with per-channel isolation. Follow-ups: live views/CTR when platform keys land; wiring brand retrieval into every content gen.
