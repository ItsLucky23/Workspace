---
name: editor-engine-edit-lock-and-proxy-boot-reconcile
title: The AI engine and a human's live editor never run on a ticket's container at once (edit-lock), and stale proxy routes self-heal on boot
status: accepted
date: 2026-07-03
deciders: [ItsLucky23]
tags: [editor, engine, concurrency, proxy, safety]
supersedes: []
relates: [0010, 0011]
---

## Context

Two systems now touch a ticket's container + its `/work` git-worktree:
- the **autonomous engine** (`stageRunner` drives an in-container `claude` turn that edits +
  commits on `/work`), and
- the **per-ticket live editor** (openvscode-server, ADR 0010, edits the same `/work`).

Running both at once races the worktree — the AI could commit on top of a human's unsaved edits,
or vice-versa. `CODE_EDITOR_BUILD_PLAN` Track C4 (`userEditable` edit-lock) was schema-only and
UNENFORCED. Separately, per-ticket proxy routes (`server/proxy`, ADR 0011) outlive a backend
restart: after a crash/redeploy a `ws-route-*` can point at a container that is gone.

The editor open-flow lives in another agent's files (`editorSession.ts`, `openEditor_v1.ts`);
the engine + proxy are this side's. So the guard is built where it can be enforced without
racing that work, and the editor-side half is offered as a ready helper to call.

## Decision

**A. Mutual edit-lock (`server/orchestrator/editGuard.ts`).**
- **Engine side (enforced, `conductor.provisionContainers`):** before auto-running a stage turn,
  `isEditorRunning(workspaceId, ticketKey)` checks for a live openvscode-server process in the
  container; if present, the turn is **skipped + logged** (re-entering the stage re-triggers it).
  The engine never clobbers a human's open session.
- **Editor side (`ticketEditGuard`, a helper the open-flow calls):** refuse to open the editor
  when the current stage is not `userEditable`, or the AI is mid-turn (a busy `worker`
  AgentSession on the ticket). Provided here; wired into the open-flow by the editor owner.

**B. Proxy boot-reconcile (`server/proxy/reconcileOnBoot.ts`, called from `server.ts` after
listen).** On startup, drop every caddy `ws-route-*` whose upstream container is no longer
running (best-effort, non-blocking). Caddy-focused (the default dynamic backend the editor
drives); the nginx include file persists across restarts, so a full nginx rebuild is a follow-up.

## Rejected alternatives

- **Let them race / last-writer-wins.** Rejected: silent worktree corruption + lost human edits
  is the worst possible failure for a code tool (Rule 19).
- **Kill the editor when a turn starts (or vice-versa).** Rejected: destroys unsaved human work
  / interrupts a running agent without consent. Skip-and-log is recoverable and non-destructive.
- **A distributed lock / queue.** Rejected as over-built for V1 — the container itself
  (openvscode process present) + the existing `worker` AgentSession are sufficient, already-present
  signals; no new lock table.
- **Reconstruct the full live route set on boot from an editor-session registry.** Rejected:
  there is no persisted editor-session registry yet (`CODE_EDITOR` §7 is an open decision), and
  prune-dead-by-container-liveness needs no registry.

## Consequences

- The engine defers (does not fail) when an editor is open; the ticket stays in its stage until
  the editor closes. Surfacing "waiting: editor open" in the UI is a follow-up.
- `ticketEditGuard` only protects if the editor open-flow calls it — a one-line adoption flagged
  to that owner; until then only the engine-side half is live.
- Boot-reconcile keeps caddy's route table honest across restarts; nginx boot-reconcile + an
  idle-editor eviction reaper (CapacityManager) remain follow-ups.
