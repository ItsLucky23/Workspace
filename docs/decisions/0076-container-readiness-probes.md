---
id: 0076
title: Preview/editor serve paths wait for readiness (no fire-and-forget)
status: accepted
date: 2026-07-06
tags: [containers, preview, editor, reliability, depth-program]
supersedes: []
depends_on: [0072, 0037, 0010]
---

# C2 — return only once the port is bound, or a typed timeout

## Context

`GAP_ANALYSIS.md` code-side #3: the preview + editor flows dispatch a serve-command with
`docker exec -d` (detached) and immediately flip the reverse-proxy route + return a URL — assuming
success. A real `health.waitForContainerReady` probe existed but was only called by the deploy path
(`environment.ts`). So a user opening a preview/editor got a URL that 502s until the dev-server /
openvscode-server finished booting (10–30s).

## Decision

- Parametrized `waitForContainerReady(containerName, port, opts)` — `opts` = `{ attempts, delayMs,
  acceptAnyStatus, run }`. `acceptAnyStatus` drops curl's `-f` so a token-gated `401` (openvscode's
  root before the connection-token) still counts as bound; `run` is an injectable probe runner so the
  retry loop is unit-testable without Docker.
- `openPreviewForTicket` now probes `PREVIEW_PORT` after starting the dev server and returns
  `preview.notReady` on timeout INSTEAD of flipping the route to a dead URL.
- `openEditorForTicket` now probes `EDITOR_IN_CONTAINER_PORT` (with `acceptAnyStatus`) after
  `startEditorInContainer` and returns `editor.notReady` on timeout before flipping the route.
- The deploy path (`environment.ts`) already called the probe — unchanged (the new default `opts`
  is backward-compatible).

## Rejected alternatives

- **Flip the route anyway and let it 502 until ready.** Rejected — that is the fire-and-forget the
  gap calls out; a typed timeout is honest and lets the UI show "still starting" rather than a broken tab.
- **A fixed sleep before flipping.** Rejected — too short 502s, too long wastes time; polling returns
  as soon as the port answers.

## Consequences

- `server/container/health.ts` gains the options object + injectable runner. Preview + editor return
  a typed not-ready. `tests/unit/containerReady.test.mts` (6/6) covers ready-on-Nth-poll, exhaustion,
  and the `acceptAnyStatus` probe shape; `environments` 7/7 unaffected. A full live probe against a
  real container is part of the deferred post-keys e2e.
