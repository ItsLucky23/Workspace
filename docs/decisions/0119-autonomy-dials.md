---
title: Per-workspace autonomy level modulates the per-stage approval gate ("ask me less")
status: accepted
date: 2026-07-07
tags: [autonomy, approvals, engine, freedom-program, phone-first]
---

## Context

FREEDOM_PROGRAM item **A4**. `PipelineStage.gateForApproval` gated a stage per-flag, but there was no UI and
no coarse "ask me less / ask me more" control — a workspace couldn't say "just run everything" or "check with
me at every step". The man-in-the-middle had a fixed cadence.

## Decision

- `Workspace.autonomyLevel` (default `gate-key-stages`) with three levels. A pure
  `resolveStageGate(stageGate, level)` in `stageRunner` computes the effective gate:
  `full-auto` → never gate (skip non-destructive approvals), `gate-every` → gate every stage, `gate-key-stages`
  → honour the stage's own `gateForApproval` (the prior behaviour). Used at BOTH gate decisions in the
  done-branch (advance + push-for-approval), so full-auto advances AND doesn't open an approval MR.
- A `save-autonomy` control-op + `_sync` route + snapshot field + an AI-tab dropdown, mirroring the
  `save-sections` module-gating pattern.

## Rejected alternatives

- **A boolean auto-approve.** Three levels map to the real intents ("check everything" for a nervous first
  run, the default, and "just go"); a boolean loses the middle.
- **Make full-auto skip destructive confirms too.** Destructive/irreversible actions confirm on their own B-23
  path (single-writer + explicit confirm) — the autonomy dial only governs the routine stage-approval gate,
  never the destructive-confirm. This is a safety invariant, not a preference.
- **Per-stage override of the level.** The stage already has `gateForApproval`; the workspace level modulates
  it. A per-stage autonomy override would double the knobs for little gain.

## Consequences

- A workspace tunes how often it's interrupted without editing every stage. `full-auto` runs the pipeline
  end-to-end (still stopping for real needs-input questions + destructive confirms); `gate-every` babysits.
  The gate is a pure, unit-tested function. Structured approvals / routing (A5) build on this.
