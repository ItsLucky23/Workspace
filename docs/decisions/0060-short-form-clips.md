---
id: 0060
title: Short-form clip generation (F2.2)
status: accepted
date: 2026-07-06
tags: [content, video, short-form, expansion-f22]
supersedes: []
depends_on: [0049, 0052, 0056]
---

# Short-form clip generation (F2.2)

## Context

A short-form (TikTok/Shorts/Reels) clip is a single hook-driven vertical video, distinct from the assembled faceless-explainer. F2.2 generates it via `video-gen` (stub) with a hook + captions.

## Decision

`server/content/shortForm.ts` `generateShortForm` runs the metered path (`checkMediaBudget('video-gen')` → `runMediaGeneration({feature:'video-gen'})` stub → video `ContentAsset` + `MediaJob` + spend), derives a `hook` + `captions` from the prompt (stub; a live hook-writer lands with keys), and stores them on the asset metadata (`format:'short'`). Driven by `content-gen-shortform` (B-23, `workTickets`, requires a `prompt`).

## Rejected alternatives

- **Route short-form through the assembly pipeline (script→voice→images→render).** Rejected — a short clip is one video-gen call + a hook, not a multi-beat assembly; it's a distinct, faster path.
- **A separate caption/hook AI feature now.** Deferred — the stub derives them from the prompt; a dedicated hook-writer (a text feature) is a keyed follow-up.

## Consequences

- New `server/content/shortForm.ts` + `content-gen-shortform` op. `tests/integration/shortForm.test.mts` (9): video clip (fal), hook + captions, `format:short`, style applied, budget 40c, block path. rbac 122/122.
