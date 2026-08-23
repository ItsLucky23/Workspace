---
id: 0323
title: Prompt composition order is one spec the server maps over, not a mirror the UI maintains
status: accepted
date: 2026-08-24
tags: [ai, prompt, ux, correctness, orchestrator, testing]
supersedes: []
---

## Context

ADR 0311 corrected ADR 0308's "one stack of five" into two channels, and guarded the correction with
a source-text test that read `server/orchestrator/renderStage.ts` and matched expressions. The
correction was itself wrong in two places, and the test pinned both errors (the open "server side
not verified" item from the 2026-08-21 UI-audit round):

1. The preview put the stage's **handover instruction** at system position 3. The server renders the
   **incoming** handover there (`renderIncomingHandover`), and the handover instruction at position 6,
   after the carry-over fence it shapes.
2. The **definition of done** — user-editable on the same General tab — is system entry 4 on the
   server and was absent from the preview, so the "n of 5" badge undercounted.
3. The workspace AI page showed the two-channel stage model although the runs that page steers most
   directly (chat, documents, content, studio) take the **one-shot** path: a single system string with
   no project channel, where skills sit between the product-capability index and the feature's prompt.
4. Text fidelity: the server prepends `Write all output in <lang>.` to the workspace layer and wraps
   the skills block in a `## Active skills` / `### Skill:` shape; the preview showed bare fields.

Root cause: `src/workspaces/_functions/aiLayers.ts` was a hand-maintained **mirror** of the server.
A mirror drifts the first time someone edits one side; a source-text test only checks that the
mirror still matches the expressions it was written against, not that the model is true.

## Decision

`aiLayers.ts` is the **spec**, and the server **maps over it**:

- `AI_STAGE_SYSTEM_SPEC` (10 entries) → `renderStage`'s `stageInstructions` array.
- `AI_STAGE_PROJECT_SPEC` (6 entries) → `renderStage`'s `claudeMd` (each segment carries its own
  separators; the channel is the plain concatenation in spec order).
- `AI_ONESHOT_SPEC` (4 entries) → `server/ai/promptBudget.ts`'s single system string.

Each entry is either fed by an editable `layer` or is server machinery; the preview renders both, so a
field's number is its real position among everything the agent receives ("6 of 10"), and machinery is
listed muted with no edit affordance. The order can no longer drift, because there is only one.

The formatting that used to be server-only is a set of pure helpers in the same file
(`formatWorkspaceInstruction`, `formatSkillBlock`, `formatDoneGuidance`, `formatHandoverPrompt`),
called by `ai/registry.ts`, `ai/skills.ts`, `renderStage.ts` **and** the client resolver — the
preview's composed text is byte-for-byte what the server emits for the segments it can know.

The guard is **behavioural**: `tests/unit/aiLayers.test.mts` renders a stage with a sentinel in every
editable field, renders a one-shot string the same way, and asserts every sentinel appears in strictly
increasing spec order and that `resolveAiLayers` reports the same positions and counts.

Server → `src/` runtime imports are the established direction (`ai/skills.ts`, `ai/opCatalog.ts`,
`ai/workspaceChat.ts` already import from `src/workspaces/_data`); `shared/` was not used because
it is the function-injection surface, not a general shared-code folder.

## Rejected alternatives

- **Fix the mirror and keep the source-text test.** Repairs today's two errors and re-arms the same
  failure mode; the test would have to be rewritten on every refactor of the renderer's expressions.
- **Put the spec in `shared/`.** That folder is auto-injected into API/sync handlers; a UI-facing spec
  there would be injected into every handler for no reason.
- **Split the skills block into its own project-channel segment.** The skills block is the last
  context document inside one `## Project & workflow guidance` section with irregular separators;
  splitting it while keeping the output byte-identical is contortion. The `skills` layer feeds the
  `docs` segment instead, labelled "(skills last)".
- **Show machinery text on the client.** Would mean moving the policy/fence constants out of the
  server modules that own them; the name alone answers "what sits between my fields".

## Consequences

- Adding a prompt segment = one spec entry + one producer in the server's `Record<…EntryId, string>`
  (the record type errors until every id has a producer) + one label key ×4 locales.
- The preview is truthful by construction, including on the workspace AI page (`mode: 'oneShot'`).
- `tests/unit/modelWiring.test.mts` previously threw inside its `try` on a stage cfg missing
  `handoverPrompt` and reported "12 passed" from `finally`; its renderStage assertions now run (20).
