---
title: Push fans out on the automation + AI-suggestion notification sites (A1 fast-follow)
status: accepted
date: 2026-07-07
tags: [push, notifications, automation, freedom-program]
---

## Context

FREEDOM_PROGRAM item **A2**. A1 wired `sendWebPush` into the single assignment-notify choke-point only. The two
other runtime notification sites — the automation `notify` action and `invoke-agent-role` (both a `createMany`
fan-out over all members) — created in-app notifications but no push, so a member with the app closed missed
automation + AI-suggestion events on their phone.

## Decision

- A `sendWebPushMany(prisma, userIds, payload)` helper (best-effort per user, never throws) added to
  `webPush.ts`. Wired in right after both `notification.createMany` sites in `executor.ts` so every in-app
  notification is mirrored to the members' devices. Same tag scheme (`ticket-<key>`) as A1 for coalescing.

## Rejected alternatives

- **A single `notify()` helper replacing all `create`/`createMany` sites.** The three sites differ (single vs
  fan-out, different types/deep-links); a one-size helper would flatten those. Adding the push call next to
  each existing write is smaller + surgical, and keeps the notification shapes untouched.
- **Wire the needs-input banner too.** The real-question `needsInput` banner is set through the structured
  Stop-hook channel, not a clean server-side `notification.create` seam; pushing on it needs that write site
  identified first — a documented follow-up rather than a guess. The user still gets a push for assignment +
  automation + AI-suggestion events today.

## Consequences

- Automation-driven + AI-suggestion notifications now reach the phone, not just the in-app bell — the man-in-
  the-middle is reachable for the events the engine already broadcasts. `sendWebPushMany` is the reusable
  fan-out primitive for any future notification site. Needs-input push + per-type preferences (A3) are next.
