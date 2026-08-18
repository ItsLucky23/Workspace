---
id: 0313
title: Repository introspection is shown to the user, not only to the AI
status: accepted
date: 2026-08-18
tags: [dev, ux, repository, containers]
supersedes: []
---

## Context

After linking a repository, the workspace Repository tab offers a Dockerfile draft and two blank
text inputs — dev command and production command — and nothing else. The owner asked the obvious
questions it cannot answer: what if my repo has a docker-compose setup and several Dockerfiles? why
can I not see which npm commands exist? and is a separate terminal started per command?

Two facts made this worse than it looked:

- The server has read these files all along. `repoManifests` in `server/git/repoStore.ts` pulls
  package.json, lockfiles and a Dockerfile out of the bare clone to feed Dockerfile generation, docs
  generation and image builds. The capability existed; it was simply never pointed at the human. Its
  match list is also root-level and exact, so a monorepo's `services/api/package.json`, a
  `Dockerfile.prod`, and `docker-compose.yml` — which this product provisions service stacks from —
  were invisible to it.
- The form could not show its own value. `Project.devCommand`, `prodCommand` and `allowCustomBase`
  were persisted but never included in the workspace snapshot, so the inputs rendered EMPTY on every
  mount. A user could overwrite their command but never see it.

The third question had a real answer nobody had written down. `server/container/previewSession.ts`
resolves `Service.devCommand` → `Project.devCommand` → the stack default and runs it inside the
ticket's own preview container: one dev command per project, not a terminal per command.

## Decision

**Show the user what is in their repository, and say what happens to it.**

1. `repoIntrospect` in `server/git/repoStore.ts` — the same bare-repo read, broader and bounded:
   package.json scripts at any depth (root-first, capped at 12 files), every Dockerfile, every
   compose file, the package manager from the lockfile, and the monorepo units. Caps on the tree and
   a `truncated` flag, so a large repo cannot turn a settings panel into a slow query and cannot
   silently present a partial list as complete.
2. `workspaces/repoIntrospect/v1` — a direct `_api` read, `workspaceSettings`-gated because it
   discloses repository contents. No repo is `linked: false`, not an error: it is the normal state on
   a fresh workspace and this runs on mount.
3. The Repository tab becomes three URL-addressed sections (ADR 0312): Connection, Running, Image.
   Running shows the detected scripts as rows you click instead of retype, and carries an InfoTip
   with the verified resolution order.
4. `devCommand` / `prodCommand` / `allowCustomBase` join `ProjectSummary`, and the form autosaves per
   row like the rest of the settings surface.

## Rejected alternatives

- **Have the AI propose the commands and services from the scan.** Rejected for now: it adds a
  metered AI turn and a review burden to a question the user can answer in one click once the
  options are visible. Worth revisiting for the monorepo case, where the mapping is genuinely
  non-obvious.
- **Extend `MANIFEST_FILES` and reuse `repoManifests` directly.** Rejected: that set is tuned for
  what an AI needs to write a Dockerfile (whole file CONTENTS, capped at 12, root-level). The user
  needs breadth and structure, not content — a separate, bounded function keeps the AI's prompt
  budget out of a UI concern.
- **Turn detected compose files into service stacks automatically.** Rejected: provisioning is a
  Conductor write with real consequences (containers, networks, ports). The panel reports what it
  found and links to where a stack is created; the user decides.
- **Add a fourth "Services" section to the Repository tab.** Rejected: services are managed on the
  settings page and duplicating them here would recreate exactly the two-editors-for-one-concept
  problem ADR 0310 settled. The Running section links out instead.
- **Leave the empty inputs and document the resolution order in the docs.** Rejected on the same
  grounds as ADR 0311: a form that cannot display its own stored value is not a documentation gap.

## Consequences

- The Repository tab now states, on screen, that one dev command runs per project inside the ticket's
  preview container, with the three-step resolution order. That was previously only derivable by
  reading `previewSession.ts`.
- The introspection is a live read of the bare clone on every mount of the Running section. It is
  bounded and does no checkout, but it is not cached — if it ever shows up in profiling, cache it per
  commit sha rather than reducing what it reports.
- `docker-compose.yml` is now surfaced but still not acted upon. The panel says so explicitly rather
  than leaving the user to wonder, which is the honest intermediate state.
- Adding a manifest kind (a new lockfile, a new stack marker) means editing the predicates in
  `repoIntrospect`, not the AI's `MANIFEST_FILES` — the two lists serve different consumers and are
  deliberately allowed to diverge.
