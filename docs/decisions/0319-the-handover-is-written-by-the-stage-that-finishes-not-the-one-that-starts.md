---
title: The handover is written by the stage that finishes, not the one that starts
status: accepted
date: 2026-08-20
tags: [pipeline, prompts, ux, orchestrator]
supersedes: []
---

## Context

Every pipeline stage carried a `promptTemplate`: the opening line of its own session, written by the
user with `{{summary}}`, `{{changedFiles}}`, `{{openQuestions}}` and `{{commitHash}}` slots that the
renderer filled from the previous stage's carry-over envelope. The Carry-over tab showed the four
chips, a click inserted one, and a textarea held the sentence being built around them.

The owner, after agreeing to keep a separate AI session per stage (see
`src/workspaces/_docs/ONE_AI_VS_AI_PER_STAGE.md`): *"nu kunnen we een message met variabelen maar dit
lijkt mij niet handig en ook to much om telkens op te zetten, misschien per stage gewoon een prompt die
runt op het eind van iedere sessie."*

Two things were true and neither was visible on the screen:

1. **An end-of-session prompt already existed** — every stage is told to end its final message with a
   fenced `ws-carryover` JSON block, preceded by the done-guidance (the stage's Definition of done, or
   "judge for yourself"). It was fixed and unconfigurable.
2. **The chips were the OTHER end.** They configured what this stage *receives*, not what it *emits* —
   which is why setting them up felt like work for no return: you were pre-writing a sentence with
   holes in it for output that did not exist yet.

Underneath both: the wrong party was being asked. The AI that has just finished the work knows what is
worth passing on. The user, configuring a stage months earlier, does not.

## Decision

**The editable half of the carry-over moves from the receiving end to the emitting end.**

- `PipelineStage.promptTemplate` is retired. `PipelineStage.handoverPrompt` replaces it: plain language,
  no slots, rendered at the END of the session where it shapes the `summary` this stage writes into the
  `ws-carryover` block.
- The incoming side is composed automatically (`renderIncomingHandover`): a "Handover from the previous
  stage" section with what it did, which files it touched, what it left open, and the pinned commit.
  There is nothing to configure.
- The envelope shape is UNCHANGED. Auto-escalation still reads `complexityScore`, the board still reads
  `changedFiles`, W2 advisories still ride in `openQuestions`. This is a prompt change, not a contract
  change.
- The prompt-injection boundary did not move: each envelope field still lands in its own
  `renderUntrustedContext` block, capped at 6,000 characters.
- Empty is a legitimate value and the common one — it means "decide for yourself what matters". Seeded
  stages ship a per-kind default so nothing needs setting up on a fresh project.

Migration (schema step 7) folds the old field forward rather than dropping it: a template was a task
instruction glued to slots, so the slots (and the bare labels that introduced them) are stripped and
whatever prose survives is appended to `customInstructions` — which is literally "what this stage should
do" — unless it is already in there. The seeded templates paraphrase their own `customInstructions`, so
for an untouched project this adds nothing; for an edited one, nothing the user typed is lost.

## Rejected alternatives

- **Keep the template, hide the chips behind a disclosure.** Two ways to say the same thing, one of them
  hidden. The chips were not the problem; asking the wrong party at the wrong time was.
- **Keep the mechanism, just ship better defaults.** Cheapest option and it would have removed the setup
  burden — but it leaves the design saying that the receiving stage decides what it gets, which is
  exactly backwards from how a handover works between people.
- **Add a `handover` field to the carry-over envelope, separate from `summary`.** A second free-text
  field next to a field that already means "what happened here". Two summaries invite disagreement, and
  every consumer of the envelope would have to pick one.
- **Drop the JSON envelope and hand over prose only.** Auto-escalation, the changed-files list on the
  ticket and the done-signal detection all read structured fields. The instruction rides alongside the
  block; it does not replace it.

## Consequences

- One field per stage instead of a template plus a chip palette, and it can be left empty.
- A stage can now say something the old model could not express at all — "tell the next stage which
  acceptance criteria are still unproven" — because it speaks at the moment it knows the answer.
- `promptTemplate` stays in `schema.prisma` for one cycle, read ONLY by the migration; the column can be
  dropped once no install can still be pre-step-7.
- The `carryOver` prompt-layer keeps its id (it is still the carry-over layer) but its label became
  "Handover to the next stage" — the id names the mechanism, the label names what you type.
- `renderPromptTemplate` is gone; `renderIncomingHandover(envelope)` took its place, with the untrusted-
  block assertions moved over intact.
- The assistant's `save-stage-config` op takes `handoverPrompt` instead of `promptTemplate`.
