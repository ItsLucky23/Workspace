---
id: 0327
title: Stored-but-inert settings are wired or deleted — never left dormant
status: accepted
date: 2026-08-25
tags: [cleanup, honesty, schema, budget, self-handoff, spend]
supersedes: []
---

## Context

The 0326 audit left a follow-up list of stored-but-inert surface: settings and columns that were
persisted (some even editable) but that no runtime path ever read. The owner ruled per item on
2026-08-25: *"ik wil maxturns helemaal weg halen … de pauseall mag ook weg net zoals die killswitch
van eerder. prompt experiments paneel hoeft niet, fix die db introspect, fix die dode kolommen daar
kan handige info in zitten"*. The principle: a stored value either has a consumer or it does not
exist — dormant columns mislead every future reader into assuming behavior.

## Decision

Split the list into DELETE (no plausible consumer) and WIRE (the stored info is useful — give it
its missing consumer):

**Deleted** — `maxTurns` (stored + resolved by modelSelect but never reached the agent argv; the
owner never saw an AI get stuck), the budget `enforcement` field (`pauseNew`/`pauseAll` sat in the
same server-side filter, so the choice changed nothing — every ENABLED cap now enforces
pause-new-runs at 100%), the prompt-experiments feature (models, ops, panel, API — zero production
call sites for variant selection), `PipelineStage.roleKey` (literally derived from `kind` at every
write site — `kind` IS the role binding), `Workspace.reasonerTokenBudget` (no consumer concept),
`Workspace.gemini{Model,Temperature,BaseUrl}` (superseded by the generic provider store, ADR 0007),
`Project.dockerfilePath` (the reviewed on-disk draft owns the Dockerfile flow; the column stored a
constant), and the fake seeded `kind:'custom'` stage statuses (custom statuses stay deferred, B-O5).

**Wired** — `PipelineStage.avgTokensPerTurn` (stage-writer recomputes the rolling mean over the
last 20 turns from the SpendRecord ledger; shown under the stage's context-budget field),
`Workspace.assistantTokenBudget` (per-workspace turn budget: stage `contextBudgetTokens` →
workspace → env default) + `Workspace.handoffInstruction` (replaces the handoff prose; the
parseable `ws-handoff` block spec is ALWAYS appended so a custom instruction cannot silently kill
handoffs) — both editable in the AI-behaviour form via `save-ai-instruction`;
`WorkspaceBudget.periodWindow` (lazy calendar-month roll on every spend write/cap check — no cron;
UTC month boundaries); `Workspace.pricing` (per-workspace €/1k map merged OVER defaults + env in
every cost estimate; write path is still DB-only — flagged as an open point). The dropped
db-introspect result now flows conductor → sync-reply → settings card (table list rendered inline).

## Rejected alternatives

- **Wire everything** — pauseAll's kill-running-half kills work mid-turn (rejected 2026-07-13 and
  again now); prompt-experiments would need real variant-selection call sites nobody asked for;
  roleKey/dockerfilePath duplicate `kind`/the draft flow.
- **Keep columns "for later"** — that is exactly the dormant state this decision forbids; Mongo
  needs no migration to re-add a column the day a consumer exists.
- **A cron for the budget window roll** — the lazy roll on the existing write/check paths needs no
  scheduler, cannot drift from the leader lease, and unfreezes a capped workspace on the first
  check of the new month.

## Consequences

- Legacy Mongo documents still carrying `maxTurns`/`enforcement`/`roleKey`/gemini\* parse fine —
  fields absent from the schema are simply not read; no data migration.
- The frozen op surface is unchanged in verb count; `edit-budget` and `save-ai-instruction` lost
  and gained params respectively (client twin + effect matrix updated).
- Budget caps now reset per calendar month (UTC); `resume-spend` remains the manual mid-month reset.
- Open points: a UI write path for `Workspace.pricing`; workspace-timezone month boundaries (D55)
  instead of UTC; `Channel.defaultStyleId` (#153) still written-but-never-read — separate owner
  decision pending.
