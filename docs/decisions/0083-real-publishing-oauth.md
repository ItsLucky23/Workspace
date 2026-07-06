---
id: 0083
title: Real YouTube + TikTok publishing (OAuth + upload) behind the B-23 gate
status: accepted
date: 2026-07-06
tags: [content, publishing, oauth, youtube, tiktok, depth-program]
supersedes: []
depends_on: [0072, 0065, 0074]
---

# M5 — real posting on accept, not a fake url

## Context

`GAP_ANALYSIS.md` content #4: YouTube/TikTok "posts" were fake `stub://` urls — no OAuth, no upload.

## Decision

- New `server/content/publishOAuth.ts`: PURE request builders — `buildAuthUrl` (connect redirect),
  `buildExchangeRequest` (code→token), `buildUploadRequest` (YouTube resumable init / TikTok
  PULL_FROM_URL, bearer auth) — plus `parseTokenResponse` (flat + TikTok-nested). Transports wrap them
  with fetch (injectable; the live round-trip is the deferred post-keys e2e).
- **Token storage** is ENCRYPTED via `secretBox` in the per-workspace `EnvVar` store (`__publish_<platform>`,
  `secret:true`) — no schema change, so no `db:push`/backend-kill. `connectPublishPlatform` exchanges the
  code + stores; `getConnection` decrypts.
- `publishAsset` now runs a REAL upload with the decrypted token when the workspace is connected; a missing
  connection OR an upload failure degrades to the dummy post (never loses the consented intent). The B-23
  gate is unchanged: `publishAsset` still only runs after a publish suggestion is accepted (Conductor).

## Rejected alternatives

- **A dedicated `PublishConnection` model.** Rejected for this round — it would force a `db:push` (kill the
  shared backend); the encrypted EnvVar store is sufficient and schema-free. A dedicated model is a possible
  future refinement.
- **Fail the publish when not connected.** Rejected — the dummy post keeps the pipeline usable without keys;
  the user's near-term output is the downloadable asset they post manually.

## Consequences

- `publishOAuth.ts` added; `publish.ts` does real uploads behind the gate. `tests/unit/publishOAuth.test.mts`
  (17/17) covers the builders + parsing; `tests/integration/publishReal.test.mts` (12/12) covers the encrypted
  token round-trip, connect, real-upload-when-connected, and stub-degrade. `publish`/`publishTiktok` (stub
  path) unaffected. Env: `YOUTUBE_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`. The OAuth callback HTTP route +
  the live browser round-trip are the post-keys e2e (documented in the KEY_SETUP_GUIDE, D1).
