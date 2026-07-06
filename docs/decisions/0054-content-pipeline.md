---
id: 0054
title: Generic content-pipeline — fixed stage sequence + control-ops (F1.1)
status: accepted
date: 2026-07-06
tags: [content, pipeline, control-ops, expansion-f11]
supersedes: []
depends_on: [0049, 0050]
---

# Generic content-pipeline (F1.1)

## Context

A content piece (`ContentProject`) must flow through a workflow the way a Ticket flows through the dev board. F1.1 builds that engine: the stage sequence + the control-ops that drive a piece through it (the per-stage generation wires in F1.2–F1.5).

## Decision

1. **A FIXED ordered content-stage sequence** (`server/content/pipeline.ts`): `idea → script → generate → assemble → review → publish`, with `nextContentStage`/`isContentStage` helpers. Unlike the dev board (per-project `PipelineStage` rows), the content stages are a code constant — the sequence is uniform across content pieces (per-stage CONFIG comes later, F4).
2. **Three control-ops** (B-23; capability `workTickets`): `content-create` (make a `ContentProject` at `idea`), `content-advance` (→ an explicit `toStage`, else the next stage; past `publish` → `status:done`), `content-archive` (soft). The **Conductor is the only writer** of `stageId`/`status`.
3. **`project-create` gains `projectType`** — `projectType:'content'` makes a content-lane project (NO board pipeline seeded); default stays `dev` (a board + its `PipelineStage`s). Zero change for existing dev flows.

## Rejected alternatives

- **Reuse `PipelineStage` rows for content.** Rejected — content stages are a fixed uniform sequence, not a per-project editable board; a code constant is simpler and avoids seeding board columns on a content project. (Per-stage content config, when needed, layers on top in F4.)
- **A single `content-set-stage` op.** Rejected — `content-advance` with an optional `toStage` covers both "next" (the common drive) and "jump" in one op, and encodes the past-publish→done transition centrally.
- **Content pieces reuse `quick-add`/Ticket ops.** Rejected — a content piece has a different lifecycle + fields; distinct ops keep the two lanes' contracts clean (they still share the Conductor + RBAC + realtime).

## Consequences

- New `server/content/pipeline.ts` + the `content-create`/`content-advance`/`content-archive` ops (union + `OP_CAPABILITY` + Conductor cases) + `projectType` on `project-create`. F1.2–F1.5 hook the per-stage generation onto these stages.
- `tests/integration/contentPipeline.test.mts` (10 assertions): a content project has no board stages; a piece is created + advanced (next + explicit + past-publish→done) + archived, all via control-ops. `rbac.test` 122/122 with the 3 new ops.
