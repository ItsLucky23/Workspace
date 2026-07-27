---
id: 0302
title: Stage push crosses the container boundary as a credential-free Git bundle
status: accepted
date: 2026-07-27
tags: [git, containers, forge, push, credentials, security]
supersedes: []
---

# 0302 — stage push crosses the container boundary as a credential-free Git bundle

## Context

Ticket code now lives in a container-owned named volume. The stage agent commits inside `/work`; the old
orchestrator push path still opened the host activation worktree. After a repository re-link that host worktree was
stale and its `.git` pointer referenced deleted bare-worktree metadata. More fundamentally, even a healthy host
worktree cannot contain commits made only in the named volume.

The forge credential must remain host-side. Passing it to `docker exec git push`, a container environment variable,
or Docker argv would expose a durable workspace secret inside an agent-controlled container and violate the
existing token-boundary contract.

## Decision

- The canonical container must carry the exact expected workspace and ticket labels; only then may it create a
  `git bundle` for the exact expected branch under `/tmp`.
- Docker copies that credential-free single file into a fresh host scratch directory.
- The host imports the bundle into a newly initialized, host-controlled bare repository and verifies its branch HEAD
  equals the exact SHA observed in the container before export.
- Only that controlled bare repository performs the remote push, using the existing host-side `GIT_ASKPASS` token
  injection. The token never enters container state or Docker argv.
- The Conductor's durable `stage-forge-prepare` intent and reservation/branch/project revalidation remain mandatory
  before this external boundary. The existing `stage-forge-complete` writer remains the only place that persists the
  returned PR/MR URL.
- Bundle and scratch artifacts are bounded and removed after success or failure.

## Rejected alternatives

- **Run authenticated `git push` inside the ticket container:** rejected because it exposes the forge token to the
  agent-controlled security domain and Docker process arguments/environment.
- **Push from the host activation worktree:** rejected because named-volume commits do not exist there; repository
  re-link can additionally invalidate its gitdir registration.
- **Copy the container's `.git` directory and run it directly on the host:** rejected because container-controlled
  hooks/config and filesystem entries would cross into a trusted host Git invocation.
- **Mount the host bare mirror read-write in every ticket container:** rejected because an agent could mutate the
  durable project baseline directly, bypassing the Conductor.

## Consequences

- The pushed branch is byte-for-byte the branch produced inside the ticket container.
- Forge credentials remain outside the container boundary.
- Push uses temporary disk proportional to the reachable bundled branch history and is capped at 256 MiB.
- A branch race, malformed/oversized bundle, foreign container, or HEAD mismatch fails closed before remote push.
