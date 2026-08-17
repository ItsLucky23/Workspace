---
name: windows-e2e-port-pairs-and-wsl-redis-protected-mode
title: Windows port-0 probes and WSL Redis defaults can invalidate runtime E2E setup
severity: medium
area: scripts/e2eVerdaccio.mjs
date: 2026-08-16
tags: [e2e, windows, ports, redis, wsl, infrastructure]
---

# 0016 — Windows port-0 probes and WSL Redis defaults can invalidate runtime E2E setup

## What happened

The port-contract E2E initially asked Windows for an ephemeral `listen(0)` port
and assumed `port + 1` could be used for the auto-increment target. On this
machine every returned ephemeral port had its adjacent port reserved/open, so
50 attempts found no pair.

After switching to a temporary WSL Redis to avoid reading the developer's
password-protected local Redis, a plain TCP connect succeeded but every Redis
command was reset. Multiple full Verdaccio scaffold/install runs reached runtime
before exposing these infrastructure failures.

## Root cause

Windows may allocate/reserve ephemeral ports in pairs, so “port 0 is free” says
nothing about its successor. Separately, Redis protected mode accepts loopback
inside WSL but rejects a Windows client arriving through the WSL virtual-network
address unless that temporary test server is explicitly configured for the
isolated cross-host test.

## How to avoid

For an E2E that needs consecutive ports, reserve both exact candidates with real
`net.Server` instances before selecting the pair; do not infer adjacency from
`listen(0)`. When using a disposable WSL Redis from Windows, verify a real Redis
`PING` over the Windows→WSL address, not just TCP connect. Use an isolated,
non-persistent instance with `--protected-mode no` only for that test, then shut
it down immediately; never weaken the developer's normal Redis or read secrets
from `.env.local`.
