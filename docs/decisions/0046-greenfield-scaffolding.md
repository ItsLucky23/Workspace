---
id: 0046
title: Greenfield scaffolding — curated stack templates + project-from-template
status: accepted
date: 2026-07-06
tags: [scaffolding, templates, onboarding, expansion-f1]
supersedes: []
depends_on: [0035]
---

# Greenfield scaffolding + welcome

## Context

F1 adds "create a NEW project from a stack template" — the GENERATE side of the GENERATE-vs-LINK split
(features/01). `additions/04` covers onboarding an EXISTING repo; F1 covers a fresh one, plus a welcome
flow. It builds on A1's multi-project model (a template creates a project) + the project-create/default-
pipeline path.

## Decision

1. **A small CURATED template catalog** (`server/scaffold/templates.ts`) — a few reviewed stacks
   (node-api, react-vite, python-fastapi), each carrying the seed config a fresh project needs: a base
   image hint, a dev command, and starter convention docs. Pure data + `listTemplates()`/`getTemplate()`.
   A cross-workspace template marketplace is later (features/01 B-O4).

2. **`project-from-template` control-op** — creates a fresh `Project` (reusing the A1 project model) with
   the template's `devCommand`/`baseImageRef`, seeds the template's starter convention docs as
   `InfoSource(source:'starter')` (visible in Sources, injectable into the coding agent — the starter-doc
   pattern), and seeds the project's own default pipeline (`createDefaultPipeline`). The catalog is exposed
   in the snapshot (`templates[]`) for the picker.

3. **Welcome flow — the data + method are wired; the wizard UI is a follow-up.** `templates` +
   `createFromTemplate` are on the context; a first-run wizard on top of the existing setup steps is the
   remaining UX layer (a picker rendering `templates[]` → `createFromTemplate`).

## Rejected alternatives

- **Generate the full repo tree now.** Deferred — F1 seeds the CONFIG + conventions (dev command, starter
  docs, pipeline) a fresh project needs; materializing an actual git repo/file tree ties to the git-server
  build target (FORGE_ABSTRACTION §7) and is a heavier follow-up. The scaffolded project is immediately
  usable by the pipeline.
- **A free-form template (user-supplied).** Rejected for V1 — a small curated, reviewed set first
  (features/01 B-O4); user templates + a marketplace come later.

## Consequences

- New `server/scaffold/templates.ts`; `project-from-template` op; snapshot `templates[]`; context
  `templates` + `createFromTemplate`.
- Reuses the A1 project-create + default-pipeline + starter-InfoSource patterns — no new project machinery.
- Follow-ups: the first-run welcome wizard UI (picker + guided steps); actual repo/file-tree generation
  (ties to the built-in git-server); user-supplied templates.
