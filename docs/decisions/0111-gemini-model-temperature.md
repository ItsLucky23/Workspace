---
title: Per-workspace Gemini model + temperature tuning (Claude has no such knob — PTY-billed)
status: accepted
date: 2026-07-07
tags: [ai, providers, gemini, tuning, freedom-program]
---

## Context

FREEDOM_PROGRAM item **P2**. There was no generation-param tuning anywhere: Gemini read only the process-wide
`GEMINI_MODEL` env and sent no temperature; Claude-CLI has no model/temperature concept at all (it drives the
interactive subscription-billed PTY — model is subscription-determined, PTY-billing invariant).

## Decision

- Per-workspace `Workspace.geminiModel` + `Workspace.geminiTemperature` (strings; empty = env/model default).
  The `gemini-api` provider resolves them per workspace in one config read (`resolveGeminiConfig`, folded with
  the Q5 key read) and sends `generationConfig.temperature` (clamped 0–2) + the chosen model.
- Edited in the AI settings tab (model input + temperature input), persisted through the extended
  `save-ai-instruction` op (now carries instruction + language + geminiModel + geminiTemperature).

## Rejected alternatives

- **A generic per-feature param table for all providers.** Only Gemini can accept these params — Claude-CLI
  can't (PTY). A generic table would imply a knob that does nothing for the Claude features. Scoped honestly to
  Gemini; noted that Claude has no equivalent.
- **A separate op/route for the params.** They belong to the same "AI behaviour" settings surface as the Q4/K4
  instruction + language; one op keeps the settings write atomic.
- **Store temperature as a Float.** A string cleanly distinguishes "unset" (empty → model default) from `0.0`
  (a valid explicit value); parsed + clamped in the provider.

## Consequences

- A workspace can pick its Gemini model (e.g. `gemini-2.5-pro` for quality vs `flash` for speed) + tune
  temperature for the Gemini-backed features. Claude features are unaffected (no such knob by design). Media
  model choice (low-poly/fast) is the next item (P3).
