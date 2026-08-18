---
id: 0028
title: An explanation surface not pinned to its code goes confidently wrong
severity: high
area: ai, ux, documentation, testing
date: 2026-08-18
---

# 0028 — pin every "here is how it works" surface to the code it describes

## What happened

ADR 0308 added a UI that explained how five prompt fields compose into one agent prompt: an ordered
list, a `layer N of 5` note beside each field, and a preview of the composed result. It read as one
of the most trustworthy parts of the settings UI.

It was wrong in every particular. The fields do not form one stack — they travel in two independent
channels (`--append-system-prompt` and the container's `CLAUDE.md`), so "layer 4 of 5" was
meaningless and implied a constraint between two fields that are not even in the same file. Worse,
layer 1 (`Workspace.aiInstruction`) never reached the PTY coding agent at all: it is applied only at
the one-shot completion choke-point in `server/ai/registry.ts`.

It survived a full lint/build/typecheck/test cycle and a 43-agent build run, because nothing it
claimed was expressible as a type. It was caught only because the NEXT feature — a hover explaining
all five layers — would have amplified the same claim, so the composition was read against
`server/orchestrator/renderStage.ts` first.

## Root cause

The explanation was written from the UI outward. The model file (`aiLayers.ts`) was authored as the
"one definition" of the composition, but it was a *parallel* definition: the renderer never imported
it, and nothing compared them. Two descriptions of one behaviour with no link between them will
diverge, and the docs-shaped one diverges silently — a wrong number renders just as crisply as a
right one.

The second-order cause: a confident explanation is worse than none. Without it a user experiments;
with it they act on it, and they write a workspace-wide instruction believing the coding agent reads
it.

## How to avoid

- When adding a surface that EXPLAINS backend behaviour (ordering, precedence, "what the AI
  receives", "what happens when you click this"), read the implementing code first and cite the file
  in the model's header comment. Treat "I'll describe the intended design" as a red flag.
- Pin it with a structural test that reads the implementing source, the way
  `tests/unit/aiLayers.test.mts` asserts the channel model against `renderStage.ts`. Source-text
  matching is acceptable here: the failure being guarded is "someone reorders the array and the
  explanation keeps its old story", and a test that fails on an honest rename is doing its job.
- Prefer having the renderer import the model over asserting they agree. Where that is impossible
  (server renders a container prompt, client renders a settings page), the test is the link.
- When the check reveals the code is wrong rather than the docs — as here, where an "always-on"
  field applied to five AI features but not the sixth — fix the code. Documenting a gap that
  contradicts the field's own label just moves the lie.
