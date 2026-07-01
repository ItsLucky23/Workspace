---
name: graceful-shutdown-and-onshutdown-hook
title: Add graceful server shutdown (stop/close + prod signals) and a preServerStop hook
status: accepted
date: 2026-06-15
deciders: [ItsLucky23]
tags: [server, lifecycle, error-tracking, feature]
supersedes: []
relates: []
---

## Context

`createServer` returned `{ httpServer, ioServer, listen }` with no `stop()`/`close()`, and production had only dev-gated `process.exit(0)` on SIGINT/SIGTERM — an immediate hard exit with no drain. Consequently `flushErrorTrackers()` was never wired into shutdown (buffered PostHog/Sentry events were dropped on every redeploy) and Redis pub/sub + sockets were never closed. This was tracked as MIS-016 (and blocked the deferred ET flush-on-shutdown).

## Decision

Add a `preServerStop` (onShutdown) hook to `@luckystack/core`'s augmentable `HookPayloads` + registry (payload `{ reason, timeoutMs? }`, best-effort — a stop signal does not abort shutdown). Add `stop()/close({ timeoutMs? })` to the returned `RunningLuckyStackServer` and wire prod SIGTERM/SIGINT to it. On shutdown the server stops accepting new connections, dispatches `preServerStop`, calls `flushErrorTrackers()`, and closes the http/io servers + the Socket.io Redis-adapter pub/sub clients (which `loadSocket` now owns and returns) — each step wrapped in a bounded `withTimeout` so one failing/hanging step cannot hang shutdown.

## Rejected alternatives

- **Slip the error-tracker flush in alone, against the bare `process.exit(0)` handlers** — rejected (earlier deferral): there was no shutdown seam to register against; making the bare handlers `await` would itself change shutdown behaviour and still miss production. The flush belongs as one subscriber of a real shutdown path.
- **No timeout bound on shutdown steps** — rejected: a hanging flush/close would block the process from exiting.

## Consequences

Buffered observability events are flushed and connections drained on redeploy; consumers can register cleanup via `preServerStop`. New public surface (`stop`/`close` + the hook). Tests pin that `stop()` fires the hook + `flushErrorTrackers`, and that a hanging step still completes within the timeout.
