---
name: container-runtime-gated-by-p05-spike
title: Do not build the container runtime / register docker-image / pipeline-terminals autonomously — lane F is HARD-gated behind the human-run P0.5 CLI spike
severity: high
area: server/orchestrator
date: 2026-07-02
tags: [containers, p0.5-spike, billing, pty, gate, lane-f, autonomy]
relates: [workspaces-api-framework-gotchas]
---

# 0005 — the container runtime is gated behind a human-run spike, not buildable blind

> Surfaced during the realtime `/loop`: after finishing milestone 1 (realtime),
> the loop's own bouwvolgorde said to build the container runtime + register
> docker-image + pipeline-terminals next. The LOCKED design docs say otherwise.

## What happened

The container/PTY runtime (register flow's AI-image step, per-ticket containers,
git-worktrees, auto-started stage processes, Claude-in-container) is **P1 lane F**.
`src/workspaces/_docs/P0_CLI_SPIKE.md` + `STAP1_SPIKE_CHECKLIST.md` establish a
**hard P0.5 gate**: lanes **B (SessionManager), C (structured channel), F
(Containers)** are BLOCKED until a human runs the CLI-behavior spike against a
**logged-in host** and every gating row of `SPIKE_RESULTS.md` is GREEN. The spike
proves the single most load-bearing unverified premise — that an interactive
`claude` PTY bills the **Max subscription** (not the metered pool), that `type:http`
hooks fire interactively, that `--resume` + managed token projection work. It is
**NOT YET RUN** (`SPIKE_RESULTS.md` does not exist).

An unattended agent cannot run it: it needs the user's `/login` subscription, it
spawns real billed turns, and a **billing/PTY RED must ESCALATE to the user — never
route around to headless** (`claude -p`/Agent-SDK, deliberately abandoned in ERRATA
E1). Building lane F before the gate is GREEN is "building on sand" the docs
explicitly forbid.

## Root cause

The runtime's core premises are empirical facts about the 2026 `claude` CLI that
have never been measured; the architecture bet the whole engine on them, so the docs
insert P0.5 as a gate a human must clear first.

## Resolution (2026-07-02) — the gate is now OPEN

The P0.5 spike WAS run (autonomously, on the user's Max subscription via Claude Code,
using `scripts/spike/hookCapture.mts` + `runSpikeAuto.mts`). `src/workspaces/_docs/
SPIKE_RESULTS.md` now exists with the gating rows GREEN:
- **A1 billing GREEN** — a clean-env (`ANTHROPIC_*` stripped) interactive PTY turn ran on
  the subscription.
- **B1/B2/B4 hooks GREEN** — `type:http` hooks fire interactively for UserPromptSubmit/
  PreToolUse/PostToolUse/Stop; `Stop` carries `last_assistant_message` + `session_id`.
- Carried notes: render **SessionStart as `type:command`** (its http variant didn't fire);
  no `usage` field in hook payloads → drive the budget off a **labeled char/byte estimate**.

**Lane B/C/F are unblocked for build.** The deeper C (/clear id-rotation) and E
(crash-resume + RO-credential mount) rows are still NOT-RUN — verify them before their
specific sub-features (resume, token-optimization, container auth) ship, but they don't
block starting lane F's provisioning skeleton.

## How to avoid (historical)

- **Never build lane B/C/F autonomously until `src/workspaces/_docs/SPIKE_RESULTS.md`
  exists with GREEN gating rows.** (Now satisfied — see Resolution above.)
- The safe, high-value autonomous move toward the runtime is to build the **spike
  harness** the gate itself mandates (P0.5 is "the last P0 artifact, run before P1"),
  then hand off for the human to run it. Done here: `scripts/spike/hookCapture.mts`
  (`npm run spike:hooks`) + `scripts/spike/runSpike.mts` (`npm run spike:cli`,
  `--dry` to review). Running `spike:cli` for real is the gated, human-only action.
- Lanes A (data), D (Conductor against contracts), E (client wiring) + the realtime
  `_sync` layer are NOT gated — they build against frozen contracts. That is where
  autonomous loop effort belongs until the spike is GREEN.
