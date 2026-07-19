---
id: 0015
title: The dev backend hops ports and records the real one in dev-server.json — restarting "the" configured port leaves the browser on a stale backend
severity: high
area: dev-server, browser-testing, windows
date: 2026-07-19
---

# 0015 — browser-verifying against a backend that was never restarted

## What happened

A snapshot field was added, the backend was restarted, the page was reloaded — and the browser kept showing
the old shape. Three restarts later it still did. The snapshot builder was verified correct by calling it
directly in a `tsx` script, the edit was verified present in the file, and the generated client was
regenerated. Everything checked out except the thing on screen.

A temporary `console.log` inside the builder settled it: on a page load the marker **never fired**. The
running backend was not executing that code at all.

`node_modules/.luckystack/dev-server.json` said:

```json
{ "ip": "127.0.0.1", "port": 4792, "pid": 88084 }
```

The browser was talking to port **4792**. Every restart had killed the process on **4787** — the port in
`config.ports.ts` — while Vite's proxy follows `dev-server.json`. Six orphaned backends were listening on
4787–4792 at that point, one per "restart", each a supervisor that respawned its child.

## Root cause

Two independent facts that only bite together:

1. The dev backend **auto-increments off a busy port** and writes the port it actually bound to
   `node_modules/.luckystack/dev-server.json`. `vite.config.ts` re-reads that file per request (via
   `bypass`) so the proxy follows a backend that hops mid-session.
2. Killing the process listening on the *configured* port therefore kills an unrelated instance, frees that
   port, and the next `npm run server` binds it — so the check "is 4787 listening?" passes immediately and
   the restart looks successful.

Each failed restart added an orphan, and orphans made the next start hop further, which is why the gap grew
rather than resolving.

## How to avoid

- **Read `node_modules/.luckystack/dev-server.json` to find the backend the browser is actually using.**
  Its `pid` is the one to stop; `config.ports.ts` is the *preferred* port, not the live one.
- After a restart, re-read that file and confirm the port changed as expected — do not assume the configured
  port is the live one.
- Before starting a fresh backend, check for orphans:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*devkit*supervisor*' }`.
  Stop the **supervisors**, not their children, or they respawn (see lesson 0012, which is the same trap
  seen from the Prisma-DLL side).
- Symptom to recognise fast: *the code is provably correct when called directly, but the browser shows the
  old behaviour across a hard reload.* Before re-checking the code again, prove the running server executes
  it — a one-line `console.log` and a page load answers it in seconds.
- E2E tests that fetch `http://localhost:<configured port>` directly can pass against a *different*
  instance than the browser uses. That is exactly how this stayed hidden: the e2e suite went green while
  the UI stayed stale.
