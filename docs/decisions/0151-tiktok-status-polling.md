---
title: D2 — TikTok async publish (status polling)
status: accepted
date: 2026-07-08
tags: [publish, tiktok, honesty, idea-to-outcome]
---

## Context

The audit found the TikTok publish fabricated a url: it did the `PULL_FROM_URL` init, got a `publish_id`, and
returned `tiktok.com/@me/video/<publish_id>` with NO confirmation — but a `publish_id` is a job id, not a post
id, and TikTok publishes asynchronously (the post only exists once the status endpoint reports complete).

## Decision

- **Poll the status endpoint until confirmed.** `tiktokUpload`: init → `publish_id` → poll
  `/post/publish/status/fetch/` (bounded, `TIKTOK_POLL_ATTEMPTS`) until `PUBLISH_COMPLETE`, then build the url
  from the CONFIRMED public post id. `FAILED` or not-confirmed-within-the-window → null (an honest error, per
  ADR 0144) — never a fabricated url.
- **Pure builders/parser:** `buildTiktokStatusRequest(publishId, accessToken)` and `parseTiktokStatus(json)`
  (status enum + the public post id), unit-tested. The `sleep` between polls is injected so the live poll waits
  without affecting tests (which inject the whole transport).

## Rejected alternatives

- **Return the url optimistically after init.** That is exactly the fabricated-success the audit flagged; the
  post may never actually publish.
- **Block indefinitely until complete.** The leader loop can't hang on one publish; a bounded poll that returns
  an honest "not confirmed" (null) is safer. (A durable async publish-job that resumes polling is a future
  improvement, noted — the current window covers the common fast case.)
- **A public asset URL requirement is unchanged** — TikTok's `PULL_FROM_URL` still needs the media reachable
  (that's D3's demo-host / a CDN); D2 only fixes the confirmation.

## Consequences

- A TikTok publish now only reports success with a real, confirmed post url; an unconfirmed/failed publish is an
  honest error. Combined with D1 (YouTube byte-upload) the publish leg is real for both built platforms
  (given OAuth + a reachable asset). Pure status shape is unit-tested; the live poll is the opt-in post-keys
  e2e. Known limitation logged: a very slow TikTok publish that exceeds the poll window reports unconfirmed.
