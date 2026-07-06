---
id: 0086
title: Content settings — provider keys + €-budget + setup flow
status: accepted
date: 2026-07-06
tags: [content, settings, ui, control-op, depth-program]
supersedes: []
depends_on: [0072, 0084, 0051, 0074]
---

# U3 — a settings form + first-run setup flow, persisting via a control-op

## Context

`GAP_ANALYSIS.md` content #5: the media €-budget was computed but never shown, and there was no way to
enter provider keys or a provider override from the app.

## Decision

- New `save-media-provider` control-op — stores an ENCRYPTED provider API key (`secretBox` → EnvVar
  `__provider_key_<providerId>`, `secret:true`) and/or a per-feature provider override (EnvVar
  `__media_provider_<feature>`). RBAC: `workspaceSettings`. (Per-workspace key CONSUMPTION by the adapters
  is a follow-up; this persists + lets the settings UI show what's configured.)
- A `contentSettings_server_v1.ts` sync route dispatches the workspace-settings content ops
  (edit-media-budget / save-media-provider / save-style), whitelisted, via `dispatchControlSync` (B-23).
  Client methods `editMediaBudget` / `saveMediaProvider` on the ctx.
- `content/settings/page.tsx` — a first-run **setup flow** (guided banner + a link to the KEY_SETUP_GUIDE
  + a money warning), a **provider-key form** (Fal / ElevenLabs / Suno / Gemini; password inputs, never
  shown back), and a media **€-budget form** (enable + cap in € + alert %, prefilled from
  `content.mediaBudget`). Reachable via a Settings button on the content board. i18n ×4; theme tokens only.

## Rejected alternatives

- **Store keys in a new model.** Rejected — the encrypted EnvVar store is sufficient + schema-free (no
  db:push), consistent with the M5 publishing tokens.
- **Show the saved key back for editing.** Rejected — a secret is write-only in the UI (re-enter to
  rotate); the server never returns it.

## Consequences

- `save-media-provider` (union + rbac + conductor) + the sync route + ctx methods + the settings page +
  ~26 more i18n keys. `tests/integration/contentSettings.test.mts` (8/8) proves the encrypted-key round-trip,
  the override, upsert-on-resave, and the budget persist. rbac completeness green. The €-budget is now
  visible + editable; keys can be entered. Consuming per-workspace keys in the adapters is the post-keys follow-up.
