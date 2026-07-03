---
name: engine-control-plane-completion
title: Engine control-plane completion — push-on-approval, pause/kill controls, off-chain realtime broadcast, and preview exposure
status: accepted
date: 2026-07-03
deciders: [ItsLucky23]
tags: [engine, git, control-plane, realtime, preview]
supersedes: []
relates: [0006, 0011, 0012]
---

## Context

The autonomous engine ran tickets to a committed branch, but the loop wasn't closed: the AI's
work never left the container (commits were local-only), a runaway turn couldn't be stopped, the
engine's stage-advance was silent (boards only updated on reload), and there was no way to see a
ticket's app running. This ADR records the batch of control-plane decisions that close those gaps
(CODE_EDITOR Track C/F + the realtime + preview layers), built engine/conductor/proxy-side while
another agent built the editor/Caddy/UI side.

## Decision

**A. Push-on-approval (Track F) — `server/git/forge.ts`.** When a `done` turn leaves a stage that
gates for approval OR is terminal, and the workspace `pushPolicy` ≠ `local-only`, push the ticket
branch to origin and (for `merge-request`) open/find a GitLab MR against `targetBranch`. The
GitLab token is decrypted ONLY in forge, injected transiently (git `withAuth` url + the MR
`PRIVATE-TOKEN` header), never stored/logged; `protectedBranches` are refused. Fired
fire-and-forget from the stage-runner so a slow/failed forge never breaks the turn.

**B. Agent controls (C2) — `pause`/`resume`/`kill`/`pause-all`/`resume-all`.** `pause` is a
PROVISIONING flag, not a freeze of a running turn: per-ticket `Ticket.status='paused'` and
workspace `Workspace.paused` make `provisionContainers` skip. `kill` stops an in-flight turn by
killing the in-container `claude` PROCPS-FREE (walk `/proc/[pid]/cmdline`; ps/pgrep are absent in
the slim base image) + marking the worker AgentSession stopped. One `_sync/agentControl` route
fans the five ops through the Conductor.

**C. Off-chain realtime broadcast — `server/read/broadcast.ts`.** The engine's auto-advance
replicates the framework's sync fan-out from plain server code: emit the `"sync"` socket event to
`formatRoomName(workspaceId, …)` with the exact `bulkMove` envelope
(`serverOutput.tickets` = the shared `toTicket` mapper) the client's `upsertSyncEventCallback`
already merges (upsert-by-id). Boards update live, no refetch, fanned across instances by the
Redis adapter. The edit-lock defer (0012) reuses this to show WHY a turn was skipped.

**D. Preview exposure (P4) — `server/container/previewSession.ts`.** Run the project's dev server
(`Project.devCommand`, default `npm run dev`) in the ticket container + expose it via the
`previewRoute` (0011) subdomain. `openPreview`/`closePreview` are direct `_api` ops (slow boot,
must not block the serial writer). The complement to the editor: edit vs run.

**E. Editor eviction (CapacityManager) — `server/proxy/editorReaper.ts`.** A periodic reaper
stops idle live editors (openvscode LISTENING on the editor port but with NO connected client,
sustained for `WS_EDITOR_IDLE_MIN`) and prunes their routes, so editors + routes don't accumulate.

## Rejected alternatives

- **Push on every stage advance.** Rejected: churns the remote + opens premature MRs; pushing at
  the approval gate / terminal is when work is actually ready for a human.
- **`pause` = suspend a running claude turn.** Rejected: claude has no resumable suspend mid-turn;
  pausing PROVISIONING (no new turns) + `kill` for an in-flight one is the honest model.
- **A new `broadcastSync` framework helper / a per-op client callback.** Rejected: reusing the
  existing `bulkMove` envelope + `getIoInstance`/`formatRoomName`/`socketEventNames` primitives
  needs no framework change and no new client merge path.
- **Reap editors by container age.** Rejected: age ≠ idle — it would kill an actively-used editor.
  "Listening but no ESTABLISHED client connection" is a true idle signal, procps-free.

## Consequences

- The full loop closes: ticket → AI processes → (approval) push + MR → human review; boards
  update live; a runaway turn is killable; a workspace/ticket is pausable.
- Push/MR need a stored GitLab token + an activated ticket (branch + `Project.gitUrl`); without
  them forge refuses cleanly (never a partial push). Preview needs the project image to carry the
  app's deps + a `devCommand` binding `0.0.0.0`.
- Follow-ups: re-trigger a turn automatically on `resume` (today: re-move the ticket); a
  workspace-level realtime delta for `pause-all` (today: reflected on next load); a lastActivity
  signal to refine editor eviction.
