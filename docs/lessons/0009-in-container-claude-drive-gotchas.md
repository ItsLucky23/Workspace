---
id: 0009
title: Driving claude autonomously in a container — CLAUDE_CONFIG_DIR, bypassPermissions, sh-c Stop hook
date: 2026-07-02
severity: high
area: orchestrator, stage-runner, container
tags: [claude-cli, docker, engine]
---

## What happened

Building the stage-runner (autonomous in-container claude turn) hit three non-obvious
failures in a row, each costing a full debug cycle, before a ticket ran end-to-end:

1. **Claude fell into the browser LOGIN flow** even though the projected creds were mounted.
2. **Every turn timed out at ~240s** with no captured result.
3. **The Stop hook never wrote its capture file.**

## Root causes + fixes

1. **`docker exec` sets no `HOME`**, so `~/.claude` resolved wrong and claude couldn't find
   the creds → onboarding + OAuth login. FIX: pin `CLAUDE_CONFIG_DIR` to an explicit path
   (`-e CLAUDE_CONFIG_DIR=/home/agent/.claude` on the container) and copy the RO-projected
   creds into that exact dir — never rely on `~`. (The P0.5 spike worked precisely because it
   set `CLAUDE_CONFIG_DIR=/auth` explicitly; the runner regressed by relying on `~`.)
2. **The turn hung on a permission prompt** for a tool not in the settings `allow` list — an
   interactive prompt no one answers. FIX: run the autonomous agent with
   `--permission-mode bypassPermissions`. The CONTAINER is the security boundary (cap-drop
   ALL, non-root, isolated, disposable), so in-agent permission prompts only stall the turn;
   the stage instructions + the settings deny set remain as defense-in-depth. `.claude.json`
   must carry `bypassPermissionsModeAccepted: true`.
3. **The Stop hook command `cat > file` didn't redirect** — depending on how the CLI executes
   a `type:command` hook, the `>` isn't shell-interpreted. FIX: wrap it: `sh -c 'cat > …'`.

## How to avoid

Any feature that drives an interactive `claude` over `docker exec` must: set
`CLAUDE_CONFIG_DIR` explicitly (no `~`), pass `--permission-mode bypassPermissions` for
autonomous (non-human) turns, and wrap redirecting hook commands in `sh -c`. Also: never
`term.kill()` a node-pty on Windows (its conpty console-list agent can crash the host
process) — `pkill` the process inside the container so the exec exits naturally. See
`server/orchestrator/stageRunner.ts` + [[ai-provider-abstraction]].
