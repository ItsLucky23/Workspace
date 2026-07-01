---
name: workspaces-api-framework-gotchas
title: Two framework gotchas when adding _api routes with server-side deps in this project
severity: high
area: src/workspaces/_api
date: 2026-07-01
tags: [api, devkit, validation, server-bundle, imports]
---

# 0002 — Two framework gotchas when adding `_api` routes with server-side deps

> Both cost real debugging time while wiring the Workspaces control-API + snapshot
> routes. Both are framework/tooling behaviours, not app-logic bugs.

## What happened

Every `/api/*` route in this project — INCLUDING untouched framework scaffold routes
like `settings/updatePreferences` — returned `api.invalidInputType` with the detail
`data: input nesting exceeds the maximum depth of 64`. Separately, a new route that
imported a runtime const (`OP_CAPABILITY`) from `src/workspaces/_functions/controlApi`
saw it as `undefined` at runtime (→ `Object.keys(undefined)` 500s, or an always-false
`Object.hasOwn` → spurious `invalidRequest`).

## Root cause

1. **The devkit strict `validateInputByType`** (dev-mode, `@luckystack/core` +
   `@luckystack/devkit`) recursively parses the route's extracted input TYPE TEXT and
   errors past a 64-level guard. On this project's generated type context it blows the
   guard for *every* route, so no `/api` route can be called. `validation.runtimeMode:
   'off'` does NOT help in dev (that flag only gates the PROD path; dev always runs the
   devkit check).
2. **The generated server route bundle stubs non-`_api`/`_sync` `src/` RUNTIME imports
   to `undefined`.** A route may import TYPES from `src/...` (type imports erase), and
   may import runtime values from `server/...`, but importing a runtime *value* from
   `src/workspaces/_functions/...` yields `undefined` at runtime.

## How to avoid

- **Per-route escape hatch for the validator:** add `export const validation =
  'relaxed' as const;` to the route. `resolveValidationMode` maps `'relaxed'` (or
  `{ input: 'skip' }`) to skip the strict `validateInputByType`; the generated zod
  `apiInputSchemas` (`.strict()`) + the handler's own checks remain the real input
  guard. (A proper fix is a devkit change to not recurse the type context — until then,
  every new Workspaces `_api` route needs this.)
- **Put any RUNTIME value a route needs under `server/`**, not `src/…/_functions/`.
  Import TYPES from `src/` (they erase) but the values from `server/`. E.g. the RBAC
  `OP_CAPABILITY`/`CAP` map lives in `server/control/rbac.ts`; `controlApi.ts` keeps the
  `ControlOp` types + client-facing `CONFIRM_REQUIRED`.
- **The HTTP body for an `_api` POST is the `data` object DIRECTLY** (not wrapped in
  `{ data: {...} }`) — the framework passes the parsed body to the handler as `data`.
  (`apiRequest` sends the correct shape; only hand-rolled curl tests get this wrong.)
- These do NOT affect the socket transport or the framework's own `apiRequest` client;
  they surfaced during raw-HTTP E2E testing + server-side route wiring.
