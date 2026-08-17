---
name: separate-routed-invocation-from-realtime-socket-delivery
title: Separate routed invocation from realtime Socket.io delivery
status: accepted
date: 2026-07-27
deciders: [mathijs]
tags: [api, sync, router, transport, multi-instance, redis]
supersedes: []
relates: [0008, 0013, 0028, 0029]
---

## Context

LuckyStack's browser helpers historically emitted both API and sync invocations
through the one Socket.io connection. The router pins that connection to the
`system` service so rooms, presence and reconnect state stay coherent. In a split
deployment this also made `system` execute every invocation, even when the
service topology assigned the route to another preset. Redis could deliver the
resulting socket event across instances, but could not execute a handler that was
not bundled into `system`.

LuckyStack already had transport-equivalent HTTP API and HTTP/SSE sync handlers,
including auth, CSRF, rate limits, validation, streaming and cancellation. The
router already selected a service owner for `/api/<service>/...` and
`/sync/<service>/...` paths.

## Decision

Keep one browser Socket.io connection to the configured websocket service, and
make invocation transport independently configurable through
`transport.invocation: 'socket' | 'routed-http'`.

`socket` remains the backwards-compatible default for monoliths. In
`routed-http` mode, typed `apiRequest` and `syncRequest` invocations use
same-origin HTTP or SSE, allowing `@luckystack/router` to select the owning
service. Room membership, presence, reconnect state, incoming sync callbacks and
Redis-backed fanout remain on the existing Socket.io connection. The service
that executes a sync uses the shared Socket.io Redis adapter to reach recipients,
including recipients whose sockets terminate on a remote `system` instance.

Custom non-transport HTTP routes declare path-prefix ownership as pure data in
`services.config.ts > customRoutes`; router boot and deploy validation reject
invalid or unknown owners before live traffic.

## Rejected alternatives

- **Keep all invocation on the system socket.** Preserves one protocol but makes
  split service ownership cosmetic: handlers absent from `system` cannot run.
- **Open one browser socket per service.** Complicates rooms, presence, auth,
  reconnect behavior and connection affinity, and multiplies browser resources.
- **Build an internal system-to-service RPC protocol first.** Duplicates the
  existing HTTP pipeline and requires new authentication, cancellation,
  streaming framing, loop prevention, retry and idempotency contracts.
- **Switch LuckyStack to HTTP-only.** Loses the realtime room/presence/callback
  channel that remains the framework's core strength.

## Consequences

- Monolithic consumers keep socket-first behavior unless they opt in.
- Split deployments can run one preset locally while non-local routes use a
  staging fallback, without opening a second browser socket.
- HTTP invocation must preserve cookie/bearer auth, origin-scoped CSRF, generated
  response typing, streaming, timeout, cancellation and offline queue behavior.
- Shared Redis remains a delivery/fanout mechanism; it is not remote handler
  execution or a substitute for service-aware routing.
- Server-originated cross-service calls that cannot traverse the router may
  justify a future internal RPC layer, but that is a separate measured need.
