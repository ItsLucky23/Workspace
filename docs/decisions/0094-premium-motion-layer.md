---
title: Premium feel comes from a shared motion layer, not per-page ad-hoc animation
status: accepted
date: 2026-07-07
tags: [ui, motion, design-system, consistency]
---

## Context

The overnight goal asked for a "premium feel" with clean animations everywhere, plus clarity + a
consistent, trusted look for first-time users. The workspaces UI already had a mature shared primitives
kit (`primitives.tsx`: WsButton/IconButton/Tabs/SectionCard/EmptyState/InfoDot/StatusPill/PopMenu…) and
a shared motion module (`motion.tsx`: spring presets + Popover/Sheet/Backdrop, with global
`MotionConfig reducedMotion="user"`). So consistency was largely a solved problem — the risk was
*adding* animation, which if done per-page and blind (no browser to verify) tends to look busy or janky.

## Decision

Deliver the premium feel through the SHARED layer, in the fewest, safest places:

- **One shell-level page transition.** `PageTransition` (in `motion.tsx`) wraps the routed content in
  `WorkspacesShell`, keyed on the route — every one of the ~19 pages gets the same snappy fade+lift on
  navigation from a SINGLE call site (`mode="wait"`, 0.17s, so pages never overlap). No per-page churn.
- **Tactile primitives.** `WsButton`/`IconButton` gain a `motion-safe:active:scale` press — a universal
  micro-interaction that propagates to every screen through the shared components.
- **A `Reveal` stagger primitive is provided but NOT force-applied.** Because the page already animates
  in via `PageTransition`, stacking a per-item reveal inside it would double-animate and read as busy.
  `Reveal` is available for a deliberate, browser-verified opt-in later.

All motion is theme-token-based and reduced-motion-safe (global `MotionConfig`).

## Rejected alternatives

- **Per-page bespoke animations.** Maximal churn across 19 files, inconsistent by construction, and
  high-risk to author without a browser to verify — the opposite of a "trusted, familiar" feel.
- **Staggered reveals on every list now.** Combined with the page transition it over-animates; better as
  a considered opt-in once the base transition is seen in a browser.
- **A heavier slide/scale page transition.** On a dashboard the user navigates constantly; a big motion
  on every click becomes annoying. A short, subtle fade+lift is premium without being in the way.

## Consequences

- Every page enters consistently; every button feels tactile — a coherent premium layer with almost no
  per-page code. The `Reveal` primitive + the existing `EmptyState`/`InfoDot` (clarity for first-time
  users) are ready for targeted use. Browser visual-verify (the user's morning step) can tune the exact
  durations; the foundation is centralised so tuning is a one-file change.
