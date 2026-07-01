---
name: workspaces-v1-schema-shape
title: Embed per-stage config as composite types, keep loose ObjectId refs, and omit the framework-provided identity models in the Workspaces V1 Prisma schema
status: accepted
date: 2026-07-01
deciders: [ItsLucky23]
tags: [workspaces, data-model, prisma, mongodb, lane-b]
supersedes: []
relates: []
---

## Context

Fase 0.2 authored the full Workspaces V1 Prisma schema (`prisma/schema.prisma`)
from the design corpus (`src/workspaces/_docs/04_DATA_MODEL.md`, `04b` §6–§17, the
`V1_SCOPE.md` IN/OUT table, `REFERENCE_CODES.md`). The docs pin the exact bodies of
the append-only/runtime/spend/notification models (`04b §6–§11`) and the §13 field
sweep, but leave several shape choices to the builder:

1. The rich per-stage config (`PipelineStageCfg` in the prototype: commands, tools,
   statuses, processes, model-escalation rules, network) — `04 §1` names normalized
   child collections (`StageSkill`/`StageCommand`/`StageToolPermission`/…), but `04b`
   gives no build-grade bodies for them, and the provider is MongoDB.
2. Whether to add a wrapper `Pipeline` model (name-clashes with the DEFERRED CI
   `Pipeline` in `04b §18`).
3. Whether to use Prisma `@relation`s + referential-action cascades, given `04b §11d`
   makes workspace-teardown a Conductor action and `runInTenant` does `$extends`
   where-injection isolation.
4. `04 §1`/`04b §11b` list `User`/`OAuthAccount`/`SshKey` as framework-global
   identity, but the LuckyStack framework already owns `User` (with `provider` +
   `defaultPrismaUserAdapter`) and its own auth.
5. Growth-tolerant fields (`status`/`type`/`kind`) — Prisma enum vs `String`.

These are durable, cross-lane choices (Lane B publishes this schema first; A/C/D
build against it), so they are recorded here — especially because the
`workspaces-handoff/` corpus that motivated them will be deleted after the build.

## Decision

1. **Embed per-stage config as Prisma composite `type` blocks** (`StageCommandCfg`,
   `StageToolCfg`, `StageStatusCfg`, `StageProcessCfg`, `StageModelCfg`, …) directly
   on `PipelineStage`, mirroring the prototype's flattened `PipelineStageCfg` — not
   normalized child collections.
2. **No wrapper `Pipeline` model.** `PipelineStage` belongs to a `Project` via
   `projectId`. The one V1 ticket-pipeline per project is just its ordered stage list.
3. **Loose `@db.ObjectId` reference fields, no formal Prisma `@relation`s.**
   Delete-cascade (`04b §11d`) and tenant isolation are Conductor / app-enforced,
   matching the single-writer model + the `$extends` where-injection isolation.
4. **Leave `User` untouched and add no `OAuthAccount`.** Framework auth +
   `User.provider` cover V1 identity; Workspaces adds only `SshKey` (B-05 terminal
   gate) and `PushSubscription` (web-push) as framework-global rows.
5. **`String` + a value-listing comment for growth-tolerant product fields**, not
   Prisma enums (only the framework's own `LANGUAGE`/`THEME`/`PROVIDERS` enums stay).

## Rejected alternatives

- **Normalized stage-child collections** (`StageCommand`/`StageTool`/… as their own
  models) — rejected: MongoDB embeds naturally, the prototype already models this
  flat, `04b` gives no bodies for the children, and 6+ extra collections per stage is
  needless join/write complexity for config that is always read/written as one unit
  (Rule 7b). Composite types give the same typed shape without the collections.
- **A wrapper `Pipeline` model** — rejected: adds a model with no V1 behavior (one
  pipeline per project) AND collides by name with the DEFERRED CI `Pipeline`
  (`04b §18`), inviting future confusion.
- **Formal `@relation`s + `onDelete: Cascade`** — rejected: authoritative writes go
  only through the Conductor (B-23), teardown tears down live containers BEFORE the
  row cascade (`04b §11d`), and tenant reads are where-injected — Prisma-level
  referential actions would fight both. Loose refs keep the single-writer contract
  the source of truth.
- **Prisma enums for `status`/`type`/`kind`** — rejected: the prototype (`types.ts`)
  and the whole UI use hyphenated literals (`'needs-input'`), which are not valid
  Prisma enum identifiers; the docs explicitly write these as `String` with
  "(+ growth)". `String` preserves prototype↔schema fidelity and avoids enum-migration
  churn every time a status is added.
- **Adding `OAuthAccount`** — rejected for V1: the framework owns identity/auth; a
  second account-linking table is unused surface (Rule 7b). Revisit if per-user
  multi-provider account-linking is needed.

## Consequences

- Lane B ships this schema + types as the frozen contract; A/C/D build against it.
- **App-enforced obligations** (not enforced by Prisma, so they need code + tests):
  workspace-teardown cascade over all `workspaceId` rows (`04b §11d`),
  append-only immutability for `TicketEvent`/`RagEntry`/`WorkspaceSignal`/
  `SpendRecord`/`CarryOver`/`Handoff` (no update/delete path), and `runInTenant` on
  every non-`/api` path.
- `WorkspaceBudget.periodWindow` uses a Prisma Json `@default("\"calendar-month\"")`
  (validated on Prisma 6.19); a rolling window is stored as `{ rolling: '5h' }`.
- **Deliberate omissions to revisit when their lane opens:** `Workspace.previewConcurrencyCap`
  (preview-deploy is OUT, `V1_SCOPE §4`); every `04b §18` deferred model
  (MergeRequest/CI-Pipeline/ForgeConnection/AuditEntry/PreviewDeployment/…);
  `forgeMode`/`autonomyLevel` fields.
- **`TicketReference`** is an inferred minimal shape — `04 §1` names it and the
  `04b §11d` cascade list includes it, but no build-grade body exists. Flagged in the
  schema header; tighten its shape when a feature actually writes it.
- The ro/rw DB credential pair (`04b §13`, B-O8) rides the generic encrypted
  `EnvVar` + `IntegrationField.envVarId` mechanism rather than a typed column pair.
