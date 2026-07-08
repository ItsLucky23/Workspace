---
id: 0012
title: prisma generate EPERMs on the locked query-engine DLL — never blanket-kill node, never --no-engine
severity: high
area: prisma, schema-change, windows, dev-server
date: 2026-07-08
---

# 0012 — prisma generate EPERM on a locked query-engine DLL (and the `--no-engine` trap)

## What happened

A schema change (adding one optional field) needed `npm run prisma:db:push`. The DB push (Mongo index
sync) succeeded, but the follow-up client `generate` failed with:
`EPERM: operation not permitted, rename '…\node_modules\.prisma\client\query_engine-windows.dll.node.tmp…'`.
On Windows the query-engine `.node` DLL is held (memory-mapped) by any running process that loaded
`@prisma/client` — here the `luckystack-dev` supervisor (`@luckystack/devkit`) which auto-**respawns**
`server/server.ts`, so killing one server child just spawned another and the DLL stayed locked.

Trying to route around it with `prisma generate --no-engine` "succeeded" but made it WORSE: that flag
emits the Accelerate/driver-adapter client, so every direct-Mongo query then threw
`the URL must start with the protocol prisma://` (P6001) — runtime broken for the whole repo.

## Root cause

- `prisma generate` always writes a fresh engine binary to a `.tmp` then renames it over the existing DLL;
  the rename fails while any process holds the current DLL open.
- A `luckystack-dev` supervisor auto-restarts `server/server.ts`, so a naive `Stop-Process` of the server
  node re-locks the DLL within a second.
- `--no-engine` changes the client ENGINE TYPE (to none/Accelerate), it does not merely skip the copy — the
  generated client can no longer talk to a local datasource.

## How to avoid

- **Find the exact holder, don't blanket-kill `node`** (that would also kill Claude Code, MCP servers, the
  other agent). Identify it:
  `Get-Process node | ? { $_.Modules | ? { $_.FileName -like '*query_engine-windows*' } }`, then
  `Get-CimInstance Win32_Process -Filter "ProcessId=<id>"` for the command line + parent chain.
- If a **supervisor** (`@luckystack/devkit` `supervisor.js`) owns it, stop the SUPERVISOR (and the launching
  `npm run server` / cmd), not just the server child, so it stops respawning — then regenerate, then
  **restart `npm run server`** to leave the environment as you found it. The `/goal` "backend DOWN on schema
  change" authorization covers this.
- The DLL on disk is version-tied (not schema-tied); for an ADDITIVE optional field only the client TS types
  need refreshing, but you still must regenerate in normal (library) mode with the DLL free.
- **Never use `prisma generate --no-engine`** in this repo — it breaks the runtime datasource. If you tried
  it, recover with a normal `npm run prisma:generate` once the DLL is free.
