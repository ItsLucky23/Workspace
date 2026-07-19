---
id: 0016
title: Killing the PID on the port resurrects the server — luckystack-dev is a supervisor; kill the process TREE
severity: high
area: dev-server, windows, process-management
date: 2026-07-20
---

# 0016 — three backends, none of them yours

## What happened

To restart the backend with fresh code, the PID listening on the port was killed and `npm run
server` started again. The "restart" kept behaving inconsistently: proposals dispatched into a
void, logs showed nothing, and `netstat` eventually revealed THREE backends on 4787/4788/4789 —
each `npm run server` invocation had left a live supervisor.

## Root cause

`npm run server` runs `luckystack-dev`, a SUPERVISOR that respawns its server child when it dies.
Killing the PID that owns the port kills the child; the supervisor immediately spawns a
replacement, which finds its old port in TIME_WAIT (or taken by a sibling) and auto-increments —
lesson 0015's port-hop, now self-inflicted. Every "kill the port PID + start a new one" cycle NETS
one extra supervisor. Multiple instances then split the traffic: the leader executes writes while
your log-tail follows a different instance.

## How to avoid

- Restart by killing the supervisor TREE, not the port PID: find the `luckystack-dev` / `npm run
  server` wrapper processes (`Get-CimInstance Win32_Process | Where CommandLine -match
  'luckystack-dev'`) and `taskkill /PID <wrapper> /T /F` each — then verify `netstat` shows ZERO
  `:478x` listeners before starting exactly one new instance.
- After any restart, trust `node_modules/.luckystack/dev-server.json` for the real port (lesson
  0015) and check the listener COUNT, not just "the port answers".
