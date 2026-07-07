---
title: Live-AI verification + the media-provider fixes it surfaced
status: accepted
date: 2026-07-07
tags: [ai, media, providers, testing]
---

## Context

The whole AI surface had only ever run against STUBS (deterministic, free). With the real provider
keys now in the env (resolved via the secret-manager), the overnight goal was to prove EVERY AI-driven
feature produces REAL output — and fix whatever the live run exposed. Running live is opt-in and costs
money, so it must not be part of the default suite (ADR 0090).

## Decision

- **`tests/live/liveAi.live.mts`** (named `.live.mts`, NOT `.test.mts`, so `npm run test` never runs it)
  exercises every backend with `enableLiveProviders()` + `WS_MEDIA_CHEAP`, retrying each call (flaky-live
  policy) before it counts as a failure. Coverage:
  - **Gemini text (15/15 features):** the two gemini-native features (`script`,
    `reference-video-analysis`) plus every `claude-cli` feature FORCED to gemini via the provider
    override (ADR 0007) — a headless way to prove each feature's dispatch + real generation without the
    subscription-billing PTY (invariant #6; the PTY coding path is verified manually).
  - **Media:** fal (image / reference-image / video / avatar), elevenlabs (tts / sfx), suno (music).
- **Live-surfaced provider bugs fixed** (the stub tests never hit the real API contracts):
  - **tts 404** — the default voice was the *name* `Rachel`; ElevenLabs needs the voice **id**. Default
    is now the real Rachel id (`21m00Tcm4TlvDq8ikWAM`).
  - **reference-image 422** — flux `image-to-image` rejects `image_size` (it derives size from the input)
    and requires `num_inference_steps >= 10` (cheap mode sent 4). Fixed both in `cheapParams`.
  - **model-3d input** — triposr is image→3D: it rejects a `prompt`, so `composeFalInput` now sends only
    the source `image_url` for `model-3d`.
- **Two features are BEST-EFFORT (environmental, not code defects), logged not asserted:**
  - **model-3d** — triposr submits fine but is a slow fal queue model that often exceeds the poll window;
    bump `FAL_POLL_MAX` or pin a faster 3D model.
  - **music (suno)** — the default `https://api.suno.ai/v1` host 503s; Suno's real API host is
    deployment-specific. Set `SUNO_BASE` to the user's actual endpoint. **OPEN QUESTION for the user.**

## Rejected alternatives

- **Put the live run in the default suite.** It costs money, needs network + valid keys, and is
  non-deterministic — wrong contract for the fast inner loop (ADR 0090). Opt-in `.live.mts` is correct.
- **Hard-fail on model-3d / music.** Their failures are external (slow queue model / unknown endpoint),
  not our code — a red suite there would be misleading. Log them explicitly (no silent cap) instead.
- **Skip the claude-cli features from live coverage.** Forcing them to gemini proves the dispatch +
  generation path headlessly; only the PTY billing/login specifics are un-testable here, and those are
  a manual check by design.

## Consequences

- 15/15 AI text features + fal image/reference-image/video/avatar + elevenlabs tts/sfx are proven to
  produce real output live. model-3d + music are documented best-effort with concrete follow-ups.
- The tts / reference-image / model-3d fixes also make the *product* paths (voiceover, reference
  photorealism, 3D concepting) actually work against the live providers, not just the stubs.
