---
title: The per-workspace Gemini key actually drives the text features; media vs AI keys are split honestly
status: accepted
date: 2026-07-07
tags: [ai, providers, gemini, keys, freedom-program]
---

## Context

FREEDOM_PROGRAM item **Q5**. The settings UI collected a Gemini key and stored it encrypted as
`__provider_key_gemini`, but it was **consumed by nothing**: the media loader dropped it (gemini is not a
`MediaProviderId`) and the text `gemini-api` provider read only `process.env.GEMINI_API_KEY`. So a Gemini key
entered in the UI did nothing, and Gemini was misleadingly listed among "media providers". The program also
called for a per-feature media-provider picker — but there is exactly ONE provider per media feature today
(fal / elevenlabs / suno), so a picker would be a useless single-option dropdown.

## Decision

- The `gemini-api` provider now **resolves its key per workspace**: `__provider_key_gemini` (decrypted) WINS
  over the env key, via `getPrismaClient()`. `AiProvider.available` gains an optional `workspaceId`
  (mirroring media's `available(apiKey?)`); `runAiCompletion` passes `req.workspaceId`. So a workspace key
  entered in the UI makes Gemini available + is used.
- The settings keys are split into **Media providers** (fal/elevenlabs/suno) and an **AI text provider**
  (Gemini) so the user understands what each key drives.
- The **per-feature media-provider picker is deferred** (logged): with one provider per feature it has nothing
  to choose. The `__media_provider_<feature>` override branch stays reachable for when alternate providers land.

## Rejected alternatives

- **Remove the Gemini key row.** It IS a real, useful key (the two Gemini text features) — the fix is to
  consume it, not hide it.
- **Build the per-feature provider picker anyway.** A single-option dropdown is UI noise; premium UX means not
  adding a control with nothing to choose. Revisit when a second provider per feature exists.
- **Keep env-only Gemini.** Then a self-hosted per-workspace tenant can't bring its own Gemini key — the whole
  point of the per-workspace encrypted key store.

## Consequences

- A per-workspace Gemini key now powers the script + reference-analysis features (was dead). No key is stored
  and then ignored. The provider-per-feature override remains a reachable seam for future alternate providers.
