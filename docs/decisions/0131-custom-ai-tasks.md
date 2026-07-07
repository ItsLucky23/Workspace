---
title: User-defined custom AI tasks — break the "can't invent a task" ceiling within the invariants (E5)
status: accepted
date: 2026-07-07
tags: [ai, extensibility, custom-tasks, freedom-program]
---

## Context

FREEDOM_PROGRAM item **E5**. The AI features were a closed set — a user could not author their own re-runnable
AI task. The hard constraint: any such escape hatch must NOT introduce a new write verb or a direct writer
(single-writer + the frozen structured-channel surface).

## Decision

- A `CustomAiTask` model (name + `promptTemplate` with `{{variables}}` + a read-only `lastOutput`). A new generic
  `custom-generate` `AiFeature` (Claude default, provider-per-feature-overridable via P1). A pure
  `renderTaskPrompt(template, vars)` substitutes the variables; `runCustomTask` renders + runs it through
  `runAiCompletion` and stores `lastOutput` ONLY.
- Three control-ops on the single-writer chain: `save-custom-task` / `delete-custom-task` / `run-custom-task`
  (workTickets capability). Running is **propose/generate** — it produces output the user reads; it never writes
  authoritative state (verified: a run creates no tickets/assets). Surfaced as a "My AI tasks" panel (create /
  run / delete + output) fed from a new `snapshot.customTasks` field.

## Rejected alternatives

- **Let a task run an arbitrary write op.** That would breach single-writer + frozen-verbs. A custom task is
  strictly generate-only; to ACT on its output the user goes through the existing accept→Conductor flow.
- **A free-form code-executing task.** The coding agent is the PTY `claude` (PTY invariant); a custom task is a
  non-coding text generation through the provider abstraction, not arbitrary code execution.

## Consequences

- A user can author, run, and re-run their own AI task (e.g. "summarize {{topic}}") — the "can't invent a task"
  ceiling is broken WITHOUT a new verb or writer (`customAiTask` 12/12; a run creates zero authoritative state).
  Scheduling it via a `run-custom-task` trigger action + variable-input UI + run history are follow-ups on top of
  this tested backend.
