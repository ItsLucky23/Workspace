---
name: dev-server-server-code-no-hot-reload
title: luckystack-dev does not reliably hot-reload server-side code — a child-restart can respawn STALE code; only a full supervisor-tree restart loads server edits
severity: high
area: dev-workflow
date: 2026-07-02
tags: [dev-server, hot-reload, conductor, sync, testing, restart]
relates: [sync-routes-default-strict-validation]
---

# 0007 — server-side edits need a FULL backend restart, not just a child-restart

> Cost real time TWICE while browser-testing: the realtime `_sync` fix appeared
> "broken" and the quick-create `assigneeId` appeared to not persist — both because
> the RUNNING backend was executing STALE server code, not the edited source.

## What happened

`npm run server` runs `@luckystack/devkit`'s `supervisor.js`, which spawns a tsx child
that serves `:80`. After editing server-side code (`server/orchestrator/conductor.ts`,
`src/workspaces/_sync/*` routes), the running server kept executing the OLD code:

- A ticket created via the UI persisted `description`/`labels` (fields the OLD conductor
  already supported) but NOT `assigneeId` (a NEW field my edit added) → looked like an
  assignee bug. A direct conductor call (fresh `tsx`) set it correctly.
- Proof it was stale: a temporary `console.log` added to the conductor's `quick-add`
  case NEVER printed, even though the `_sync` route logged "server-only success".
- Killing just the child process (`taskkill /PID <child>`) → the supervisor respawned
  but STILL ran stale code.

Only killing the **whole supervisor tree** (the `supervisor.js` pid + its children,
`taskkill /PID <supervisor> /T /F`) and relaunching `npm run server` loaded the edits.
Then the conductor log printed and `assigneeId` persisted.

## Root cause

The dev supervisor's hot-reload / child-respawn does not reliably re-evaluate changed
server modules (module cache / warm registry survives the respawn). The generated
route bundle + type map regenerate on boot, but the changed `server/**` modules can
stay cached.

## How to avoid

- **After ANY `server/**` or `_sync`/`_api` edit, do a FULL backend restart** before
  browser-testing: find the `@luckystack/devkit .../supervisor.js` process, kill its
  tree (`taskkill //PID <supervisor> //T //F` on Windows), then `npm run server` fresh.
  A child-only kill is NOT enough.
- **When a server-side change "doesn't take", suspect stale code first.** Drop a
  temporary `console.log` in the handler; if it never prints on a request that the
  route logs as handled, the process is stale → full restart.
- Client (`vite`) HMR is reliable; this only bites SERVER code.
- Frontend-only fixes can be verified without a restart; server-behavior fixes cannot.
