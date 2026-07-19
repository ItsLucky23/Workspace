---
id: 0281
title: CI, previews and build exports are scoped to a monorepo UNIT, and every gate means "every unit"
status: accepted
date: 2026-07-19
tags: [ci, monorepo, gates, schema, mongodb]
supersedes: []
---

# 0281 — per-service CI, and what "the project is green" means

## Context

`Service` has existed since the monorepo work, with `path`, `buildCmd`, `deployUnit`, `devCommand` and
`baseImageRef`, and the schema comment promised each service was "independently buildable / deployable /
previewable". It was not. A scan found **39 sites** assuming one pipeline per project:

- `Pipeline` was `@@unique([workspaceId, projectId])` — structurally one per project.
- The runner read one `/work/.workspaces/ci.yml` and ran every job with `-w /work`.
- Previews resolved only `Project`, so a ticket on a monorepo service booted the root project's dev server
  and presented it as that service.
- `buildCmd` and `deployUnit` were written by the editor and read by nothing.
- Export/import dropped `Service` rows entirely, while reporting success.

The gates were the dangerous part. `ciGreenForProject` took the *newest* run for the project. On a
single-unit repo that is correct. The moment a second service exists, a green run for service A passes the
prod gate while service B is red — purely because A finished last. **Adding a service silently weakened the
prod promote gate**, with nothing to see: no error, no warning, a green check.

## Decision

**1. `serviceId` is a first-class column on `Pipeline`, `PipelineRun`, `BuildArtifact` and `Ticket`, where
`null` means "the project root unit".** A single-unit repo has no `Service` row and never needs one; its
work is the root unit. `Pipeline`'s unique key widens to `[workspaceId, projectId, serviceId]`.

**2. Every gate means "every unit".** `ciGreenForProject`, `securityBlocksProdPromote` and `ciGateForMr`
take the newest run *per unit* and require all of them. A unit that never ran CI does not block (CI stays
opt-in); a unit that ran and failed always does. The MR panel shows the per-unit breakdown and the headline
status is the **worst** unit, never the newest.

**3. Each unit carries its own `ci.yml` under its own root**, rather than one root file with a `services:`
key. It fits the existing `Pipeline.specHash` model (one spec, one hash, one row per unit) and gives real
isolation; the single-file alternative puts every unit's spec behind one parse and one hash.

**4. One user action runs every unit.** Asking which service to test would mean N clicks to turn one MR
green, and forgetting one is indistinguishable from passing. Each unit gets its own durable intent, its own
container at the same commit and its own `PipelineRun`, so a red unit is attributable and retryable alone.
Units run sequentially: N parallel Docker builds is how a dev box falls over.

**5. Uniqueness has exactly one source: the unit-scoped `clientRequestId`.** The dispatcher sends
`<requestId>:<unit>` and the Conductor derives the intent and signal ids from the request id it receives.
Salting the unit into the id helpers *as well* made caller and Conductor disagree — which presented as a
prepared intent that never validated, i.e. a hang rather than an error.

## Rejected alternatives

- **Leave the gates project-wide and only scope execution.** Cheapest, and it keeps the exact bug that
  makes this worth doing: a green sibling masking a red unit.
- **One root `ci.yml` with a `services:` key.** One parse instead of N, but one `specHash` for all units, so
  changing one service invalidates every pipeline row and per-unit reuse is gone.
- **Ask the user which service to run.** Rejected under (4). It also makes "is this MR green?" a question
  about whoever clicked, not about the change.
- **Pass a service to previews as a call argument instead of a `Ticket.serviceId` column.** Pure wiring, no
  migration — but nothing is remembered, so reopening a preview forgets which unit it was showing. The
  column follows the precedent `Environment` and `DbConnection` already set.

## Consequences

- Existing rows have `serviceId` **absent**, which on MongoDB is not `null` and does not match a
  `serviceId: null` filter — and the unique index treats absent and null as the same value. Backfill steps
  4 and 5 write it explicitly; every write path does the same on create (lesson 0014).
- A per-service run is one container per unit at the same commit. Wasteful for a three-service repo
  compared to reusing one container, and deliberately accepted: reusing one container would mean one
  intent, one completion payload and one report for N units, which is the collapsing this ADR removes.
- Three test fixtures encoded the old behaviour and were updated rather than worked around: a `Pipeline`
  written without `serviceId`, a run id derived without the unit salt, and a mocked Conductor deriving
  intent ids from the un-scoped request id.
- Still open: `Project` rows are not exported either, so a *multi*-project bundle would need real id
  remapping before per-project service restore is meaningful. The shipped export route remains the lossy
  one; `fullExport` still has no route or UI.
