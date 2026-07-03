---
id: 0025
title: Cost/usage tracking — record token estimates, display only (no hard stop)
status: accepted
date: 2026-07-03
tags: [workspaces, usage, spend, tokens, observability]
supersedes: []
---

# 0025 — Cost/usage tracking (visibility only)

## Context

Goal-item #16 (+ the display half of #17). `SpendRecord` was written NOWHERE and
`AgentSession.tokenEstimate` was never populated, so the Usage page showed hardcoded seed dummies
(`SPEND_7D` / `USAGE_ROWS`) and the board cost-chip was a mock. The user wants real usage FIGURES,
**visibility only — never a hard stop** (the CapacityManager #12 is the concurrency control).

## Decision

- **Record per turn.** `server/spend/record.ts` `recordTurnSpend` runs after every turn (best-effort,
  wrapped in `tryCatch` — advisory, never fails the turn): it estimates tokens from the CHAR count
  (input ≈ the rendered CLAUDE.md + stage instructions, output ≈ the assistant message — the Max
  subscription's CLI exposes no usage field, per the P0.5 spike), writes a `SpendRecord`, bumps the
  session's running `tokenEstimate` (feeds the #4 self-handoff), and increments the enabled budgets'
  rolling `spent` ONLY when a per-model price is set (0 on the subscription). **No enforcement /
  pause anywhere** — #16 is show-only.
- **Aggregate + display.** `aggregateUsage` (pure, unit-tested) rolls `SpendRecord` rows into
  per-ticket token totals + a dense 7-day activity series + workspace totals. The snapshot fetches
  the tenant-scoped rows and emits `usage`; the Usage page renders it (real bars + a real per-ticket
  table, replacing the dummies) and each board ticket gets a real `<tokens> tok · <turns>×` cost
  chip. Token VOLUME is the metric, not money (subscription).
- **Real usage/spend from #17 folded in here** (ADR 0024): display + recording belong together.

## Rejected alternatives

- **A hard spend cap / pause.** Explicitly rejected by the user ("ALLEEN tonen, GEEN harde stop").
  The budget's `enforcement`/`cap` fields stay for a future opt-in, but #16 never acts on them.
- **Exact token accounting.** The subscription CLI gives no usage numbers; a char/4 estimate is the
  honest, documented approximation (advisory, not billing-grade).
- **Wire the display before any recording (the #17 ordering).** Would show zeros + be reworked;
  recording + display shipped together here.
- **Per-tenant price hardcode.** Prices live in an (extensible) map defaulting to 0 so a self-host
  operator on a metered API can set real prices without touching the record path.

## Consequences

- The Usage page + cost chips show REAL token usage; it grows as the engine runs turns.
- Cost stays 0 under the subscription; the structure supports metered pricing later.
- Verified: `spend.test.mts` (17/17) — `estTokens`, `aggregateUsage` (per-ticket sums, ObjectId→key
  mapping, dense 7-day series, zero-fill), and `recordTurnSpend` (SpendRecord persisted +
  `tokenEstimate` incremented). Full suite 27/27. Browser: the Usage page renders real per-ticket
  rows (DEV-1 2000/560/2×, DEV-2 600/150/1×) + activity bars from inserted rows, no dummies.
