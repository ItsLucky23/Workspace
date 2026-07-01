---
name: admit-originless-socketio-handshake
title: Admit origin-less Socket.io handshakes at the CORS layer (fixes 400 code:3 in dev + prod-with-router)
status: accepted
date: 2026-06-18
deciders: [ItsLucky23]
tags: [security, sockets, cors, dev-experience, regression]
supersedes: []
relates: []
---

## Context

Since the v0.2.0 security-hardening release (`95a1e13`), the Socket.io `cors.origin` callback in `@luckystack/server` `loadSocket.ts` rejected any request with an absent `Origin` header (unless `cors.allowOriginless` was explicitly set, which the template never did). The rejection rationale in the JSDoc was "the CORS layer is the last browser-origin gate on the WS path."

In practice this broke every fresh connection in BOTH supported topologies:

- **Dev** — the client connects to `http://localhost:5173` (the Vite dev server), which proxies `/socket.io` to the backend. The browser issues the initial Socket.io polling handshake (`GET /socket.io/?EIO=4&transport=polling`) as a **same-origin** request, and browsers omit the `Origin` header on same-origin GETs. The server returned `400 {"code":3,"message":"Bad request"}` — engine.io's `MIDDLEWARE_FAILURE` — so the socket never connected.
- **Prod with `@luckystack/router`** — the server serves the frontend and backend from one origin, so the handshake is same-origin there too: same 400, same broken socket.

Verified empirically (isolated engine.io instance mirroring the exact cors callback):
- origin-less handshake → `400 code:3 MIDDLEWARE_FAILURE` (the user-reported error)
- same request with `Origin: http://localhost:5173` → `200` + valid handshake
- so the presence/absence of the `Origin` header was the sole difference between a working and a broken connection.

## Decision

The CORS `origin` callback now **admits origin-less requests unconditionally** (`callback(null, true)`). Requests that DO carry an `Origin` header are still gated by `allowedOrigin(...)` exactly as before. The `allowOriginless` config flag is retained for type-compatibility but no longer gates anything (documented as deprecated).

Rationale:
- CORS does not apply to same-origin requests; an absent `Origin` on a GET is the browser's *same-origin* signal, not a CSRF vector.
- Socket.io must complete the plain-HTTP polling handshake before it can upgrade to WebSocket, so the "WS-path gate" rationale was misplaced — it also fired on the HTTP handshake and blocked it.
- The real authentication gate is the session token extracted from the handshake (`extractTokenFromSocket`) plus the auth hooks, which run regardless of the `Origin` header.

## Rejected alternatives

- **Keep rejecting origin-less (keep the v0.2.0 behavior), rely on consumers setting `allowOriginless`** — rejected: the default must boot; a fresh scaffold with the documented topologies (dev + router) must connect out of the box. Forcing every consumer to discover + set a flag for a same-origin handshake is a broken default.
- **Admit origin-less only when `allowLocalhost` is on** — rejected: covers dev but NOT prod-with-router (where `allowLocalhost` is correctly `false` but the handshake is still same-origin/origin-less). Would leave the router topology broken.
- **Try to distinguish polling-handshake from WS-upgrade inside the `origin` callback** — rejected as infeasible: the `cors` package passes only `(origin, callback)` to the user function, not the `req`, so the callback cannot tell a polling GET from a WS upgrade. Engine.io runs the same cors middleware on both.

## Consequences

- Same-origin handshakes (dev Vite-proxy + prod-with-router) connect cleanly; no consumer config change required.
- Cross-origin requests with a disallowed `Origin` are still rejected (`400`, `MIDDLEWARE_FAILURE`) — the CORS gate is intact for the case it actually protects against.
- `allowOriginless` is now a no-op flag, kept only so existing configs keep type-checking; scheduled for removal in a future major version. The JSDoc on `CorsConfig.allowOriginless` is updated to say so.
- The template `config.ts` documents the behavior so readers understand they do NOT need to list every same-origin variant in `allowedOrigins`.
