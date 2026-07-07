---
title: Music generation uses the api.sunoapi.org contract (resolves the 0093 open question)
status: accepted
date: 2026-07-07
tags: [media, providers, music, suno]
supersedes: []
---

## Context

ADR 0093 left an open question: live music generation 503'd because the Suno provider pointed at
`https://api.suno.ai/v1` — not a real host. The user supplied the docs for the Suno API they actually
have a key for: **`api.sunoapi.org`** (a Suno-proxy). The old provider also used the wrong flow
(`/clips/<id>`) and field names.

## Decision

Rewrite `realMusicTransport` to the `api.sunoapi.org/api/v1` contract:

- **Submit:** `POST /generate` with `{ prompt, customMode:false, instrumental:false, model, callBackUrl }`
  → `{ code:200, data:{ taskId } }`. `model` defaults to **`V5`** (fastest); the callback is required by
  the API but unused (we poll), so any URL satisfies it.
- **Poll:** `GET /generate/record-info?taskId=…` → `data.status` (PENDING → TEXT_SUCCESS → SUCCESS) with
  the track under **`data.response.sunoData[0]`**. The full mp3 is `audioUrl` (at SUCCESS); `streamAudioUrl`
  appears earlier (TEXT_SUCCESS) as a playable fallback — we return whichever is present first, so a track
  is usable in ~20s instead of ~100s.
- `SUNO_BASE` / `SUNO_MODEL` / `SUNO_CALLBACK_URL` are env-overridable (documented in `.env.local_template`).

Live-verified: real `audioUrl` returned. The registry stub-fallback (no key) is unchanged, and the
injectable-transport fixture tests are unaffected (the transport interface is the same).

## Rejected alternatives

- **Keep `api.suno.ai/v1`.** Not a real endpoint for this key — 503s. The key determines the service;
  the user's is the sunoapi.org proxy.
- **Wait only for the final `audioUrl` (SUCCESS, ~100s).** Correct but slower; `streamAudioUrl` at
  TEXT_SUCCESS is a valid playable URL, so returning it first makes the feature feel responsive. The full
  download still lands in `audioUrl` for callers that re-fetch.
- **Use the webhook callback instead of polling.** Needs a public, reachable callback endpoint + wiring
  through the orchestrator; polling `record-info` is self-contained and matches every other media provider.

## Consequences

- Music generation works live (a real hosted mp3 url), so the content-lane's music leg is no longer a
  documented gap. The live suite (`liveAi.live.mts`) promotes `music` from best-effort to a hard assert.
- Suno files auto-delete after 15 days (per the docs) — a caller that needs permanence must persist the
  mp3 to the media store; noted for a future enhancement, not required for generation to work.
