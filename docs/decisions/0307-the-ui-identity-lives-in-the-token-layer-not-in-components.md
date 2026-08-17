---
id: 0307
title: The UI identity lives in the token layer, not in components
status: accepted
date: 2026-08-17
tags: [ui, design-system, tokens, tailwind]
supersedes: []
---

## Context

The owner opened the finished app for the first time and reported the UI as "flat,
boring and depressing" — enough to kill the fun of using a tool that otherwise
works. A read of the code showed the cause was NOT sloppy components: the
workspaces UI already has a clean primitives layer (`WsButton`, `SectionCard`,
`StatusPill`, `Tabs`, …), uses theme tokens everywhere, and has no arbitrary hex.

What was flat were the *token values themselves*:

- `--color-primary` and `--color-secondary` were the identical default Tailwind
  blue `#3B82F6`, so the app had no accent hierarchy and no identity.
- Surfaces were cold neutral greys (`#F5F5F5` / `#EFEFEF`), the register of an
  unstyled admin panel.
- `font-family: system-ui` — no typographic voice at all.
- No elevation ladder, no radius ladder, no motion easing, no heading tracking:
  every surface sat on the same visual plane.

## Decision

Fix the design at the token layer first, and keep component changes secondary.
Concretely, `src/index.css` now defines:

- **Warm-neutral ("paper") surfaces** in light, and a warm-neutral ("ink") dark
  variant instead of the cold blue-black — a calm, content-first register, per
  the owner's chosen direction.
- **Two accents with distinct jobs**: teal `#0D9488` as the calm focus/state
  accent, terracotta-orange `#EA580C` as the scarce action accent. `primary` and
  `secondary` are no longer the same color.
- **Typography**: Plus Jakarta Sans for UI, JetBrains Mono for ids/code/metrics,
  plus an `@layer base` rule giving headings weight, negative tracking and
  balanced wrapping, and tabular numerals for tables/metrics.
- **Ladders for shape, elevation and motion**: `--radius-*`, warm-tinted
  two-part `--shadow-*` (redefined with deeper alphas under `.dark`, where
  shadow alone cannot separate surfaces), and `--ease-soft` / `--ease-emphasis`.

Rule 14 is unchanged and still binding: components consume tokens only, never
raw hex. The deviation this decision records is narrower — the *existing*
`@theme` block is not treated as frozen; re-tuning its values is the sanctioned
way to change the app's look.

## Rejected alternatives

- **Restyle components page by page.** Rejected: 38 pages consume the same
  tokens; per-page work would drift, cost far more, and leave the root cause
  (identical accents, cold greys, no type voice) in place.
- **Adopt the skill's `--design-system` output verbatim.** The `ui-ux-pro-max`
  skill returned a *landing-page* pattern ("Newsletter / Content First", hero +
  CTA form) — the wrong artifact for an app shell. Its color/typography/effects
  recommendations were taken; its page pattern was not.
- **Dark-first "modern dev tool" (Linear/Vercel).** A real candidate for an
  orchestration tool, rejected by the owner in favour of light + calm, because
  the product spans documents and content, not just a build cockpit.
- **Self-hosted fonts via `@fontsource-*`.** Deferred, not rejected: it needs an
  `npm install` (Rule 8) and matters for offline/air-gapped deployments. The
  Google Fonts `@import` is a two-line swap when that call is made.

## Consequences

- Every page changes appearance immediately, without being edited.
- Any component that hardcoded a *blue* assumption (e.g. an icon tint chosen to
  match the old primary) now reads teal; those are found by eye, not by lint.
- Dark mode must be re-checked per page: the neutral hue rotated from blue-black
  to warm ink, and `--color-title-primary` on dark is now a dark teal (text on a
  light `#2DD4BF` button), not white.
- Future UI work starts from the tokens: a change wanted app-wide belongs in
  `src/index.css`; only genuinely local decisions belong in a component.
