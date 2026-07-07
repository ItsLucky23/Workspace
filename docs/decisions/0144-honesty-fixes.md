---
title: Honesty fixes — stop reporting stub uploads/renders as success; real claude-CLI check; a live render proof
status: accepted
date: 2026-07-08
tags: [content, publish, render, trust, testing, freedom-program]
---

## Context

A 5-agent audit found the product's biggest "looks-done-but-isn't" risk: several paths returned a fake success.
A publish with no connection (or a failed upload) was recorded `PublishJob.status:'done'` with a `stub://` url;
a render that couldn't run (no keys/Docker) was recorded `ContentAsset.status:'ready', downloadable:true` with a
`stub://render/...` url — a fake finished video; `claudeCli.available()` returned true whenever the bin was the
bare name `'claude'`, even with the CLI not installed. And the whole suite runs against stubs with keys actively
unset, so nothing proved a real artifact.

## Decision

- **Publish honesty:** `performUpload` returns a discriminated `real | stub | error`. A not-connected publish →
  `PublishJob.status:'stub'` (a dummy, `ok:false`); a connected-but-**failed** upload → `status:'error'`
  (previously swallowed into a fake `done`). Only a real post → `done`.
- **Render honesty:** a stub render → `ContentAsset.status:'error'`, `downloadable:false`, and `RenderJob.status:
  'error'` — it no longer masquerades as a `ready`, `downloadable` video.
- **claude-CLI honesty:** `available()` now actually resolves the binary — `existsSync` for a path, a real
  `--version` probe (PATH-resolved, cached) for a bare name — so a not-installed CLI reports unavailable.
- **A real proof:** `tests/live/renderLive.live.mts` (opt-in) generates real fal images + runs the real
  ffmpeg-in-Docker render and asserts a non-`stub://`, on-disk, non-trivial `.mp4`. It SKIPs cleanly without
  FAL_KEY/Docker (so it's safe to run anywhere) and only ASSERTS when it can genuinely prove a real video.

## Rejected alternatives

- **Keep stub-as-done for a "green pipeline".** That is exactly the dishonesty the audit flagged — a green
  pipeline that ships fake videos + fake posts is worse than an honest error.
- **Rip out the stub path.** The stub is legitimate for dev/no-keys; the fix is to LABEL it honestly (status
  reflects reality), not remove it.

## Consequences

- The UI + any consumer can now trust the status: `done` = a real post/render, `stub` = a dummy (no
  connection/keys), `error` = a real failure. The updated stub tests assert the honest states (a failed upload
  is an error, a stub render is not downloadable). A real end-to-end video is provable via the opt-in live test.
  The deeper gaps (real multi-clip video, the YouTube byte-upload, greenfield, the conversational orchestration)
  remain the next big build.
