---
title: Media cost is shown BEFORE the user spends — per-action € estimate + per-piece spend surfaced from the snapshot
status: accepted
date: 2026-07-07
tags: [content, media, cost, ux, freedom-program]
---

## Context

FREEDOM_PROGRAM item **Q1**. `estimateMediaCostCents` was computed server-side (used only by the budget
guards) and never reached the UI: the generation confirm showed a number-free "may cost money" warning, and
spend was visible only as a workspace total (retrospectively, on Insights). A user could not tell that a
`video-gen` (40¢) costs 20× a `tts` (2¢) until after paying — a pay-first, blind experience.

## Decision

- The per-feature € estimate table (`STUB_COST_CENTS`, the single source of truth) is exposed via a new
  `mediaCostTable()` and carried in the content snapshot (`ContentSnapshot.mediaCosts`). The piece UI shows a
  "≈ €X" chip on each metered generation action and folds the estimate into the confirm body (per-item actions
  like per-beat images show "≈ €X / item"). Non-metered actions (script/assemble) show no chip.
- Per-piece spend is surfaced (`ContentPieceSummary.spentCents`, grouped from the `MediaSpend` rows the system
  already records per `contentProjectId`) and shown on the piece header.

## Rejected alternatives

- **A hardcoded client-side cost map.** Would drift from the server `STUB_COST_CENTS`; surfacing the table
  through the snapshot keeps one source of truth.
- **A live per-provider quote before each run.** Real providers don't return a stable pre-call price and it
  would add a network round-trip per hover; the declared per-feature estimate is honest enough for a pre-spend
  signal and matches what the budget guard actually uses.
- **Show only the workspace total (status quo).** Doesn't answer "what will THIS action cost" — the exact
  question a user asks before clicking.

## Consequences

- The user sees the € cost of an action before committing, and each piece shows what it has cost — the
  pay-first blindness is removed. When live provider costs replace the stub estimate, the same surface shows
  the real number (the estimate function is the seam).
- Foundation for S1 (dry-run/cheap preview): the estimate makes a "preview is cheaper" comparison meaningful.
