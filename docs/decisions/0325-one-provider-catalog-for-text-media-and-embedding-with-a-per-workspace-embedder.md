---
id: 0325
title: One provider catalog for text, media and embedding, with a per-workspace embedder
status: accepted
date: 2026-08-24
tags: [ai, providers, rag, settings, migration]
supersedes: []
---

## Context

AI providers were configured on ~5 unrelated levels: the text catalog (`AI_PROVIDER_CATALOG` +
AiConnection rows), the media keys (`__provider_key_<fal|elevenlabs|suno>` EnvVars behind a
content-settings KeysCard), the per-feature media overrides, the RAG embedder (host-global
`GEMINI_API_KEY` with a silent local fallback), and assorted host env fallbacks. The owner's ask
(2026-08-23): *"embedder per workspace vast stellen en alle providers op 1 niveau vast stellen en
niet op 5 plekken."* The scatter also produced the F-001 class of defect — a key that "saves" into a
store nothing reads.

## Decision

- **One catalog.** `AI_PROVIDER_CATALOG` carries every backend with a `surface: 'text' | 'media' |
  'embedding'` discriminator. Media (`fal`, `elevenlabs`, `suno`) and embedding (`gemini-embedding`,
  `local-embedding`) entries use marker transports (`media-adapter`, `embedding`) that the text
  dispatch filters out everywhere (registry, candidates, readiness, model listing, override parsing
  via `parseAiOverride(value, surface)`).
- **One key store.** AiConnection holds text + media + embedding keys. `save-media-provider`'s key
  shape writes an AiConnection; `loadWorkspaceMediaConfig` reads connections first, legacy EnvVars as
  fallback; boot runs the idempotent `migrateLegacyMediaKeys` (legacy rows left in place — deleting
  secrets is not a migration's call). Content-settings' KeysCard is replaced by a pointer card
  deep-linking to Workspace → AI → Backends. `ai-connection-test` dispatches per surface (text ping /
  media adapter ping / a real 1-text embed probe).
- **Per-workspace embedder.** EnvVar `__ai_provider_embedding` (via the existing save-ai-provider op,
  surface-validated) picks `gemini-embedding[:model]` or `local-embedding`. Every RagEntry is stamped
  with the ACTUAL producing embedder (`embedTag`, '' = legacy host rows); `retrieve()` only compares
  rows whose tag matches the current embedder, so a switch honestly yields "re-index needed" instead
  of garbage cosine scores across incompatible vector spaces. No stored choice ⇒ exact legacy host
  behavior.

## Rejected alternatives

- **A separate media/embedding settings model** — keeps the 5-level scatter that caused F-001.
- **Auto-deleting legacy `__provider_key_*` EnvVars in the migration** — destroying secrets on boot
  is irreversible; the fallback read is safe and the rows die with the workspace.
- **Letting vectors from different embedders compare** — cosine between different embedding spaces is
  meaningless; silently returning wrong retrievals is worse than an explicit re-index gate.
- **A new control-op for the embedder** — invariant 2 (frozen verb surface): the existing
  save-ai-provider op re-expresses it with `feature: 'embedding'`.

## Consequences

- The settings page groups connections by surface and gained an embedder section with a re-index
  warning; the AddConnection picker offers all connectable backends (model row hidden for media).
- Readiness reads keyed connection ids first, legacy EnvVars second, env vars third — the same order
  the runtime resolves.
- Switching embedders gates retrieval until re-index; the sources page drives the rebuild.
- `//? @adr 0325` governs `server/ai/providers/catalog.ts`, `server/ai/connections.ts`,
  `server/rag/embed.ts`.
