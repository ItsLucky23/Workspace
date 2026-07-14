---
name: ship-luckystack-cron-reversing-no-cron
title: Ship @luckystack/cron (leader-elected scheduler) — reversing the "deliberately no cron" extension-points position
status: accepted
date: 2026-07-09
deciders: [ItsLucky23]
tags: [cron, scheduler, packages, multi-instance, redis]
supersedes: []
relates: [0011]
---

## Context

`docs/ARCHITECTURE_EXTENSION_POINTS.md` deliberately shipped NO cron primitive: an in-process `registerScheduledJob` fails in multi-instance deploys without a distributed lock, and the framework did not want to reinvent bull/agenda's Redis leader election. That position predates core's `lease.ts` (`acquireLease`/`renewLease`/`releaseLease`, SET NX PX + owner-checked Lua) — a primitive whose own header names "cron" as an intended consumer and which had zero runtime consumers. Meanwhile a real consumer project (Workspaces) accumulated ad-hoc `setInterval` loops (worker-reaper, scheduled publish, analytics ingest) that double-fire the moment a second instance starts, and asked for: leader-aware scheduling, Redis-backed job bookkeeping, declarative registration in the framework's tryCatch/error-tracking context, per-tenant fan-out, overlap guards + jitter, and observability.

## Decision

Ship an optional `@luckystack/cron` package (NOT a core/server feature). It composes existing primitives: leadership via core's lease (single scheduler lease, renew loop; the lease header's "the renew loop is app code" contract fulfilled here), per-run dedup leases, `registerCronJob({ name, schedule, handler, ... })` with croner-parsed cron expressions (bundled dep — hand-rolling a cron parser is the classic DST/DOM-DOW footgun) or `{ everyMs }` intervals, per-tenant fan-out via a consumer-supplied `tenants()` callback, Redis stats hashes, `preCronRun` (veto) / `postCronRun` hooks, lazy start on first registration, teardown via `preServerStop` (ADR 0011). Auto-wired through `OPTIONAL_PACKAGES` + a `luckystack/cron/` overlay slot; manageable via the CLI as a toggle. The extension-points doc now recommends the package first, keeps bullmq (queues) and external schedulers (out-of-process) as the reach-past patterns, and records the reversal.

## Rejected alternatives

- **Keep the slot empty (status quo)** — rejected: the "would demand a Redis leader-election" objection is obsolete now the lease primitive exists in core; consumers were hand-rolling worse versions.
- **Core/server built-in** — rejected: bloats the mandatory install for single-backend apps; contradicts the optional-package architecture (presence/email precedent) for exactly this kind of feature.
- **Wrap bullmq** — rejected: pulls a heavy queue dependency into every consumer for what is a scheduling (not queueing) need; bullmq remains the documented answer for retries/priorities.
- **File-based `_cron/` routing convention in v1** — deferred, not rejected: it needs devkit discovery + codegen changes (a `crons` map beside `apis`/`syncs`); the programmatic API ships first and the convention can layer on top later.
- **Hand-rolled cron-expression parser** — rejected: DST transitions and day-of-month/day-of-week OR semantics are exactly where home-grown parsers break; croner is zero-dependency and Intl-based.

## Consequences

- Jobs must be idempotent: the lease is single-Redis best-effort (not Redlock) — a leader stalling past its TTL can hand over mid-run; the per-run lease reduces but cannot eliminate double-fires. Documented in the package CLAUDE.md + deep dive.
- No catch-up semantics: ticks missed while leaderless are skipped — jobs needing guaranteed execution windows should persist their own watermark.
- Follow-up work: `_cron/` file convention (devkit + codegen), optional scaffold-wizard selectability (currently add-later via `npx luckystack add cron`), and a `luckystack doctor`-style stats surface.
- The EXTENSION_POINTS "Scheduled jobs" section is amended in the same change (package-first, history preserved).
