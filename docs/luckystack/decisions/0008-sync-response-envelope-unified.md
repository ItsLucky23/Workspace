---
name: sync-response-envelope-unified
title: Unify the sync response envelope across transports — socket ack shape is canonical
status: accepted
date: 2026-06-15
deciders: [ItsLucky23]
tags: [sync, transport, wire-contract, breaking]
supersedes: []
relates: []
---

## Context

The HTTP/SSE sync fallback (`handleHttpSyncRequest`) flattened the route's `serverOutput` to the top level of the response, while the Socket.io ack (`handleSyncRequest`) nested it under `result` as `{ status, message, result: serverOutput }`. The two transports are meant to be interchangeable, but a consumer reading `response.result` got the route's fields over sockets and `undefined` over HTTP — a silent cross-transport bug, and the generated client type `SyncRequestResponseForFullName` already expected `{ status, message, result }`.

## Decision

Adopt the socket ack shape `{ status, message, result: serverOutput }` as the single canonical sync response envelope. `handleHttpSyncRequest` now returns the identical shape (nesting `serverOutput` under `result`) so `response.result` carries the route's fields on both transports, matching the generated client type. Error fields remain on the error envelope only, on both transports.

## Rejected alternatives

- **Make the socket handler flatten to match HTTP** — rejected: would diverge from the generated client types and the established socket ack contract the client `syncRequest` already consumes via `responseData.result`.
- **Keep both shapes, document the divergence** — rejected: defeats the unification goal and leaves the latent cross-transport bug in place.

## Consequences

BREAKING for any consumer that read the HTTP-fallback sync response's flattened top-level fields; they must read `response.result` (which already worked over sockets and matches the generated types). A transport-parity test now pins the unified shape. Pre-1.0 timing makes this the right moment.
