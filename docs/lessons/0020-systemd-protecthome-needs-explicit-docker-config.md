---
id: 0020
title: A systemd-protected home requires an explicit Docker CLI config directory
severity: high
area: production, systemd, docker, stage-runner
date: 2026-07-27
---

# 0020 — Docker CLI startup can fail before it reaches the daemon

## What happened

A production ticket entered an AI-enabled stage and created its git worktree, but every container launch failed
immediately. The stage recovery loop retried repeatedly while the board continued to show an idle ticket. Running
`docker info` interactively as the same Unix user succeeded, so daemon access and group membership looked healthy.

## Root cause

The production systemd unit had `ProtectHome=true`. Docker CLI still tried to inspect
`/home/lucky23/.docker/config.json`; inside the hardened service that path was deliberately inaccessible, so Docker
returned a permission error before performing the requested container operation. An interactive shell was outside
the unit sandbox and therefore could not reproduce it.

## How to avoid

- Keep `ProtectHome=true`; do not weaken the service sandbox to accommodate a CLI default.
- Set `DOCKER_CONFIG` to a systemd-owned runtime directory outside `/home` and create it with
  `RuntimeDirectory=`.
- Verify Docker from the actual service security context, not only with `sudo -u <user> docker info`.
- Lock the unit contract with a test so future hardening cannot reintroduce an implicit home dependency.
- When stage launch retries unexpectedly, inspect the first Docker CLI failure before assuming daemon, image, or
  worktree corruption.
