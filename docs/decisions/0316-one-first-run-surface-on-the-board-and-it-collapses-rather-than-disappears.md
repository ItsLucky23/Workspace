---
id: 0316
title: One first-run surface on the board, and it collapses rather than disappears
status: accepted
date: 2026-08-19
tags: [onboarding, ux, ia]
supersedes: []
---

## Context

The owner went to test something on `/develop/board` and instead found two separate onboarding
surfaces stacked at the top of the page, then permanently lost one of them by clicking a control that
looked like the other one. Everything they reported checks out in the code:

- **`SetupChecklist`** (ADR 0314) renders above the tab bar on the two landing views, `board` and
  `content`. For a dev+content workspace it lists 6 rows (7 once a repo is linked). Its header carried
  **two** icon-only buttons side by side: a chevron that collapsed it, and an `xmark` whose tooltip
  read "Hide". The X wrote `ws:setup-dismissed:<workspaceId>` to localStorage — a key that is written
  in one place, read in one place, and **cleared nowhere in the product**. Clicking it removed the
  checklist for that workspace with no way back short of devtools.
- **`OnboardingBanner`** (J1) renders inside the board page whenever the active project has zero
  tickets, as a 3-card grid in `border-primary-border bg-primary/8` — the only primary-outlined
  banner in that position, and visually much louder than the checklist's plain card.

So the sequence the owner described is exactly what the code does: dismiss the checklist (gone for
good), switch to a project with no tickets, and the second, louder banner appears in its place.

Two smaller findings came out of the same read:

- The banner's first step said "Connect a git repo" and its CTA called `navigate('settings')`, which
  is the **account** settings page (profile, sessions, web-push) — not the workspace Repository tab
  the checklist's own repo row deep-links to. Same task, two destinations, one of them wrong.
- The banner and the checklist overlapped on exactly one row (link a repository). The banner's other
  two steps — create your first ticket, ask the Workspace-AI — had no equivalent anywhere.

## Decision

**One first-run surface on the board: the checklist.** `OnboardingBanner` is deleted, and the two
steps that were genuinely its own move into the checklist.

1. **There is no "hide forever".** The X is gone; the chevron is the only control, and its state is
   remembered per workspace under a **new** key, `ws:setup-collapsed:<workspaceId>`. The old
   `ws:setup-dismissed:` key is read by nothing, so anyone who set it — believing, reasonably, that
   it meant collapse — simply gets their checklist back. Collapsed is a single slim title bar, which
   is what makes it recoverable at all.
2. **A step is either a place or an act.** `ChecklistStep` gains `action?: () => void` as an
   alternative to `target`. Creating your first ticket (`quickAdd`) and opening the Workspace-AI
   (`toggleAi`) are things you do, not settings pages you visit, and forcing them through
   `focusSetup` would have meant inventing a destination for them.
3. **Retirement is marked on the step, not in a list beside it.** Rows with no readiness signal —
   the dev command, the first context document, "has used the AI" — carry `guidance: true` and never
   keep the list alive on their own. This replaces an id list that a new row could silently fall
   outside of, making the checklist immortal.
4. **The checklist keeps the plain card style** (`border-container1-border bg-container1`), which is
   the shell used by the stage editor, the section cards and every other standing panel. The owner
   asked for consistency, and the primary outline was the outlier, not the norm.

## Rejected alternatives

**Keep both, only fix the dead end.** Offered as the minimal option and declined by the owner. It
leaves two answers to "what do I do first" competing for the same 200 pixels, which is the actual
complaint — the dead end was just how they noticed it.

**Keep the X and add a "show setup again" entry point** (in the workspace menu, say). Rejected: it
spends a menu slot on undoing a control that should not have existed, and the checklist already
retires itself once everything measurable is done. A collapse that is remembered gets the same
result — out of the way — without a second concept.

**Move the banner's steps into the checklist but keep its primary outline for the whole checklist.**
Rejected: the outline is what made it read as an interruption. A standing list that never goes away
on its own must be quiet, or it becomes a nag with a border.

**Track "has used the Workspace-AI" so that row is measurable too.** Rejected as scope: it needs new
persisted state for a row whose only job is to tell a new user the panel exists. `guidance: true`
says the same thing honestly.

## Consequences

- `workspaces.firstSteps.*` (8 keys × 4 locales) and `workspaces.checklist.dismiss` are removed;
  `checklist.firstTicket*` / `checklist.askAi*` are added.
- The board no longer teaches anything at zero tickets on its own — the checklist covers it, and it
  is mounted a level up in `WorkspacesShell`, so the mobile and desktop board branches no longer each
  need their own copy of that condition.
- A workspace where the user never creates a ticket keeps one collapsed title bar on the board. That
  is the intended trade: the step is genuinely unfinished, and it costs one row.
- Not changed, reported only: `content/settings/page.tsx` has a third primary-outlined setup block.
  It is on its own page rather than stacked with anything, so it is out of this decision's scope.
