---
title: Module-based nav categories (Develop / Content / Insights) that mirror folders and URLs
status: accepted
date: 2026-07-19
tags: [frontend, navbar, ux, ia, routing, restructure]
supersedes: [0068]
---

# Context

The main rail grouped views into five verb destinations (Work / Create / Publish / Automate /
Insights — ADR 0068 F4.1, later condensed in the "five destinations instead of fifteen" pass).
The owner reviewed it and rejected parts of that IA:

- **Pipeline sat under "Automate"**, a different destination from the board it drives — the two
  belong together ("the pipeline is literally the board's machine").
- **Designer and Interviewer sat in Create/Insights**, but both are repo-bound tools (the Designer
  edits the product's own UI and applies tokens to the repo; the Interviewer is the repo-aware
  planning chat) — they belong with the development lane.
- **Folders did not mirror the nav**: pages sat flat under `src/workspaces/`, so the codebase told
  a different story than the rail.
- **Onboarding hid the module choice** behind an "advanced" fold; only the four packs were visible.

# Decision

1. **Three module-based categories** — `develop` (board, answers, backlog, pipeline, terminals,
   designer, interviewer, sources, scheduled), `content` (content pieces, documents, marketing,
   scheduled-posts, studio) and `insights` (activity, usage, knowledge) — defined once in
   `src/workspaces/_data/nav.ts` and consumed by the Shell (rail groups) and the provider (URL
   mapping).
2. **Folders and URLs mirror the categories**: pages moved to
   `src/workspaces/<category>/<view>/page.tsx` → `/workspaces/<category>/<view>`. The Content
   overview doubles as its category index (`/workspaces/content`); category-less views (ai,
   settings, workspace) keep flat URLs; `/workspaces` is a thin redirect to
   `/workspaces/develop/board`.
3. **Studio is back in the nav** under Content, section-gated (`studio` added to the content and
   design modules' section lists).
4. **Onboarding shows modules first-class**: packs remain as one-tap shortcuts that pre-check the
   module boxes (and seed starting content); the checkboxes are always visible, in the zero-state
   onboarding and the in-app create form alike.

# Rejected alternatives

- **Root-level category folders** (`src/develop/board`): also moves the `_api`/`_sync` namespace
  (every generated route name + call site) and mixes tenant-scoped pages with scaffold pages
  (login, dashboard). The in-workspaces variant gets the same mirror at a fraction of the blast
  radius.
- **Keep the verb groups and only move Pipeline**: leaves the folder≠nav mismatch and the
  repo-bound tools scattered.
- **Full URL back-compat for old flat deep-links**: pre-launch, single-operator product; only the
  root entry needs to keep working (it redirects). `viewFromPath` still resolves old flat paths
  defensively, but no redirect routes were added for them.

# Consequences

- Old flat deep-links (`/workspaces/pipeline`, …) 404 — except `/workspaces` itself and every
  URL under `/workspaces/content/…`, which kept its shape. The only server-generated deep-link
  (`/workspaces/content/settings` in `server/media/budget.ts`) is unaffected.
- Existing workspaces with a persisted `enabledSections` list do not include `studio`; it can be
  toggled on in Settings → sections (legacy empty-list workspaces see everything, including
  Studio).
- Develop carries nine items — the heaviest category. The planned per-page KISS redesign wave may
  sub-group it; the category model itself does not change for that.
