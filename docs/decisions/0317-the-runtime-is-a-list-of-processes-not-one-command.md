---
id: 0317
title: The runtime is a list of processes, not one command
status: accepted
date: 2026-08-19
tags: [runtime, preview, containers, terminals, ux]
supersedes: []
---

## Context

The owner's report: *"for me, running the frontend needs 2 commands — one for the frontend and one for
the backend — and who knows, maybe more, to open an ssh tunnel for instance."*

That is exactly what the code did. `Project.devCommand` is one nullable string, with an optional
`Service.devCommand` override for a monorepo unit and a per-stack default behind both
(`resolveDevCommand`). `previewSession.ts` and `refPreview.ts` each ran a single
`docker exec -d … sh -lc <devCmd>`; `deploy/environment.ts` resolves the same single string. The only
way to express two servers was one shell line (`a & b & wait`), which starts, gives you one merged
output stream where you cannot tell which half died, and no way to restart just that half.

The interesting part is that **the model the owner described already existed, one layer over**:

- `PipelineStage.processes` is a list of `{ id, name, cwd, env[], commands[] }`.
- `startStageProcesses()` starts each of them detached in the ticket's container, teeing each to
  `/work/.claude/process-<name>.log`.
- `TerminalPanel` renders one terminal tab per process of the ticket's current stage.
- The stage runner, the preview and the editor all reach the same container — every one of them goes
  through `launchTicketContainer`, which is idempotent by name.

So "several commands, each with its own terminal, per ticket" was built and working. It was attached
to the **pipeline stage** rather than to the project, which makes it the wrong thing twice: the set
changes as a ticket moves between stages, and `createDefaultPipeline` seeds `processes: []` for every
stage, so in any non-demo workspace it is empty everywhere. The result was two half-answers to "which
commands start my app", in two places, and neither was the one a user would look for.

## Decision

The project owns a **list** of runtime processes. Each entry starts in the ticket's container and gets
its own terminal tab there. Exactly one entry is the preview.

1. **`Project.runProcesses` + `Project.previewProcessId`.** `runProcesses` reuses the existing
   `StageProcessCfg` composite type, so "a process" means one thing in this product rather than two
   near-identical things. `previewProcessId` names the entry whose port is probed
   (`waitForContainerReady`) and published (`previewRoute`); the others simply run.

2. **One shared start implementation.** `server/container/runtimeProcesses.ts` owns `startProcesses`,
   and `startStageProcesses` now delegates to it. The `HOST`/`PORT` hints go **only** to the preview
   process — telling a worker or an ssh tunnel to listen on the frontend's port is how two processes
   end up fighting over one socket.

3. **Nothing changes for an existing project.** An empty list falls back to `devCommand`, then to the
   stack default — the exact resolution the preview did before. The editor seeds itself from the legacy
   command, so the first save is what upgrades a project, and it keeps `devCommand` in sync with the
   preview process's command because deploy still reads that field for a dev-kind environment.

4. **The pipeline stage keeps its list as the per-stage EXTRA** (a test stage that also wants a fixture
   server). The ticket's terminal tabs are the project's processes first, then the stage's, deduped by
   name — the name is what the tab is called and what the process log is keyed by, so two tabs sharing
   a name would read the same log twice.

5. **One command per row in the editor.** The stored shape can hold a chain; the UI deliberately does
   not offer one. A row that runs three commands is a row whose terminal tab cannot be named after what
   it does, and naming them is the entire point.

## Rejected alternatives

**A second exposed process per preview subdomain.** Offered to the owner and not taken. The route
model supports it (`refPreviewRoute` already puts a second subdomain on the same ticket), so this stays
open — but it is only needed to call a backend API from OUTSIDE the container, and a frontend talking
to its backend inside the container needs nothing. Building the per-process route, probe and cleanup
before anyone needs them would be guessing.

**Surface the existing stage `processes` on the Repository tab instead.** The smallest change, and
wrong: it leaves the app's runtime attached to a stage, so it changes as a ticket moves and has to be
configured once per stage. It also keeps two competing notions of "a process".

**Move the runtime onto `Service` rows.** A `Service` is a build/deploy unit, and a preview picks
exactly one of them — it is the "which part of the monorepo" axis, not the "how many things must run"
axis. A per-service list was drafted and dropped: there is no screen to fill it, and schema no screen
can fill is how a product ends up with settings that silently do nothing. The pre-0317 per-service
single-command override is preserved exactly.

**Keep one field and document `a & b`.** That is the status quo the report is about.

## Consequences

- `prisma generate` is required, and the running backend must be restarted to pick it up. MongoDB is
  schemaless, so there is no migration and no backfill — existing documents simply have no
  `runProcesses` and resolve through the legacy path.
- The Repository → Runtime section's "Dev command" input becomes a process list; the "How this runs"
  explanation was rewritten, because it previously stated the opposite of the new behaviour in as many
  words ("not a separate terminal per command").
- `workspaces.repoScan.devCommandLabel/devCommandHelp` and
  `workspaces.workspaceSettings.devCommandPlaceholder` are orphaned and removed.
- A per-process **restart** control is the obvious next ask and does not exist yet: the tabs show what
  a process did, and stopping one still means tearing down the container.
- **Test coverage is deliberately asymmetric.** The resolution — which list runs, which process owns the
  preview URL, what an unknown preview id does — is pinned by `tests/unit/runtimeProcesses.test.mts`
  (15 assertions), because every one of those failures is silent in production. The list EDITOR has no
  Playwright coverage: the Repository tab renders only the link form until a repo is actually linked
  (a deliberate choice — three empty sections is worse than one form), and linking one needs a real
  server-side clone that the e2e harness cannot produce. An `excluded:infra` gap, not an oversight.
