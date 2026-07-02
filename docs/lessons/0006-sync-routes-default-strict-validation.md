---
name: sync-routes-default-strict-validation
title: _sync routes default to STRICT input validation and reject valid input with sync.invalidInputType — set `validation = 'relaxed'` (and browser/socket-test, integration tests bypass the transport)
severity: high
area: src/workspaces/_sync
date: 2026-07-02
tags: [sync, validation, realtime, transport, testing, browser]
relates: [workspaces-api-framework-gotchas, container-runtime-gated-by-p05-spike]
---

# 0006 — _sync routes need `validation = 'relaxed'`; integration tests miss the transport

> Found by BROWSER-testing the realtime write path (agent-browser): creating a
> ticket in the UI failed with `[error] Sync workspaces/quickAdd failed
> {message: "sync.invalidInputType"}`, even though front/server tsc, eslint, and
> the code-direct integration suite (12/12) were all green.

## What happened

`@luckystack/sync` validates a `_sync` route's `clientInput` at the socket transport
layer. `resolveSyncValidationMode(entry.validation)` returns **`"strict"` when no
`validation` is exported** (`if (!validation) return "strict"`). In strict mode it
runs `validateInputByType` against the generated `clientInput` type text; that
validator rejected our valid payloads → `sync.invalidInputType`, so the request never
reached the RBAC/Conductor and nothing was written.

The per-action typed `_api` routes had all set `export const validation = 'relaxed'
as const;` (the RBAC gate + Conductor do the real validation). The new `_sync` routes
(and the original quickAdd "proof") were missing it → strict → rejected.

A SECOND, quieter bug hid behind the first: the running `:80` dev server was serving
**stale** route + Conductor code (luckystack-dev did not reliably hot-reload the new
`_sync` modules + regenerated sync maps), so a stale Conductor returned `undefined`
for the quick-add op → `ticketDelta(undefined)` → the broadcast carried
`ticket: null` → the client merge-callback early-returned. Proof it was stale: a
temporary `_dbg` field added to the route never appeared in the client payload.

## Root cause

- `_sync` validation defaults to strict; the type-text-based strict validator is
  unreliable for these payloads (same reason the `_api` routes chose relaxed).
- **Code-direct integration tests call `enqueueControlAction` (the Conductor)
  directly, bypassing the entire sync transport + input validation** — so they can be
  100% green while the real socket path is broken. Only a browser/e2e (or a real
  socket.io client) exercises `validateInputByType` + the room broadcast + the client
  merge-callback.
- Server-side route/Conductor changes need the dev backend RELOADED; a stale process
  masks or fakes results (compare lesson 0004's hot-reload-masking note).

## How to avoid

- **Every `_sync` write route sets `export const validation = 'relaxed' as const;`**
  (mirrors the `_api` convention). The RBAC + Conductor remain the real validators.
- **Verify realtime with a browser (agent-browser) or a socket-level test, never only
  the code-direct integration suite** — the latter can't see the transport. The
  realtime broadcast→callback plumbing itself is confirmed working (the client
  merge-callback fires with the broadcast `serverOutput`).
- After server-side sync/route/Conductor edits, **restart the `:80` backend** (it is a
  developer-managed action) so the current code + regenerated sync maps load; a stale
  server yields flaky `invalidInputType` / null deltas.
