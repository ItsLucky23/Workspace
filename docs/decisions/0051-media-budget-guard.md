---
id: 0051
title: Media €-budget + pre-generation guard (F0.2)
status: accepted
date: 2026-07-06
tags: [content, budget, cost, metered, expansion-f02]
supersedes: []
depends_on: [0049, 0050]
---

# Media €-budget + pre-generation guard (F0.2)

## Context

Media APIs (Fal/Veo/ElevenLabs/3d) are **metered real-money** per generation — unlike the coding agent, which runs on the Max subscription and is accounted in tokens (invariant #9). A cron-driven content loop could run up a real bill, so a per-workspace **€-cap + pre-generation guard** is needed before any generation lands.

## Decision

1. **A `MediaBudget` model** — ONE row per workspace (`@@unique workspaceId`), `capCents`/`spentCents`/`alertPct`/`enabled`, opt-in (disabled by default). Cents (Int) — no float money.
2. **A pure guard `checkMediaBudget(prisma, ws, costCents)`** (`server/media/budget.ts`) → `{ ok, reason?, unlimited, capCents, spentCents, remainingCents }`. No budget / `!enabled` / `capCents<=0` = **unlimited** (always ok). Over cap → `ok:false, reason:'media.budgetExceeded'`. Pure read; the caller records on success. `recordMediaSpend(...)` writes the `MediaSpend` €-ledger row + debits `spentCents`. `getMediaBudgetStatus(...)` exposes the status (incl. `overAlert`) for the settings UI + snapshot.
3. **The budget is set via an `edit-media-budget` control-op** (B-23 write path) — capability `workspaceSettings`, Conductor upserts the row. The user never writes the budget directly.

## Rejected alternatives

- **Reuse `WorkspaceBudget`/`edit-budget` (the token budget).** Rejected — token budget is Floats in the period-window's unit for the subscription agent; media is metered € in cents with different semantics. A separate model keeps the two cost worlds distinct (invariant #9 stays token-only for the coding agent).
- **Throw from the guard.** Rejected — a pure `{ ok, reason }` check lets the gen path (F0.3+) surface a typed, user-facing block gracefully rather than crash; loud-fail is reserved for tenant/isolation violations.
- **Enforce the cap inside `recordMediaSpend`.** Rejected — the guard runs BEFORE the (paid) generation; recording happens after success. Splitting check-before / record-after is the correct order for a metered call.

## Consequences

- New `MediaBudget` model + `server/media/budget.ts` (check/record/status) + the `edit-media-budget` control-op (union + `OP_CAPABILITY` + Conductor case). The gen path (F0.3, F1.x) calls `checkMediaBudget` before enqueuing and `recordMediaSpend` after a stub/live result declares its `costCents`.
- `tests/integration/mediaBudget.test.mts` (12 assertions): the op sets the cap, the guard allows within / blocks over with the typed reason, `recordMediaSpend` debits + writes the ledger, exact-fill allowed, disabled = unlimited. Added `mediaBudget` to `cleanupWorkspace`.
