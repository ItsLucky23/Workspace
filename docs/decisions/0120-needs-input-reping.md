---
title: The watchdog re-pings the assignee about a stale open question (A5, first half)
status: accepted
date: 2026-07-07
tags: [approvals, watchdog, notifications, freedom-program, phone-first]
---

## Context

FREEDOM_PROGRAM item **A5**. A real open question (`Ticket.needsInput`) parked FOREVER: the ticket waited,
whoever opened it first answered, and nobody was actively told it was still waiting. For a phone-first
man-in-the-middle that means a question can silently rot.

## Decision

- The watchdog sweep gains a third responsibility: for every ticket with a REAL `needsInput` banner, it
  baselines `Ticket.remindedAt` on first sight (no immediate ping), then **re-pings the assignee** (routing —
  `assigneeId`, falling back to `creatorId`) at most once per `WS_NEEDS_INPUT_REMIND_MIN` (default 120 min) via
  a `reminder` notification + a web-push. `remindedAt` is cleared on the answer path, so a fresh question
  starts a fresh clock. A pure `shouldRemind(remindedAt, now, intervalMs)` drives the timing (unit-tested;
  `now` injected).

## Rejected alternatives

- **Ping immediately on detection.** The question was just asked (and the asker/opener may already be on it);
  the value is catching a question that's gone STALE, so baseline-then-interval.
- **Ping every member.** Routing to the assignee is the point (A5) — the person who owns the ticket, not the
  whole workspace (that would re-create the notification noise A3 just tamed).
- **A `needsInputAt` timestamp.** Would need the Stop-hook banner-write site to set it; `remindedAt` baselined
  on first watchdog sight is self-contained and needs no change to that (harder-to-reach) write path.

## Consequences

- A stale question now nudges its owner instead of rotting. The structured approve/reject/choice affordances
  (the other half of A5 — replacing the bare answer box) remain a follow-up; they need the answer-flow UI +
  a `request-input`/`answer-input` op pair. The re-ping (the "reminders + routing" half) ships now.
