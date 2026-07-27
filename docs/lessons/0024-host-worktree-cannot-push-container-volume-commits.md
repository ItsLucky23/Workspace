---
id: 0024
title: A host activation worktree cannot push commits made in a named volume
severity: critical
area: git, containers, forge, stage-runner
date: 2026-07-27
---

# 0024 — push from the authoritative code location

## What happened

A production stage completed and durably prepared its forge action, but push failed with `fatal: not a git
repository` in the host `worktrees/DEV-4` path. Repository re-link had replaced the bare clone and invalidated that
worktree's gitdir registration. The actual agent commits were healthy inside the ticket container's named volume.

## Root cause

The runtime had migrated from host-mounted worktrees to clone-into-volume isolation, while `pushBranch` still
assumed the agent edited the host activation worktree. Tests injected the push boundary and therefore proved
single-writer ordering without proving the physical source of the commit being pushed.

## How to avoid

- Treat the container's `/work` branch as authoritative whenever the runtime uses a named volume.
- Cross trust boundaries with an inert, credential-free artifact (`git bundle`), not by executing untrusted Git
  config/hooks on the host.
- Keep forge tokens host-side and out of Docker argv/environment.
- Acceptance-test the physical topology: commit in a real container volume, then assert the remote branch receives
  that exact SHA.
- Whenever storage topology changes, audit every read/write/push caller—not just container launch and editor paths.
