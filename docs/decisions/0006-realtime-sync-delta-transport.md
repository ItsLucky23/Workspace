---
name: realtime-sync-delta-transport
title: In-workspace writes broadcast a per-action `_sync` delta the client merges (no refetch)
status: accepted
date: 2026-07-02
deciders: [ItsLucky23, AI]
tags: [workspaces, realtime, sync, transport, control-api]
supersedes: [per-action-typed-api-write-routes]
relates: [fase1-inprocess-conductor]
---

## Context

ADR 0005 split the write path into per-action typed `_api` routes but kept realtime as
refetch-on-write, explicitly deferring the `_sync` delta layer to a browser-testable
session ("This ADR is superseded if/when the `_sync` layer lands"). In practice the
refetch model meant a user had to reload the board to see a new ticket ("ik moet een
page refresh doen wat echt niet fatsoenlijk is") — realtime is a V1 requirement, and
the user asked for **separate events per action** ("aparte events voor iedere
verschillende actie"), with clients **merging deltas, never refetching**.

The session now has agent-browser + Playwright MCP available, and the client room-join
API (`joinRoom`/`leaveRoom` from `src/_sockets/socketInitializer`) + `syncRequest` /
`useSyncEvents` are usable — the moving parts ADR 0005 flagged as unverifiable are now
verifiable.

## Decision

**Every in-workspace write is a per-action `_sync` event that broadcasts its DELTA to
the workspace room (room code = workspaceId); every client — including the sender —
merges the delta into local state via `upsertSyncEventCallback`. No refetch.**

- Each op keeps its OWN `_sync` route + event name (`workspaces/quickAdd`,
  `workspaces/bulkMove`, …) — the "separate events per action" ask. The identical
  RBAC + enqueue plumbing is factored into `server/control/dispatchControlSync`
  (looks up `OP_CAPABILITY`, checks `hasCapability`, enqueues on the serial Conductor,
  awaits the write, returns the op result); the route only differs in the delta it maps.
- The write still flows through the **single-writer Conductor** (B-23 preserved): the
  `_sync` route validates → RBAC → `enqueueControlAction` → the Conductor writes +
  appends the `WorkspaceSignal` audit row. Only the transport (and the client's
  update mechanism) changed, not the write authority.
- Deltas are narrowed from the Conductor's (`unknown`) op result to the frontend shape
  via cast-free `is`-guards + mappers in `server/read/mappers.ts`
  (`ticketListDelta` / `sprintDelta` / `noteDelta` / `envDelta` / `integrationDelta` /
  `roleDelta` / `inviteDelta`) and the shared `toStageConfig` / `stageConfigDelta`
  extracted from `buildSnapshot`, so a live delta matches the initial-snapshot shape
  exactly. Delete ops echo the removed id; the client drops it.
- The initial load stays a snapshot `apiRequest` (`workspaces/snapshot`); after that it
  is purely live deltas.

## Rejected alternatives

- **Keep refetch-on-write (ADR 0005 status quo).** Rejected: the user explicitly
  rejected refetch; it also re-pulls the whole snapshot per write (wasteful) and still
  lags a second viewer until they act.
- **One generic `_sync` event carrying an op-tagged delta.** Simpler client wiring but
  violates the "separate events per action" ask and loses per-event payload typing from
  the generated sync type-map.
- **Broadcast the full snapshot on every write.** Trivial client merge but defeats the
  point (bandwidth + it IS a refetch in disguise).

## Consequences

- All 21 workspace-scoped writes are realtime; a second viewer sees board/backlog/
  settings changes live without reloading. The generated sync type-map types each
  event's `serverOutput` (delta) end-to-end; the client merge callbacks are typed.
- **Deliberately still `_api` + refetch** (not room-broadcastable): `markRead`
  (per-USER notifications — a room broadcast would mark other users' notifications),
  `deleteWorkspace` (removes the workspace + navigates away), `createWorkspace` +
  `acceptInvite` (login-level, no workspace room yet; they mutate the workspace LIST).
- ADR 0005's other decisions still hold (RBAC per route via the shared gate, the serial
  Conductor as single writer, incremental always-green migration); only its
  refetch-transport is superseded here. The legacy `_api` write routes for migrated ops
  are removed.
- Live browser verification (2 tabs, write in A → appears in B without refresh) is the
  acceptance test for this transport.
