---
title: D1 — the real YouTube byte-upload (resumable, all three legs)
status: accepted
date: 2026-07-08
tags: [publish, youtube, upload, honesty, idea-to-outcome]
---

## Context

The audit's sharpest finding: a real YouTube publish never worked, even WITH OAuth keys. `realUploadTransport`
did only the resumable INIT (a POST that returns the session URI in its `Location` header + an empty body), then
read a video `id` from that empty body — always empty → null → the honesty-fixed publish (ADR 0144) recorded it
as an `error`/stub. The actual video bytes were never sent. IDEA_TO_OUTCOME D1 closes that gap so a user with a
real Google OAuth app can actually post a video.

## Decision

- **All three legs of the resumable upload.** `youtubeResumableUpload`: (1) POST the metadata (the existing
  `buildUploadRequest` init, which carries `X-Upload-Content-Type` so YouTube returns a session URI) and read
  the `Location` header; (2) read the video bytes; (3) PUT the bytes to the session URI and read the video `id`
  from the response. Any leg failing → null → the publish is an honest error (never a fake success).
- **`buildResumablePut(sessionUri, accessToken)`** — a pure, exported builder for leg 3 (the transport attaches
  the byte body), unit-tested alongside the init builder.
- **`readAssetBytes(assetUrl)`** — reads a local `/media/<file>` from the media store or fetches an http(s)
  URL; a `stub://`/unknown url yields null (not uploadable). So a real rendered mp4 in the media store uploads
  directly, without needing a public URL.
- **TikTok stays a single init** (PULL_FROM_URL); its status-polling + confirmed url is D2.

## Rejected alternatives

- **Keep reading `id` from the init body.** That was the bug — a resumable init has no body; the id only exists
  after the bytes are PUT.
- **Multipart/`uploadType=multipart` in one request.** Resumable is the robust path for large video (retryable,
  no size cap), and the init/PUT split is exactly what the pure builders + injected transport can test.
- **Require a public asset URL (like TikTok).** YouTube takes the bytes directly, so a local `/media` render
  posts without hosting it first — one less dependency.

## Consequences

- With a real Google OAuth app + a rendered mp4, a YouTube publish now actually uploads the bytes and returns a
  real `watch?v=` url; without a connection/keys it is still an honest stub/error (ADR 0144). The pure builders
  are unit-tested (init + PUT shape); the live 3-leg round-trip is the opt-in post-keys e2e. Next (D2): TikTok
  status polling + a publicly-reachable media url; (D3) the demo-host so `main` runs on a DNS.
