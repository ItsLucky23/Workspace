---
id: 0065
title: Publishing behind the B-23 approval gate + YouTube (F3.1)
status: accepted
date: 2026-07-06
tags: [content, publish, youtube, b-23, expansion-f31]
supersedes: []
depends_on: [0049, 0054]
---

# Publishing behind the B-23 approval gate (F3.1)

## Context

Posting to a real channel is irreversible + public — the exact case B-23 reserves for an explicit human confirm. F3.1 builds publishing behind that gate, with a platform-adapter abstraction + a YouTube adapter (dummy, no key).

## Decision

1. **`content-request-publish` creates a publish SUGGESTION** (`WorkspaceSuggestion(type:'publish', patch:{contentProjectId, assetId, platform})`) — it does NOT post. Accepting it (`accept-suggestion` → the new `'publish'` branch) makes the **Conductor** call `publishAsset` (the only writer of the `PublishJob`). The AI never publishes.
2. **A platform abstraction** (`server/content/publish.ts`) with `BUILT_PLATFORMS` (youtube, tiktok) + `FUTURE_PLATFORMS` (instagram, linkedin). A built platform with no key → a **dummy post** returning a `stub://<platform>/<asset>` external url; a future-ready platform → a `PublishJob(status:error, error:'platform.notBuilt')` (recorded, not posted).
3. **A `PublishJob` model** records each post (platform, status, externalUrl, error).

## Rejected alternatives

- **A `CONFIRM_REQUIRED` op instead of a suggestion.** Rejected — the doc specifies an approval SUGGESTION (surfaced phone-first, acceptable async); the suggestion carries the full patch + shows the "public + hard to undo" warning. (Both are B-23-valid; the suggestion fits the man-in-the-middle flow.)
- **Post directly on `content-request-publish`.** Rejected — that skips the gate; publishing MUST wait for explicit consent.
- **Silently ignore a future-ready platform.** Rejected — recording a `platform.notBuilt` PublishJob makes the gap visible (no silent no-op).

## Consequences

- New `PublishJob` model + `server/content/publish.ts` + the `content-request-publish` op + the `accept-suggestion` `'publish'` branch. Added `publishJob` to `cleanupWorkspace`. F3.2 moves TikTok into BUILT + adds IG/LinkedIn as future-ready.
- `tests/integration/publish.test.mts` (8): request → a suggestion (no post), accept → a done YouTube PublishJob (stub url) + suggestion accepted, a future platform (linkedin) → `platform.notBuilt`. rbac 122/122.
