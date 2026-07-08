---
title: G2 — greenfield template-wizard UI
status: accepted
date: 2026-07-08
tags: [greenfield, ui, wizard, scaffold, idea-to-outcome]
---

## Context

G1 made `project-from-template` produce a real repo, and both `createFromTemplate` (provider) and the
`templates` catalog (snapshot) were already exposed — but nothing in the UI rendered them, so a user could
never pick a stack template. G2 is the front door onto the greenfield op.

## Decision

- **Extend the existing `CreateProjectForm`** (the "New project" menu off the project switcher) with a
  two-mode toggle: **From a template** (greenfield — a stack-template picker → `createFromTemplate`, which runs
  G1's real-repo init) and **Link a repo** (the pre-existing name + git-URL → `createProject`). Template mode
  is the default (greenfield-first).
- **The picker is driven by the snapshot `templates`** (label + description cards, single-select). Submit
  branches on mode; the create button disables until a name (and, in template mode, a template) is chosen.
- **No new op, no new screen file.** The wizard is the create-project menu the switcher already opens, so it
  works for the first project and every later one.

## Rejected alternatives

- **A dedicated empty-state welcome page.** A fresh workspace already gets a default project, so the switcher
  (and its create menu) is always reachable; extending that one form is far less surface than a new routed
  screen and keeps a single project-creation entry point. A first-run welcome overlay is a later polish.
- **A separate "New from template" button next to "New project".** Two entry points for one concept (create a
  project) is more confusing than one form with a mode toggle; the toggle also lets a user flip between linking
  and scaffolding without leaving the dialog.

## Consequences

- A user can now create a greenfield project from a curated stack template entirely in the UI — pick a
  template, name it, create → G1 spins up a real repo + seed tree → container → code. The link-existing-repo
  path is unchanged. i18n ×4 for the two toggle labels; typecheck/lint/ai-lint/build clean. Live browser QA
  (open the menu, pick a template, confirm the project + repo appear) folds into the shared browser-verify
  pass. This closes Fase G (G1 backend + G2 UI) of the idea→outcome program.
