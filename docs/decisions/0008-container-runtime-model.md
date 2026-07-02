---
id: 0008
title: Container runtime model — clone-into-volume, name-based idempotency, off-chain provisioning
status: accepted
date: 2026-07-02
tags: [container, runtime, orchestrator, git, security]
supersedes: []
---

## Context

Lane F's P1 scope is "L1 base image + provisioning skeleton" (`07b §1`). Building it
surfaced concrete implementation choices the design doc (`07b`) frames but does not pin,
and one it explicitly warns about (`§4`). This records the choices made in the phase-3
container spine, so a later session doesn't re-litigate them.

## Decision

- **Worktree = `git clone --single-branch` into a container-owned volume, NOT a bind-mount
  of the host `git worktree` checkout** (`07b §4`, Q-CT-WORKTREE). A git worktree's `.git`
  is a *gitdir pointer* back to the main repo; bind-mounting only the worktree dir leaves
  a dangling pointer that breaks git on the first command inside the container. The clone
  is self-contained. The `DEV-####` branch (cut at the frozen commit in phase 1b) is the
  clone's `--branch`, so its tip IS the frozen commit — no detaching checkout.
- **`git config --system safe.directory '*'` is BAKED into L1.** The RO `/mirror` (host
  clone) is host-uid-owned; git's dubious-ownership guard refuses it. `-c safe.directory`
  is ignored by git for this key BY DESIGN — only system/global config is honored — so it
  must live in the image.
- **Name-based idempotency, no persistence yet.** A container is keyed by
  `ws-<safe(workspaceId)>-<safe(ticketKey)>`; re-activation reuses/ restarts the named
  container. V1 does NOT write an `AgentSession` row — the container name + docker labels
  (`org.workspaces.workspace` / `.ticket`) are the lookup, so no schema change.
- **Provisioning runs OFF the conductor serial chain** (fire-and-forget at aiEnabled
  activation). `docker` clone+run is ~10s; the authoritative stage move must return fast
  for the realtime board. Best-effort: a launch failure is logged, never fails the move.
- **`docker exec` for terminals in V1**, gated on the workspace label (never exec into a
  foreign container). The full in-container pty-agent (durable scrollback, crash-resume,
  `07b §9`) is deferred.

## Rejected alternatives

- **Bind-mount the host worktree** — the §4 gitdir footgun; breaks git in the container.
- **Per-container `git config --global safe.directory` at start** — a per-container step on
  the critical path, and `-c`/env don't work for this key anyway; baking it in L1 is free.
- **Persist an `AgentSession` row now for idempotency** — a schema change + a second source
  of truth to keep in sync with docker; docker labels already answer "does it exist / whose
  is it". Deferred until the row carries more (ptyAgentUrl, resume id, spend).
- **Provision inside the serial chain** — simplest, but a 10s clone stalls every other
  conductor write and times out the socket fan-out (observed in phase 1). Off-chain wins.

## Consequences

- The container is a disposable, agent-owned checkout on a frozen commit, hardened per
  `07b §7`, reachable by name/label. Teardown removes container + volume.
- Deferred (flagged in the branch log, not silently dropped): auth projection (`§2`),
  egress proxy (`§6`), Caddy networking (`§5`), CapacityManager (`§8`), the in-container
  pty-agent (`§9`), and L2 per-project images (`§1.2`). Each is a later slice.
- The AgentSession-less model means no cross-restart resume yet; `--restart unless-stopped`
  keeps containers alive, but the orchestrator rediscovers them by label, not by a row.
