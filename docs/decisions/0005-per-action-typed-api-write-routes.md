---
name: per-action-typed-api-write-routes
title: The write path splits into per-action typed `_api` routes (not `_sync`) — realtime `_sync` deltas deferred to a browser-testable session
status: superseded
superseded_by: [realtime-sync-delta-transport]
date: 2026-07-02
deciders: [ItsLucky23, AI]
tags: [workspaces, control-api, typed-routes, fase-0, transport]
relates: [fase1-inprocess-conductor]
---

## Context

The single `workspaces/control` route took a `Record<string, unknown>` transport
envelope (`{ op, target, payload }`) and dispatched by `op` inside the Conductor.
Because the client-facing payloads were untyped, the generated type-map (the
"type-server") could not type any write call — the item-9 complaint: *"in de payloads
gewoon record<string,unknown> waardoor onze typing server geen nut heeft… liefst voor
iedere actie een eigen api call."*

The user's stated direction was: per-action calls, **and** "eigenlijk moet bijna alles
sync calls worden" — use `_sync` events for in-workspace realtime writes, with the
client merging on `seq`.

This decision was taken during an unattended overnight `/loop`: the AI can run
tsc/lint/build + code-direct Mongo integration tests, but **cannot drive a browser**,
so any Socket.io/`_sync` room-fanout + client-merge path is unverifiable this session.
Investigation also showed the client room-join API (`joinRoom`) is not cleanly
surfaced, and `sync.requireRoomMembership` defaults to `true` (0.2.0) — a `_sync`
write path has moving parts that only a browser can prove.

## Decision

**Split the write path into one typed `_api` route per action** (`quickAdd_v1`,
`sprintCreate_v1`, …), each with a fully-typed `ApiParams.data` payload, so the
generated type-map types the client's `apiRequest({ name: 'workspaces/<op>', … })`
call end-to-end. Each route stays thin: validate → `hasCapability` RBAC (the shared
B-28 gate extracted to `server/control/rbac.ts`) → **enqueue onto the existing serial
Conductor** (preserving serial write-ordering + the `WorkspaceSignal` event-recorder).
The `WorkspacesCtx` interface is unchanged (it already exposes typed helpers like
`quickAdd`/`sprintCreate`), so only each helper's implementation in
`WorkspacesProvider` moves from the generic `control()` to its typed route — **no
consumer/page changes**. Migration is incremental + always-green: the legacy
`workspaces/control` route keeps serving not-yet-migrated ops until every op has moved,
then it (and the generic `control()` client helper) are removed.

The realtime **`_sync` delta layer** (broadcast on write → clients refetch/merge on
`seq`) is **deferred** to a session where the browser can verify it — it is additive
on top of this typed `_api` split, not a prerequisite for solving item 9.

## Rejected alternatives

- **`_sync` write routes now (the user's literal preference).** Rejected *for this
  session only*: unverifiable without a browser, unclear room-join client API, and
  betting the entire (currently-working) write path on an unproven transport overnight
  risks a fully-broken app. Flagged to the user (Rule 3b) rather than silently chosen.
- **Keep one route, strengthen `ControlAction` into a typed discriminated union.**
  Types the payloads but is NOT "een eigen api call per actie"; also a single strict
  union breaks the legacy loose route, forcing a risky big-bang cutover.
- **Do nothing / wait for the user.** The core complaint is real and the typed `_api`
  split is safe + verifiable, so partial progress now beats blocking.

## Consequences

- Client write calls are fully typed per action (item-9 core solved); `Record<string,
  unknown>` is gone at the client boundary. The Conductor's internal `executeAction`
  readers stay loose for now (server-internal, invisible to the type-server) and can be
  typed op-by-op in Fase 2 cleanup.
- Serial ordering + `WorkspaceSignal` audit are preserved (routes still enqueue to the
  Conductor). The "universal event-recorder" ask is met by that existing signal append;
  per-op `TicketEvent` enrichment (activity feed) is a follow-up.
- Two write transports coexist during migration (typed routes + legacy `control`);
  this is temporary and removed once all ~40 ops are migrated.
- Realtime is still refetch-on-write (as today); true `_sync` push is a documented,
  browser-gated follow-up. This ADR is superseded if/when the `_sync` layer lands.
