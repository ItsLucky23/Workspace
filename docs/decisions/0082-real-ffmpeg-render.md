---
id: 0082
title: Real ffmpeg (Docker) render pipeline + media download route
status: accepted
date: 2026-07-06
tags: [content, render, ffmpeg, docker, download, depth-program]
supersedes: []
depends_on: [0072, 0049, 0080]
---

# M4 — assemble beats+images+voice into a real mp4; stream it

## Context

`GAP_ANALYSIS.md` content #3: assembly was a DB row + a fake `stub://render/...` URL — no Remotion, no
ffmpeg, no real file, and no way to download the result.

## Decision

- New `server/content/render.ts`: `buildFfmpegPlan` (pure) builds an ffmpeg **concat-demuxer** slideshow
  (one image per beat for its duration, last image repeated per the demuxer quirk) + an optional audio
  track (h264/yuv420p, scaled/padded to 1280×720, `-shortest`). `renderTimeline` localizes each asset
  (a `/media/<file>` used directly, an http(s) URL downloaded + persisted, a `stub://` URL not
  renderable), writes the concat list, and runs ffmpeg **in a Docker container** (`jrottenberg/ffmpeg`,
  MEDIA_DIR mounted at `/media`). The runner is injectable for tests. No hosted API → costCents 0.
- **Degrade, don't fail:** when nothing is renderable (dummy `stub://` assets) or ffmpeg/Docker is
  unavailable, `renderTimeline` returns a typed `ok:false` and `assembleContent` falls back to the
  valid-shaped stub render asset — the dummy pipeline stays green without Docker/keys.
- New `server/media/download.ts` — `GET /media/<uuid-file>` streams a produced media file (M2 audio +
  the render mp4) from the store; the unguessable uuid filename is the capability, with a hard
  path-traversal guard (`safeMediaPath`). Registered at boot (origin-exempt, like the build download).

## Rejected alternatives

- **Remotion (the original comment).** Rejected — never added; ffmpeg-in-Docker matches the accepted
  Docker-dependency, needs no Node render server, and is a smaller surface.
- **A token table for media files (like build downloads).** Deferred — the uuid filename is already
  unguessable; stricter per-workspace auth on `/media` is a U3 follow-up.

## Consequences

- `render.ts` + `media/download.ts` added; `assembly.ts` attempts the real render then degrades; the
  route is registered in `server.ts`. `tests/unit/render.test.mts` (18/18) covers the ffmpeg plan, the
  no-image degrade, the `/media` traversal guard, and asset localization. `contentAssembly` 11/11 (stub
  degrade) unaffected. Env: `WS_FFMPEG_IMAGE`, `WS_MEDIA_DIR`. A real ffmpeg run over real assets is the
  deferred post-keys e2e.
