---
id: 0312
title: Sub-navigation and explanation live in the URL and in three shared primitives
status: accepted
date: 2026-08-18
tags: [ia, ux, routing, accessibility, onboarding]
supersedes: []
---

## Context

The owner raised three complaints that turned out to be one problem seen from three sides:

1. A pipeline stage shows "system prompt 3 of 5" — useful, but there is nowhere to learn what the
   other four are or where they live. More generally: the app knows things it never tells you, and
   the only way it currently tells you anything is by putting another paragraph on the screen.
2. A field that picks from an empty collection (link a context document, attach a skill) renders an
   empty list and dead-ends. On a fresh workspace almost every picker is empty, so a new user meets
   nothing but dead ends, and nothing says where such a thing is created.
3. The workspace Repository tab piles a repo link, a Dockerfile editor and two command inputs into
   one column. It is simultaneously overfull and missing things, and the owner could not tell what
   was even there. Their proposal was a third level of navigation.

Underneath all three: `/workspaces/workspace` always landed on the default tab. Tab and section were
React state, so nothing inside a page could be linked, bookmarked, or returned to with the back
button, and a refresh lost your place. The "fix it over there" deep-link therefore needed a SECOND
mechanism — a focus request pushed through context that the target page consumed and cleared — and
when the two disagreed, the user landed on the wrong tab.

## Decision

**Sub-navigation is an address, and explanation is three shared primitives.**

1. **URL trail.** `/workspaces/<category>/<view>/<tab>[/<section>]`. `TRAIL_ROOTS` in `_data/nav.ts`
   is an allowlist of PATH prefixes (not view ids, because `/workspaces/content/settings` resolves to
   the view `content` so the rail keeps highlighting Content). `useTrailSegment(depth, ids, fallback)`
   reads a level and validates it against the ids that actually exist; writing a level clears the
   deeper ones. `focusSetup` navigates to a URL; the parallel `settingsFocus` state is deleted.
2. **`InfoTip`** — one progressive-disclosure affordance, on the framework `Popover` (auto-flip,
   Escape, outside-click, `aria-haspopup`). Opens on click/Enter/Space everywhere and additionally on
   hover where the pointer supports it. Its `points` list is the part that earns its keep: each row
   may deep-link to where that part is edited. House rule — a tip may only answer *where does this
   come from* · *what else affects it* · *what happens if I change it*.
3. **`EmptyPicker`** — `SetupNotice` at row scale: what is missing, and a permission-aware deep-link
   to where you create one.
4. **`PageSections`** — one section visible at a time, each an address, with a section index that
   doubles as the answer to "what else is in here?".

Which pages get sections is decided per page against a strict bar (≥3 concerns with genuinely
different lifecycles, AND the split reduces what is on screen), with **do-not-split as the default**.

## Rejected alternatives

- **A third navigation level in the rail, as proposed.** Rejected: it moves the crowding one level
  down across 29 pages that mostly do not need it, and three rows of chrome above the content is
  worst on the phone this product is designed around. Sections inside the page that needs them cost
  nothing on the pages that do not.
- **Keep tab/section in React state and add a query parameter for deep links.** Rejected: two
  representations of one thing is what caused the original bug. A path segment is the representation.
- **Let every view carry a trail.** Rejected — several paths after a view are already real routes
  (`/develop/board/<ticketId>/editor`, `/content/<pieceId>`); treating those segments as
  sub-navigation would read a ticket id as a tab name.
- **Keep the CSS-only hover tooltip.** Rejected: hover-only means the explanation does not exist on
  a touch device or for a keyboard user, and a fixed-width `absolute` box clips inside scroll
  containers. Both were true of the existing `InfoDot`, which is now a thin adapter over `InfoTip`
  so its fourteen call sites are fixed without touching them.
- **Render all sections stacked with a sticky index (scroll-spy).** Rejected: it organises the
  crowding without reducing it, and the goal is fewer controls on screen at once.
- **Let an audit propose sections everywhere and prune afterwards.** Rejected in favour of biasing
  the scan against itself — the default verdict is do-not-split, and every split proposal is
  independently refuted before it is accepted. An audit that finds work on every page is noise.

## Consequences

- Every page-level tab is now linkable. `/workspaces/workspace/repository/runtime` is a URL you can
  send someone, which is what makes the "fix it over there" affordance honest.
- Deleting `settingsFocus` removes a state channel; three pages that consumed it now read the URL.
  A fourth deep-link (`focusSetup({ view: 'pipeline', tab: stage })` from Sources) was silently
  BROKEN — the pipeline page never consumed the focus request — and works for the first time.
- An unknown or gated-away segment falls back to the page's first valid option rather than rendering
  blank, so stale bookmarks and shared links to surfaces the recipient cannot see degrade gracefully.
- `InfoTip` inherits the coarse-pointer 44px minimum from `index.css`, so on touch the trigger grows
  the row it sits in. That is the correct trade: an explanation you cannot tap is not an explanation.
- The house rule for tips is a rule, not a guideline — a tip that restates its label must be removed
  in review, or the affordance recreates the crowding it exists to relieve.
