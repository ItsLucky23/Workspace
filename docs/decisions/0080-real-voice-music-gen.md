---
id: 0080
title: Real ElevenLabs voice/sfx + Suno music behind available()
status: accepted
date: 2026-07-06
tags: [content, media, elevenlabs, suno, generation, depth-program]
supersedes: []
depends_on: [0072, 0052, 0079]
---

# M2 — write the live voice/sfx/music gen code

## Context

`GAP_ANALYSIS.md` content #2: the ElevenLabs `generate()` returned `media.notImplemented` and music had
no real provider. This item writes the REAL code (mirroring M1's fal pattern) behind `available()`.

## Decision

- **ElevenLabs (voice + sfx):** live `generate()` composes the input (text = style + prompt + extra;
  voice id from params/env), calls the ElevenLabs REST API (tts → `/text-to-speech/<voice>`, sfx →
  `/sound-generation`) which returns raw audio BYTES, and persists them via a new `server/media/store.ts`
  (`data/media/<uuid>.mp3` → a served `/media/...` url). Transport injectable → fixture-tested.
- **Suno (music):** a NEW dedicated provider (`server/media/providers/suno.ts`) — `MediaProviderId`
  gains `'suno'`, registered in the registry, and `music` in the assignments now defaults to `'suno'`.
  Suno returns a HOSTED audio URL (submit → poll → url), so no local persistence. Transport injectable.
- **Shared:** `composeMediaPrompt` moved to `server/media/prompt.ts` (fal re-exports it) so all three
  adapters compose style/extra identically.

## Rejected alternatives

- **Keep music on ElevenLabs.** Rejected — Suno is the purpose-built music model; a dedicated provider
  is the honest architecture (and ADR 0052 already foresaw it).
- **Return raw bytes as the asset URL.** Rejected — an asset needs a resolvable URL; ElevenLabs bytes
  are persisted to the media store (the `/media` HTTP serving is wired in M4/U).

## Consequences

- `store.ts` + `prompt.ts` added; `elevenlabs.ts`/`suno.ts` real; `types`/`registry`/`assignments`
  gain `suno`. `tests/unit/audioProviders.test.mts` (19/19) covers input composition, voice/sfx/music
  assets, typed failures, and the `available()` gates; `mediaRegistry` 18/18 + `falProvider` 19/19
  unaffected. Env-overridable (`ELEVENLABS_*`, `SUNO_*`, `WS_MEDIA_DIR`). Live gen = deferred post-keys e2e.
