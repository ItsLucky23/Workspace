---
id: 0047
title: Delivery analytics — on-request fold over the append-only log (tokens, not €)
status: accepted
date: 2026-07-06
tags: [analytics, insights, tokens, expansion-g1]
supersedes: []
depends_on: [0025]
---

# Delivery analytics

## Context

G1 un-defers PRODUCT_ANALYTICS: cycle-time, throughput, stuck-points, and token-cost-by-type, folded over
the append-only `TicketEvent` + `SpendRecord`/usage log. The `computeInsights` fold already exists
(avgCycle/throughput/avgTokens); G1 adds the fuller analytics + a dashboard surface. Cost in TOKENS, not €
(invariant #9 — the parked price-blocking).

## Decision

1. **A PURE on-request fold — no new write path/model/verb** (`server/obs/analytics.ts` `computeAnalytics`).
   It folds tickets + the already-aggregated usage into: cycle-time **p50/p85** (p85 = the robust "how long
   does it really take", not a mean skewed by outliers), **weekly throughput** (4 buckets), **stuck-points**
   (tickets parked in stuck/paused/needs-input), and **token cost by label** (cost per work TYPE). `now` is
   injected → deterministic + unit-testable. Advisory — it gates nothing.

2. **Surfaced on the Usage page** — the snapshot emits `analytics` (alongside the existing `insights`); the
   Usage page renders a "Delivery analytics" card (p85/stuck/weekly stat cards + a throughput bar chart +
   a tokens-by-type list). No new page/route.

## Rejected alternatives

- **Cost in €.** Rejected — invariant #9: token-usage display only; € hard-blocking stays parked. The
  fold reports tokens.
- **A persisted analytics rollup / materialized view.** Rejected — PRODUCT_ANALYTICS specifies an on-request
  fold over the append-only log (no new write path); the fold is cheap for bounded workspaces.
- **Mean cycle time only.** Rejected — a mean hides the tail; p85 is the operator-meaningful "worst common
  case". p50 is shown alongside for the median.

## Consequences

- New `server/obs/analytics.ts` + `WorkspaceAnalytics` type; snapshot `analytics`; a Usage-page card.
- Reuses the `aggregateUsage`/`computeInsights` shapes; no new model, no new op.
- Completion anchor is the ticket's last update (a `done` ticket has no explicit doneAt — matches
  `computeInsights`); a precise merge/final-done anchor is a later refinement.
- Follow-ups: agent-quality trend (needs a quality signal per turn); per-project analytics scoping; a
  precise completion timestamp.
