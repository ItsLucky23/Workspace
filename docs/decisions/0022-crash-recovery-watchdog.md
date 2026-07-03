---
id: 0022
title: Crash-recovery watchdog — boot resume + stuck/idle detection
status: accepted
date: 2026-07-03
tags: [workspaces, orchestrator, crash-recovery, watchdog, resume, multi-instance]
supersedes: []
---

# 0022 — Crash-recovery watchdog

## Context

Goal-item #1. If the backend crashed (or was restarted) mid-turn, the ticket's container kept
running but its `claude` PTY died with the old process, and the worker `AgentSession` was left
`busy` forever — the turn was orphaned, never resumed, never cleaned up. There was also no detector
for a turn that hangs (rate-limited / wedged without ending) or a ticket that should be running but
isn't (a dropped provisioning). The user wants: on boot, re-associate containers + resume
interrupted sessions (`claude --resume`); and a watchdog that detects stuck/idle/turn-cap turns and
intervenes.

## Decision

`server/orchestrator/watchdog.ts`, both entry points **leader-gated** (ADR 0015 — exactly one
instance recovers):

- **`resumeEngineOnBoot`** scans every `busy` worker session and classifies it (pure, unit-tested
  `classifyBusySession`): a `done`/non-AI-stage session is **stopped** (stale); a paused / real-
  human-question session is **skipped** (legitimately parked — a defer banner does NOT count as a
  real question); otherwise it was interrupted → **resumed** with `claude --resume` if its container
  survived, or **reprovisioned** fresh if the container died. `--resume` threads through
  `reprovisionTicket → provisionContainers → runStage → driveContainerTurn` (new `resumeSessionId`),
  continuing the stored `claudeSessionId` with a "continue where you left off" nudge.
- **`runWatchdogSweep`** (periodic): a **stuck** turn (a `busy` session older than `WS_TURN_MAX_MS`,
  not parked) is killed + re-provisioned; an **idle** ticket (activated, in an AI-enabled *non-gate*
  stage, that NEVER ran a session on its current stage — a dropped provisioning) is re-provisioned.
  A stage that already produced a session is left alone (its turn completed / advanced / parks for
  approval — never re-fire that). Rate-limited turns end → become idle → picked up on a later sweep.
- The re-fire uses the engine's own `reprovisionTicket` (the same path the `resume` control-op
  uses): the watchdog is part of the ENGINE, not a user, so it triggers turns directly; `runStage`
  still makes the authoritative session/ticket writes, exactly as in normal operation.
- **Wiring caveat (load-bearing):** `startTicketWatchdog` is **dynamically imported** in `server.ts`
  AFTER `initSecretManager`. A static import pulls the Conductor's module-level
  `const prisma = getPrismaClient()` into the boot graph *before* secrets resolve, so the default
  Prisma client is built with the unresolved `DATABASE_URL` pointer → every default-client query
  fails with "URL must start with mongo". The dynamic import keeps the Conductor out of the pre-
  resolution static graph. (Discovered + fixed during this build; see the branch log.)

## Rejected alternatives

- **Resume via the `resume` control-op only.** That op re-fires FRESH (no `--resume`); crash-
  recovery of a surviving container should continue the interrupted conversation, so `--resume`
  threading was needed.
- **Treat every `busy` session as crashed on boot.** That would re-fire turns legitimately parked
  for a human answer or paused — the classification distinguishes them.
- **Re-fire any idle activated ticket.** That loops the AI on approval-gated / already-run stages.
  Keying on "no session ever ran on THIS stage" (+ excluding gate stages) is the safe signal.
- **A per-instance in-memory recovery.** Not multi-instance-safe; leader-gating + the shared lease
  is the established pattern.

## Consequences

- A backend restart no longer orphans turns: surviving containers resume, dead ones relaunch, stale
  sessions clean up, parked turns are untouched.
- Hung and dropped turns self-heal on the periodic sweep.
- Verified: `watchdog.test.mts` (22/22) — the full classification matrix, boot reconciliation with
  an injected container set (resume / reprovision / stop / skip transitions), and stuck + idle
  detection. Full suite 24/24. Clean runtime boot confirmed (no unresolved-URL error after the
  dynamic-import fix).
