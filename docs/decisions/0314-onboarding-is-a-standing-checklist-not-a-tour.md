---
id: 0314
title: Onboarding is a standing checklist, not a tour
status: accepted
date: 2026-08-18
tags: [onboarding, ux, ia]
supersedes: []
---

## Context

A fresh workspace is a wall of empty pickers: no repository, no AI key, no context documents, no
notifications, no channel. ADR 0312 gave every one of those a local explanation — `SetupNotice` at
page scale, `EmptyPicker` at field scale — but both only speak once the user has already walked into
the feature they block. Nothing ever said what "set up" means for this workspace, so the honest
answer to "why does nothing work yet?" was: go and find out, one blocked screen at a time.

A `SetupWizard` already existed: a three-step modal covering a media key and a spend budget, reached
from a link on the workspace settings page. It is a good front door for two specific settings, but it
is modal, partial, and reachable only from a page a new user has no reason to open.

When asked, the owner chose a standing checklist over both a bare set of field-level redirects and a
guided first-run tour.

## Decision

**A persistent, self-retiring checklist on the landing view.**

`SetupChecklist` renders above the page content on the two category index views (`board`, `content`),
listing what is left to configure. Each row deep-links to the exact place that fixes it, via the
URL-addressed `focusSetup` from ADR 0312 — a checklist that says "go to settings" without taking you
there is a worse version of the problem it solves.

Three properties make it a checklist rather than a nag:

- **It invents no state.** Every row reads a `readiness` boolean the snapshot already computes.
- **It is module-aware.** A content-only workspace is never told to link a git repository.
- **It retires itself** once everything measurable is done, and can be dismissed per workspace
  (localStorage — a device-local UI preference, not workspace state, so it needs no control-op).

Rows the current user lacks the capability to complete stay visible but show "ask someone with X"
instead of a button, matching `SetupNotice`.

## Rejected alternatives

- **A guided first-run tour.** Rejected on the owner's call and on the merits: a tour interrupts
  before the user has a question, is clicked away, and is gone by the time it would have helped.
- **Field-level redirects only (no checklist).** Rejected: that is ADR 0312, and it is necessary but
  not sufficient — it explains a gap only after you have walked into it.
- **Extend the existing `SetupWizard` into a full stepper.** Rejected: a modal blocks the app to ask
  questions in a fixed order, and setup is not sequential — a user may link a repo today and connect
  a channel next week. The wizard stays as the fast path for its two settings.
- **Derive completeness from a new server-side `setupComplete` flag.** Rejected: it would be a second
  source of truth for facts `readiness` already reports, and it would go stale the moment a key is
  revoked. Deriving it on the client means the list reappears when setup genuinely regresses.
- **Show it on every view until complete.** Rejected — that is the definition of a nag. Twice on the
  landing views is enough to be found.

## Consequences

- Two rows — choosing a start command, and adding a first context document — have no readiness
  boolean, so they always read as outstanding. They are therefore excluded from the completeness
  test: the list retires on the measurable rows and treats those two as guidance. If either later
  gains a real signal, move it into `measurable` and the list gets stricter for free.
- Dismissal is per workspace and per device. Re-appearing on another device is correct: the setup
  genuinely is unfinished there too.
- Any new readiness signal is one row here plus its four translations. Resist adding rows for things
  that merely *could* be configured — the list is what a workspace needs to work at all, and every
  optional row pushed in dilutes the ones that block.
