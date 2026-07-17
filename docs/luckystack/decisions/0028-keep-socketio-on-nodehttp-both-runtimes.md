---
name: keep-socketio-on-nodehttp-both-runtimes
title: Support node and bun through socket.io on node:http; do NOT build a Bun.serve / native-WS socket abstraction
status: accepted
date: 2026-07-16
deciders: [ItsLucky23]
tags: [runtime, sockets, bun, architecture, packaging]
supersedes: []
relates: [0027-package-manager-axis-npm-and-bun]
---

## Context

LuckyStack is socket-first: `apiRequest` / `syncRequest` and the whole sync layer
ride on **socket.io**, which the backend attaches to a Node `http.Server`
(`packages/server/src/createServer.ts:249` → `loadSocket` → `new
SocketIOServer(httpServer)`). Cross-instance fan-out uses
`@socket.io/redis-adapter` + `io.in(room).fetchSockets()` / `RemoteSocket.emit()`
(`packages/core/src/socketRedisAdapter.ts`; see `docs/ARCHITECTURE_MULTI_INSTANCE.md`).
The browser client is `socket.io-client` (`packages/core/src/apiRequest.ts:9`).

Benchmarking (2026-07-16, `docs/findings/2026-07-16-npm-vs-bun-benchmark/`, driven
by `oha`) established two facts that framed this decision:
- Running the framework on **bun via `node:http`** already works end to end and is
  **~1.83× faster** than node on a realistic HTTP response, with ~half the latency.
  Both runtimes are already supported today with no wizard/build step.
- bun's native `Bun.serve()` adds only **~14%** over bun+`node:http` on a realistic
  payload (and its edge shrinks further against real handler work).

The question raised: should we fully adopt bun by supporting `Bun.serve()` and/or
bun-native WebSockets — e.g. via a runtime-branching "socket mapper" facade that
wraps the socket value and switches `emit`/`on`/rooms/etc. on `runtime === 'bun'`
internally — so both runtimes are always supported from one codebase?

## Decision

**Keep socket.io on `node:http` as the single socket abstraction, and support both
runtimes by running that same stack on each (already the case).** Do not build a
`Bun.serve()` HTTP path or a bun-native-WebSocket path, and do not introduce a
runtime-branching socket facade. socket.io *is* the runtime-agnostic socket layer;
it runs on node and bun today and already captures the large runtime win.

## Rejected alternatives

- **`Bun.serve()` for the HTTP routes (dual HTTP stack, runtime-adaptive).** Rejected:
  socket.io cannot attach to `Bun.serve()` (it needs a Node `http.Server` and hooks
  its `request`/`upgrade` events), so `Bun.serve()` could only serve the *auxiliary*
  HTTP routes (health, auth, uploads, avatars, webhooks) — never the socket-first hot
  path. Measured upside there is ~14%, on non-hot-path routes, bought at the cost of
  re-implementing every security-critical middleware (CORS, CSRF, origin gate,
  rate-limiting, security headers, cookies, body caps, custom routes) against
  `Bun.serve()`'s `fetch(Request): Response` model, PLUS still running a `node:http`
  server for socket.io on bun (a two-server topology), PLUS doubling the HTTP test
  matrix.

- **A "socket mapper" facade with per-method `if (runtime === 'bun')` branching over
  bun-native WebSockets.** Rejected, and this is the instructive one: the facade
  surface (`emit`/`on`) is ~10% of the work; the blocking 90% is that the two branches
  are **not interchangeable at the protocol level**. (1) The browser runs
  `socket.io-client`, which speaks the engine.io + socket.io wire protocol — a
  bun-native-WS branch would have to re-implement that entire server-side protocol
  (packet encoding, acks, heartbeats, polling fallback, transport upgrade) just to keep
  the existing client working, i.e. rebuild socket.io's server. (2) Rooms
  (`join`/`leave`/`to`/`in`, used pervasively) don't exist in native WS — a registry to
  build. (3) `@socket.io/redis-adapter` has no native equivalent, so the branch would
  re-implement cross-instance pub/sub + `RemoteSocket` enumeration + per-recipient
  delivery — the framework's most correctness-critical code — on raw Redis. The facade
  does not remove the socket.io dependency; it relocates a re-implementation of
  socket.io's hardest features into hand-written, twin-branched code. And socket.io
  already runs on bun via `node:http`, so this rebuilds a worse, less-tested socket.io
  for a low-single-digit-% frame-layer gain (per-message cost is dominated by auth +
  Redis + DB + JSON, not WS framing). It is also a textbook **twin-drift** generator —
  the codebase's documented #1 defect class — since every socket operation would carry
  two behaviourally-identical code paths to keep in sync forever.

- **Replace socket.io with bun-native WebSockets outright (bun-only).** Rejected:
  abandons socket.io's ecosystem (redis adapter, rooms, reconnection, acks, client) and
  breaks node support; a core rewrite for no proven gain.

## Consequences

- **Both runtimes are fully supported today, no code change, no wizard step.** bun gets
  the ~1.83× realistic-HTTP win and lower latency purely from the runtime switch on
  `node:http`. This is the payoff the rejected work was chasing, already banked.
- **socket.io stays the single socket abstraction.** No parallel socket implementation,
  no per-method runtime branch, no dual HTTP stack — the security-critical HTTP layer
  and the multi-instance Redis fan-out each exist once.
- **The router still must run on node** (bun cannot proxy WebSocket upgrades —
  `node:http` upgrade sockets are a silent no-op on bun, upstream oven-sh/bun#28396;
  see `docs/findings/2026-07-15-bun-feasibility/` B19). Unchanged by this decision.
- **Revisit if:** (a) socket.io ships a first-class `Bun.serve()` adapter (removing the
  protocol re-implementation burden), or (b) a *measured* WebSocket-message throughput
  gap — not a hello-world HTTP number — is large enough to justify the twin-drift and
  the redis-adapter re-implementation. Neither holds as of 2026-07-16.
