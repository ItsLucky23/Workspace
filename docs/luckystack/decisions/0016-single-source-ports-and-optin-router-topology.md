---
name: single-source-ports-and-optin-router-topology
title: Single-source frontend/backend ports + router topology config is opt-in (not shipped by default)
status: accepted
date: 2026-06-26
deciders: [mathijs]
tags: [config, ports, scaffold, cli, router, packaging, dx]
supersedes: []
relates: [0005, 0014]
---

## Context

Port and IP definitions were scattered across the project with no single source
of truth, forcing hand-synced duplicates:

- The frontend dev port `5173` was **hard-coded in two places** that had to be
  kept in sync: `vite.config.ts` `server.port` and `config.ts` `publicUrl`.
- The backend port lived in `.env` `SERVER_PORT`, a positional `argv` value, and
  `node_modules/.luckystack/dev-server.json`.
- Per-service ports lived in `deploy.config.ts` bindings.

Adding the optional `@luckystack/router` made this worse (it introduces a router
listen port plus per-service bindings) and it was unclear which config fields are
even consulted *without* the router installed. On top of that,
`deploy.config.ts` and `services.config.ts` shipped in **every** scaffold even
though they are only meaningful when `@luckystack/router` is present — so a plain
install carried router topology config it never used.

## Decision

**1. A pure-data `config.ports.ts` is the single source of truth for ports.**
It exports `const ports = { frontend, backend }` with **no side-effects**.
`config.ts` re-exports `ports`, and `vite.config.ts` imports `config.ports.ts`
**directly** — so Vite reads the ports without evaluating `config.ts`'s
side-effects (`registerProjectConfig`, server-only core imports). `server.ts`
passes `defaultPort: ports.backend` to `bootstrapLuckyStack`.

**2. `@luckystack/server` `createServer` resolves the listen port by precedence:**
`options.port ?? argv port ?? options.defaultPort ?? SERVER_PORT ?? 80`. `argv`
still wins (multi-instance launches), `defaultPort` (sourced from
`config.ports.ts`) is the single-instance default, and `SERVER_PORT` remains a
legacy fallback but is removed from the scaffold `.env`. `SERVER_IP` (bind
address) stays in `.env`.

**3. Router topology files are not part of a base install.** `services.config.ts`,
`deploy.config.ts`, and `server/config/presetLoader.ts` are **pruned** by the
scaffold when router is not chosen (mirroring the existing
`prunePresence` / `pruneDocsUi` opt-out pattern), along with their two
`server.ts` side-effect imports. `npx luckystack add router` copies these files
in and wires the imports; `remove router` deletes them and un-wires.
`generateServerRequests.ts` was made resilient: with the config files present it
emits one bundle per preset; without them it emits a single `default` bundle (no
`presetLoader` needed) — which matches the runtime `resolvePresets()` fallback to
`['default']`, so a bare `npm run server` works in both topologies.

## Rejected alternatives

- **Put the ports inside `config.ts` directly** — rejected: any import of
  `config.ts` runs its `registerProjectConfig` side-effects and pulls server-only
  core into the Vite process. A separate pure-data module avoids that.
- **Merge `@luckystack/router` into `@luckystack/core`** — rejected: `core` is
  imported by the client bundle; the router is server-only, Redis-heavy, and runs
  as a separate process. Merging would bloat core, break the composable packaging
  model, and risk server-only code leaking into the browser bundle.
- **Rename `services.config.ts`→`build.config.ts` and
  `deploy.config.ts`→`runtime.config.ts`** — rejected for now: "runtime" collides
  with `config.ts` (the actual app runtime config), and `services.config.ts` is
  itself read at runtime by the router so "build" is imprecise. 205 references
  across 52 files make it a cosmetic, high-churn change.
- **Keep `deploy.config.ts` / `services.config.ts` always shipped** — rejected:
  the user wants a default install to contain no router config. Pruning achieves
  that while keeping the cli↔template `assetParity` model intact.

## Consequences

- One place to change a port; the `5173` twin is gone.
- A default (no-router) scaffold contains only `config.ports.ts` + `config.ts` +
  `.env` for port/topology — clearly nothing router-related. `npx luckystack add
  router` / `remove router` manage the topology files post-install, keeping
  `@luckystack/router` opt-in.
- `config.ports.ts` ships in every scaffold; the framework root app was migrated
  too (it keeps its `services.config.ts` / `deploy.config.ts` as the multi-service
  reference).
- `assetParity.test.ts` now covers the router asset set, so the cli's `add router`
  assets and the template stay in lockstep.
- Files touched: `packages/server/src/{types.ts,createServer.ts}`;
  `packages/create-luckystack-app/template/{config.ports.ts (new), config.ts,
  vite.config.ts, _dot_env_template, server/server.ts,
  scripts/generateServerRequests.ts}`;
  `packages/create-luckystack-app/src/index.ts` (pruneRouter + wireRouter);
  `packages/cli/src/commands/addRouter.ts` + `assets/router/*` +
  `assetParity.test.ts`; root `config.ports.ts` (new) + `config.ts` +
  `server/server.ts` + `.env`.
</content>
</invoke>
