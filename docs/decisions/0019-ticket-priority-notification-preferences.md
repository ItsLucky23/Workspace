---
id: 0019
title: Ticket priority (one field, `urgent` = hotfix tier) + notification preferences
status: accepted
date: 2026-07-03
tags: [workspaces, schema, tickets, notifications, capacity]
supersedes: []
---

# 0019 — Ticket priority + notification preferences

## Context

Goal-item #13 (the schema dependency the CapacityManager hard-cap #12 leans on): tickets
need a **priority**, and a **hotfix/security** ticket must be able to force past the future
concurrency cap (still needing approval to merge). Separately, users need **notification
preferences** so the in-app assignment bell can be opted out of.

The user framed the hotfix flag as *"priority=urgent / isHotfix"* — leaving the shape open.

## Decision

**One `Ticket.priority` string field** (`low | normal | high | urgent`, default `normal`),
NOT a separate `priority` + `isHotfix` pair. `urgent` **is** the hotfix/security tier: #12's
admission queue will admit an `urgent` ticket past the workspace concurrency cap (merge still
gated on ≥1 approval, per ADR 0018).

- Conductor (single writer, B-23) validates priority against the enum on `quick-add` /
  `ticket-edit` via `asPriority()`; an invalid value is dropped, never persisted.
- Read path: `toTicket` maps the column (legacy rows without it fall back to `normal`).
- Frontend: a shared `_functions/priority.ts` (label i18n keys + theme-token dot colours);
  a priority `Dropdown` in the create form + the ticket-detail Overview; a `high`/`urgent`
  dot on the board card; the `urgent` hint spells out "skips the capacity cap · still needs
  approval to merge". i18n en/nl/de/fr.
- **Notification preferences** ride the EXISTING `User.preferences` JSON (no new column —
  Mongo is schemaless for scalars and the column already exists for `notifyOnNewSignIn` /
  `notifyOnPasswordChange`). A new opt-**out** key `notifyOnAssignment` (default on) gates the
  Conductor's `notifyAssignment` producer; the settings page adds a toggle. `togglePreference`
  now takes the effective current value so a default-on opt-out flips correctly on first click.

## Rejected alternatives

- **Separate `isHotfix` boolean + `priority`.** Two overlapping flags can contradict
  (`priority=low, isHotfix=true`?). One ordered field is unambiguous and matches the user's
  own "priority=urgent" option. `urgent` carries the force-through semantics.
- **A dedicated `NotificationPref` model / new column.** Redundant — `User.preferences` JSON
  is exactly this and is already wired through the session + settings route.
- **Enum type in Prisma.** Mongo + the existing free-string convention (`status`, `stageId`)
  favour a validated string over a Prisma enum (which would need a migration on every new tier).

## Consequences

- #12 has its `urgent` force-through flag ready.
- Priority is create/edit/persist/badge/round-trip verified in the browser; the notification
  gate is integration-tested (`ticketPriority.test.mts`: opt-out → no notification, default →
  notification).
- **Known blocker (pre-existing, framework, NOT this change):** saving notification
  preferences via `settings/updatePreferences` fails with *"input nesting exceeds the maximum
  depth of 64"*. Root cause is a bug in `@luckystack/core` `validateType`: the union branch
  (`type.includes("|")`) fires on a **nested** `|` inside an object type (e.g. the
  optional-boolean `undefined | false | true`); `splitTopLevel` finds no top-level split, so it
  re-recurses on the same string → infinite recursion until the depth-64 guard. It affects the
  route regardless of 2 or 3 boolean fields (the existing two toggles fail identically) and one
  of the "33 degraded routes". Unfixable from a consumer repo (no `packages/` here). The pref
  **gate** works; only the settings **save** round-trip is blocked. Reported for a framework fix.
