---
title: Publishing is reachable via an OAuth connect flow + an in-app publish trigger
status: accepted
date: 2026-07-07
tags: [content, publishing, oauth, http, b-23]
---

## Context

M5 (ADR 0083) built the *server* half of YouTube/TikTok publishing — `buildAuthUrl`, the code→token
exchange, encrypted per-workspace token storage, `connectPublishPlatform`, and `publishAsset`. But it
was **unreachable from the app**: there was no OAuth-callback HTTP route (so a user could never
complete a connect) and no UI to request a publish (the `content-request-publish` op needs an
`assetId` the UI never supplied). Publishing existed but nothing could invoke it (FIX-C).

## Decision

Two HTTP routes + two UI affordances close the loop:

- **`GET /content/oauth/<platform>/start?ws=<id>`** — session-authed + `workspaceSettings`-gated; 302s to
  the platform consent screen with an encrypted `state`.
- **`GET /content/oauth/<platform>/callback?code&state`** — origin-exempt (an external redirect has no
  Origin); decodes the state, exchanges the code, stores the token, 302s back to `/content/settings`.
- The **`state`** is `encryptSecret({workspaceId,userId,platform,exp})` (secretBox/AES-GCM): CSRF-safe
  (unforgeable) and it carries the workspace across the external round-trip. `redirect_uri` comes from
  `WS_PUBLIC_URL` (or is derived from the forwarded host in dev) and must match the registered app.
- **Settings** gains a Publishing-connections section (connect button / connected badge, from a new
  `snapshot.content.publishTargets`). **Piece-detail** shows a publish button per connected platform on
  a finished render, firing `content-request-publish` behind a confirm.

**B-23 boundary:** the callback stores the user's OWN OAuth credential (they just consented in their
browser) — a login-style credential capture, not AI-proposed authoritative state — so it writes
directly rather than through the Conductor queue (a synchronous browser redirect can't await the async
queue). The *publish action itself* stays fully B-23-gated: `content-request-publish` only creates a
`WorkspaceSuggestion(publish)`; the post happens on the user accepting it (the Conductor writes).

## Rejected alternatives

- **Route the token store through the Conductor.** An OAuth callback is a synchronous browser redirect
  that must render a result; enqueuing + awaiting the async single-writer queue before redirecting is
  awkward and buys nothing here (no AI is in the loop — the user consented directly).
- **A random-nonce state kept server-side (session/Redis).** Works, but the encrypted-blob state is
  stateless, survives a leader change, and needs no store/cleanup. Encryption already gives CSRF safety.
- **A platform picker dropdown on every asset.** Only connected platforms can be published to, and a
  piece usually has one render; per-connected-platform buttons are clearer and need no extra component.

## Consequences

- Publishing is now reachable end-to-end: connect an account in Settings → publish a finished render
  from the piece-detail → approve the suggestion → the Conductor posts it. No schema change (reuses the
  EnvVar token store). `publishOAuthRoute.test.mts` (8/8) covers the state round-trip + rejection.
- New env: `WS_PUBLIC_URL` (documented in `.env_template`). The YouTube/TikTok client id/secret were
  already templated by M5.
