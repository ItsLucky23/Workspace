---
title: Per-type web-push opt-out (assignment / automation / AI-suggestion), default on
status: accepted
date: 2026-07-07
tags: [push, notifications, preferences, freedom-program]
---

## Context

FREEDOM_PROGRAM item **A3**. After A1/A2 every notification pushed to every subscribed device — all-or-nothing
(the only control was subscribing or not). A user who wants assignment pushes but not automation noise had no
way to tune it.

## Decision

- Three `User.preferences` booleans — `pushOnAssignment`, `pushOnAutomation`, `pushOnAiSuggestion` — all
  **opt-out** (default ON, matching the existing `notifyOnAssignment` bell convention). Added to the
  `updatePreferences` allow-list.
- `sendWebPush` / `sendWebPushMany` take an optional `PushCategory`; a pure `pushCategoryAllowed(prefs,
  category)` gate suppresses a push only when that category is explicitly `false`. The three call sites pass
  their category (`assignment` / `automation` / `aiSuggestion`).
- The settings notifications card shows the three per-type toggles, revealed once push is enabled.

## Rejected alternatives

- **A single master push on/off.** Subscribing already is the master switch; per-type is the actual ask (mute
  automation, keep assignments).
- **Opt-IN (default off).** Would silently drop pushes the user expects; opt-out matches the bell + is the less
  surprising default.
- **A per-workspace preference.** Push is framework-global (a user's device, like the subscription itself), so
  the preference lives on the user, not the workspace.

## Consequences

- A user can mute a whole category of push without unsubscribing. The gate is a pure, unit-tested predicate;
  the DB-loading wrapper reuses it. Autonomy dials (A4) + structured approvals (A5) are next.
