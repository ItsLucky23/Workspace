---
title: Premium-UX pass — keyboard-dismiss + the §0b invariants hold across the new surfaces (S4)
status: accepted
date: 2026-07-08
tags: [ux, a11y, freedom-program]
---

## Context

FREEDOM_PROGRAM item **S4** — a premium-UX sweep across every Fase Q–E screen (motion, empty-states/tooltips,
phone-first, a11y, consistency via shared primitives + theme tokens, reduced-motion). Most of this was applied
inline as each surface was built (theme tokens only, i18n on every string, `motion-safe:` tactile presses,
shared `WsButton`/`Dropdown`/`Toggle` primitives). The gap: the new full-screen overlays (the editors, the
wizard) were mouse-dismiss only.

## Decision

- A shared `useEscapeKey(onClose)` hook wired into the three new overlays (ImageRegionEditor, ImageEditor,
  SetupWizard) so they're keyboard-dismissible (a11y, §0b). The cross-cutting invariants — no untranslated JSX,
  no arbitrary colors — are enforced by `ai:lint`, which is **green repo-wide** across every new surface (the
  gate-able core of the §0b checklist).

## Rejected alternatives

- **A single monolithic "polish" commit rewriting every screen.** The polish was applied AS each surface shipped
  (that's why ai:lint stayed green the whole way); S4 closes the remaining shared gap (keyboard-dismiss) rather
  than re-touching everything.

## Consequences

- The new surfaces are consistent (tokens + primitives + i18n), tactile (motion-safe presses), and now
  keyboard-dismissible; `ai:lint` green confirms the translation + color invariants hold. The remaining part of
  S4 is inherently a **live mobile/visual pass** on the phone-first approval/answer/notification surfaces —
  browser-verified in a dev session (a developer action), not more code. Empty-states + tooltips per new panel
  are a documented follow-up.
