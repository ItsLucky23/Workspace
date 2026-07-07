---
title: The stage persona (system prompt) + definition-of-done are editable in the pipeline UI
status: accepted
date: 2026-07-07
tags: [pipeline, stages, ui, freedom-program]
---

## Context

FREEDOM_PROGRAM item **Q6**. A stage's `systemPrompt` (its agent persona → `--append-system-prompt`) and
`definitionOfDone` existed in the model + snapshot, but the pipeline editor only exposed `customInstructions`
+ `promptTemplate` — so a user could tweak the task but not the agent's role/persona or its completion
criterion (both stayed hardcoded from the default pipeline seed). The `save-stage-config` op even silently
ignored `definitionOfDone`.

## Decision

- Add two fields to the pipeline stage editor's General tab: **AI persona (system prompt)** and **Definition
  of done**, editing `s.systemPrompt` / `s.definitionOfDone` (the `_sync` route already sends the whole cfg).
- Fix the `save-stage-config` op to also persist `definitionOfDone` (it handled `systemPrompt` already).

## Rejected alternatives

- **Leave the persona hardcoded.** The persona IS the stage's identity; a premium product lets the user own it,
  consistent with letting them own the task instructions.
- **A separate advanced/expert mode.** Over-engineered; the two fields sit naturally in the General tab with
  clear hints (persona is layered above instructions; empty DoD = the AI judges completion).

## Consequences

- Users fully shape each stage's agent — persona + task + completion criterion — from the UI, no code. With
  Q4 (workspace-wide instruction) this gives a clean layering: workspace instruction → stage persona → stage
  instructions → carry-over template.
