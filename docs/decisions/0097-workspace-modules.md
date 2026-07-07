---
title: Workspaces pick MODULES at creation (Dev / Content / Design) — nav gates on a per-section set, not a repo/Dockerfile-first setup
status: accepted
date: 2026-07-07
tags: [workspaces, onboarding, modules, nav, content, rbac]
---

## Context

A new workspace was always **name-only**, then dropped the user straight into a dev-centric shell:
a full nav rail (Board, Backlog, Terminals, Pipeline, …), a seeded "Connect your GitLab project"
ticket, and a Settings → Repository tab prompting for a repo link + a generated Dockerfile. But
Workspaces is now an all-in-one AI content platform — many users want it **only** as a
marketing/AI image+video tool, or **only** to design some UIs, and should never be asked to link a
codebase or build a Dockerfile. The user also wanted the split to be a *starting preset*, not a
rigid bundle: a Development workspace must be able to add just the Interviewer later.

## Decision

- A workspace stores `enabledSections: String[]` (`Workspace` model) — the resolved set of gateable
  nav-section ids. **Empty ⇒ legacy / all-on** (every pre-module workspace keeps every section).
- Three shippable **modules** are pure presets (`src/workspaces/_data/modules.ts`): **Development**
  (board/backlog/terminals/activity/sources/pipeline/scheduled — the only lane needing a repo +
  Dockerfile), **Content & Marketing** (content/marketing), **Design** (designer/interviewer). At
  creation the user picks modules; the client resolves them to section ids and sends those.
- Storage is **per-section**, not per-module, so individual sections toggle independently after
  creation (a Dev workspace can add the lone Interviewer). The settings "Modules" tab is a
  per-section toggle grid grouped by module.
- **Gating is enforced at the seams, not by a central switch** (routing is file-based, no router):
  the nav rail + mobile bar filter `NAV_ITEMS` by `isSectionEnabled`; a shell guard redirects a
  hidden active view to the first enabled one; and the Repository/GitLab/Workflow settings tabs +
  the "Connect your GitLab project" starter ticket are gated on `isModuleEnabled('development')`.
- The post-creation edit is a new `[save-sections]` control-op (single-writer, modeled on
  `save-git-config`) — RBAC `workspaceSettings`, broadcast back as a realtime delta.

## Rejected alternatives

- **A coarse `workspaceType` enum (dev | content | design).** Cannot express "Development + just the
  Interviewer" — the user explicitly asked for that mix. Per-section storage is strictly more
  flexible and presets still give the simple first-run choice.
- **Reuse `Project.projectType` (dev | content).** That is a per-project workflow-lane flag (ADR
  0049), one level down and binary; it does not gate the workspace nav and cannot represent Design.
- **A central `<Router>`/view whitelist.** There is no runtime view switch (each view is a
  filesystem route rendered as `children`); gating at the nav + a shell redirect guard is the
  minimal change that fits the existing shape.
- **Extend `save-git-config` to also carry sections.** Conflates git policy with nav gating; a
  dedicated op keeps each concern independently RBAC-able and broadcastable.

## Consequences

- A marketing/design-only workspace never sees the board, the GitLab starter ticket, or the
  repo/Dockerfile setup — the exact friction the user hit. Existing workspaces are unaffected
  (empty `enabledSections` = all-on).
- Adding a future module = one entry in `WORKSPACE_MODULES` (+ its i18n) — the nav filter, settings
  grid, creation picker, and gating all derive from that one source of truth.
