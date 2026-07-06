---
id: 0066
title: TikTok publishing + IG/LinkedIn future-ready (F3.2)
status: accepted
date: 2026-07-06
tags: [content, publish, tiktok, expansion-f32]
supersedes: []
depends_on: [0049, 0065]
---

# TikTok publishing + future-ready platforms (F3.2)

## Context

F3.2 adds TikTok posting (same B-23 gate) + registers Instagram/LinkedIn as future-ready (not built now).

## Decision

TikTok is in `BUILT_PLATFORMS` (established in F3.1's abstraction) — it posts via the same gate + `publishAsset` (dummy, no key). Instagram + LinkedIn stay in `FUTURE_PLATFORMS`: a publish request for them records a `PublishJob(error:'platform.notBuilt')` — visible, never a silent post. No new engine code beyond F3.1's abstraction.

## Rejected alternatives

- **Build IG/LinkedIn posting now.** Deferred per the locked scope — they're future-ready (the abstraction lists them; the adapters land when their APIs + business accounts are set up).
- **A per-platform op.** Rejected — one `content-request-publish` op with a `platform` field covers all; the abstraction gates built-vs-future.

## Consequences

- No new engine code (TikTok was in `BUILT_PLATFORMS` from F3.1). `tests/integration/publishTiktok.test.mts` (5): the abstraction lists youtube+tiktok built / ig+linkedin future; a TikTok publish posts via the gate (dummy). IG/LinkedIn adapters are follow-ups.
