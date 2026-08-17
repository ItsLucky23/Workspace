---
id: 0309
title: Settings autosave per row, and one canonical account page
status: accepted
date: 2026-08-17
tags: [ui, settings, ia, forms]
supersedes: []
---

## Context

The UI audit found three unrelated persistence models coexisting, sometimes on one card:

- `src/settings/page.tsx` — a Save-button flow where the avatar autosaves anyway, and theme and
  language apply instantly but only persist on Save, with no dirty indicator at all.
- `src/workspaces/settings/page.tsx` Account tab — the same account fields, autosaving via
  `settings/updateUser`, reachable from the other page by a "Full Settings" link that lands on
  what looks like the same controls.
- Various workspace tabs — a mix, with one Admin tab carrying three different row grammars for
  the same "labelled setting" concept.

Separately, the audit's single loudest structural finding was that most pages degenerate into
heading + paragraph + input repeated down the page, because no shared row/section primitive
existed for authors to reach for.

## Decision

**One row grammar.** `SettingRow` + `FormSection` in `src/workspaces/_components/settings.tsx` are
the way a setting is rendered: label and quiet help text on the left, control right-aligned on the
right, hairline-separated rows inside a titled group. Long explanations go behind the row's `info`
disclosure, not into a competing paragraph. `stacked` handles textareas and anything needing the
full width.

**Autosave everywhere, with a per-row status pill.** `SaveStatus` / `SavePill` give each row its
own `saving` / `saved` / `error` affordance; a settled row shows nothing. No Save buttons, no
dirty badges.

**`/settings` is the canonical account page.** It already owns password, sessions, notifications
and the danger zone. The Workspaces settings Account tab becomes a summary with an "Edit in
account settings →" link and keeps only workspace-scoped operations.

**`/dashboard` redirects.** It was untouched framework sample scaffolding (a bare heading and
paragraph, no chrome) on a live route; it now redirects to `/workspaces`.

## Rejected alternatives

- **Explicit Save everywhere with a dirty badge.** Consistent and predictable, and rejected anyway:
  this product is phone-first and realtime-convergent, and a Save button loses work every time a
  user navigates away mid-edit — which on a phone is constantly.
- **Autosave for preferences, Save for identity/security fields.** Defensible, rejected because the
  user then has to guess which category a given field falls into. Security-sensitive actions that
  genuinely need a deliberate step (password, danger zone) already use their own confirm flow,
  which is a different mechanism from a form-wide Save button.
- **Make the Workspaces Account tab canonical.** Rejected: password, sessions, 2FA and the danger
  zone would have to migrate into the workspace shell — much larger work for no gain.
- **Keep both account pages backed by one shared component.** Rejected: identical behaviour in two
  places still leaves the user asking whether it is really the same setting.
- **Delete `/dashboard`.** Rejected in favour of a redirect: same cleanup, but old bookmarks keep
  working.

## Consequences

- Any page still rendering its own label-over-input pairs is now visibly off-pattern; migrating
  them is mechanical, page by page.
- Every autosaving row needs a real error path — a failed write must set `error`, not fail
  silently. That is the cost of dropping the Save button, and it is per-row work, not free.
- The framework's `dashboard` template is now unused by any page in this project; it stays in
  `TemplateProvider` for future use rather than being removed.
