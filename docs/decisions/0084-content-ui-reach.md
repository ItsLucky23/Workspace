---
id: 0084
title: Content UI — reachable board reading the content snapshot
status: accepted
date: 2026-07-06
tags: [content, ui, frontend, depth-program]
supersedes: []
depends_on: [0072, 0069]
---

# U1 — make the content platform reachable + visible

## Context

`GAP_ANALYSIS.md` content #1: there was NO content UI — no `content` view, no nav item, no route; the
`snapshot.content` loaded into the provider was read by NOTHING (dead state). The whole content lane was
invisible + unusable in the app.

## Decision

- A `content` nav item (Studio group, `wand-magic-sparkles`) + a real `src/workspaces/content/page.tsx`
  route (the generic `pathForView`/`viewFromPath` already route `content` → `/workspaces/content`;
  `VIEW_LABELS` gains `content`). `WsView` already accepted `(string & {})`, so no type change.
- The page renders a **content board**: 6 pipeline columns (idea → script → media → assemble → review →
  publish, mirroring server `CONTENT_STAGES`) reading `content.pieces` by `stageId`, each piece a card
  (title, format chip, status dot), plus a media **€-budget** summary bar (spent/cap/alert from
  `content.mediaBudget`). Clear empty-state for first-time users. All text via `useTranslator`
  (`workspaces.content.*`, 16 keys × en/nl/de/fr); only theme tokens + semantic status colors.

## Rejected alternatives

- **Reuse the ticket board component.** Rejected — content pieces have their own stages/format/budget
  shape; a purpose-built board is clearer for non-technical users than bending the dev board.

## Consequences

- `content/page.tsx` + the nav/label wiring + the 4 locale blocks. The content snapshot is now READ
  (dead state revived). U2 adds the piece detail + generation controls (the card's `content/<id>`
  target). Visual verification is browser-deferred; the build + i18n×4 + render-of-snapshot is the
  code-level verify.
