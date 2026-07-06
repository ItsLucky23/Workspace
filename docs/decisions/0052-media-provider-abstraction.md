---
id: 0052
title: Media provider abstraction + stub adapters (F0.3)
status: accepted
date: 2026-07-06
tags: [content, ai-provider, media, stub, expansion-f03]
supersedes: []
depends_on: [0049, 0007, 0050]
---

# Media provider abstraction + stub adapters (F0.3)

## Context

The content lane generates ASSETS (images/video/voice/…), not text. The existing AI-provider abstraction (ADR 0007, `server/ai/*`) is text-completion-shaped (`AiCompletionResult.text`). Media needs the same *pattern* (features resolve to a provider; no feature hardcodes a backend) but a different *result shape* (an asset + a metered € cost). No API keys exist yet — the whole pipeline must run on dummy data.

## Decision

1. **A parallel MEDIA layer** in `server/media/` mirroring `server/ai/`: `MediaFeature` (`image-gen`, `reference-image`, `video-gen`, `tts`, `music`, `sfx`, `avatar`, `model-3d`), `MediaProviderId` (`fal`, `elevenlabs`), `MediaGenerationRequest`/`Result` (asset + `costCents` + `stub` flag), `MediaProvider` interface, `DEFAULT_MEDIA_ASSIGNMENTS` + `resolveMediaAssignment` (per-workspace override seam), and `runMediaGeneration(req, overrides)` dispatch.
2. **Registry-level STUB fallback.** Each adapter's `available()` is false until its key env is present; when unavailable, `runMediaGeneration` returns a valid-SHAPED stub asset (`stub://<kind>/<feature>/<style>`) + a realistic declared `costCents` (video » image » voice). So the entire content pipeline runs end-to-end on dummy data, and the €-budget guard (F0.2) is exercised — without any keys.
3. **`reference-video-analysis` stays a TEXT `AiFeature`** on `gemini-api` (extends `server/ai` union + `DEFAULT_ASSIGNMENTS`) — it returns a beat/style BLUEPRINT (text/structured), not an asset, so it belongs with the text abstraction, not the media one.

## Rejected alternatives

- **Add the media features to the existing `AiFeature`/`AiProviderId` union (one registry).** Rejected — media results are assets, not `text`; forcing them through `runAiCompletion`/`AiProvider.complete` would mean a `text`-shaped hack and mixing media providers into the text `PROVIDERS` map. A parallel layer mirroring the pattern is SOLID (7a) and keeps the text abstraction + its tests intact. *(A conscious deviation from the doc's literal "extend AiFeature" wording — surfaced per Rule 3b; the doc's intent, "media via the provider-abstraction philosophy with stub/defaults/override", is honoured.)*
- **Per-adapter stub mode.** Rejected — a single registry-level stub fallback keeps every feature's dummy shape consistent and in one place; adapters stay thin (`available` + the future live `generate`).
- **Remotion / a `gemini-media` as MediaProviders.** Rejected — Remotion is the ASSEMBLY/render path (F1.5), not a prompt→asset gen; `reference-video-analysis` is a text feature. Neither is a media-gen provider.

## Consequences

- New `server/media/{types,assignments,registry}.ts` + `server/media/providers/{fal,elevenlabs}.ts`; `reference-video-analysis` added to `server/ai/{types,assignments}.ts`. The content pipeline (F1.x) calls `checkMediaBudget` → `runMediaGeneration` → `recordMediaSpend`.
- Avatar (HeyGen) + music (Suno) get dedicated providers later; they default to fal/elevenlabs now. Live `generate` for fal/elevenlabs is a keyed follow-up (gated off by `available()`).
- `tests/integration/mediaRegistry.test.mts` (18 assertions): defaults + override, stub asset shape + cost + style/extra/reference flow-through, video>image cost, unsupported-provider rejection, and reference-video-analysis→gemini. `aiRegistry.test` stays green (12) with the new text feature.
