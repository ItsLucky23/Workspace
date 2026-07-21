---
name: per-workspace-media-generation-defaults
title: Move cheap-mode, scene-continuity and default TTS voice from host env to per-workspace media prefs
status: accepted
date: 2026-07-21
deciders: [ItsLucky23]
tags: [multi-tenancy, content, media, secrets, config]
supersedes: []
relates: [0086-content-settings-provider-keys, 0091-media-registry-workspace-keys, 0110-per-workspace-media-model, 0111-per-workspace-gemini-model]
---

## Context

Several media-generation knobs were host-global env-only (`WS_MEDIA_CHEAP`, `WS_SCENE_CONTINUITY`,
`ELEVENLABS_VOICE_ID`), so one deployment could not vary them per tenant even though media provider
keys and per-feature model overrides already resolve per workspace (ADR 0086/0091/0110/0111) via the
encrypted `EnvVar __`-namespace store + `loadWorkspaceMediaConfig` (env as fallback). The owner asked
to pull "as many env settings as sensibly possible" into the per-workspace environment. The question
was where the three workspace-wide (not per-feature) media defaults should live and how they get
written, without adding to the assistant's frozen verb surface (invariant 2).

## Decision

Store the three as workspace-wide plaintext `EnvVar` rows in the same `__`-namespace the media config
loader already reads: `__media_cheap` (`'1'`), `__media_scene_continuity` (`'on'`), `__media_voice_id`
(a public voice id, not a secret). `loadWorkspaceMediaConfig` reads them; `runMediaGeneration` layers
them UNDER the caller's `params` (a per-request param always wins) as `params.cheap` / `params.voiceId`,
and `sceneDecompose` ORs the per-workspace flag with the env default. They are WRITTEN through the
EXISTING `save-media-provider` control-API op — presence-based, so sending only one pref leaves the
others (and provider keys/models) untouched — surfaced in the snapshot as `content.mediaPrefs` and
edited in Content → Settings → Admin. The host env vars remain the fallback. Suno's per-workspace model
needed no backend work — it already flows via `__media_model_music`; only the Admin UI's model-override
list was missing the `music` row.

## Rejected alternatives

- **A new `save-media-settings` control-API op** — rejected: a whole new op/verb + capability mapping +
  effect-matrix row to carry three optional fields that `save-media-provider` (already
  `workspaceSettings`-gated, already classified) writes for free. More surface, no benefit.
- **New `Workspace` schema columns (`mediaCheap`/`sceneContinuity`/`voiceId`)** — rejected: a schema
  change for values that fit the established per-workspace media-config pattern exactly; the `__`-namespace
  store already exists, is encryption-aware, and is skipped by container env injection.
- **Per-workspace embedding key in `server/rag/embed.ts`** — rejected (for now): `embedTag()` stamps every
  callsite to keep index-time and query-time vectors on the same embedder; a per-workspace key would make
  a keyless-but-env-keyed workspace mismatch its own tag and mix 3072-dim Gemini vectors with 256-dim local
  ones. Only the module-load key-freeze bug was fixed (made lazy, mirroring `geminiApi.ts`).

## Consequences

- No new verb/op/entity; the frozen assistant surface is untouched; no effect-matrix change.
- `content.mediaPrefs` is now part of the content snapshot (empty default added server + client side).
- The host env vars stay as documented fallbacks; `.env*` templates note the per-workspace override.
- Fixed alongside: the readiness push probe read the wrong VAPID env names (`WORKSPACES_VAPID_*` →
  `WS_VAPID_*`), so it could report push mis-configured while push worked (or vice-versa).
- Revisit the embedding-key rejection if per-workspace RAG isolation ever needs BYO-key embeddings —
  that requires threading `workspaceId` through every `embedTag()` callsite first.
