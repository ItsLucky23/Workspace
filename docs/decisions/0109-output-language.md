---
title: A per-workspace output language directive steers every AI generation
status: accepted
date: 2026-07-07
tags: [ai, i18n, content, freedom-program]
---

## Context

FREEDOM_PROGRAM item **K4**. Generated content was English-by-default — no way to choose the AI OUTPUT
language (script/voice/copy in NL/DE/FR/…); the model just inferred it from the brief. (The app UI i18n is
separate — this is the generated content's language.)

## Decision

- A `Workspace.outputLanguage` field (a language name, e.g. `Dutch`; empty = the model's default). It is
  prepended as a strong directive ("Write all output in Dutch.") to **every** AI completion's system prompt at
  the same single choke-point as the Q4 instruction (`workspaceAiPrefix` in `server/ai/registry.ts`).
- Edited via a language Dropdown in the AI settings tab, persisted through the extended `save-ai-instruction`
  op (which now carries `aiInstruction` + `outputLanguage`). Voice/TTS follows because it reads the (now
  target-language) script.

## Rejected alternatives

- **Rely on the Q4 free-text instruction ("write in Dutch").** That works, but a dedicated dropdown is far more
  discoverable (premium UX) + is the seam for provider-specific language params (e.g. a TTS voice locale) later.
- **A per-generation language field on every content op.** More surface for marginal gain; a per-workspace
  default covers the common case. A per-piece override can be added on top later.
- **Translate after generation.** A second model call + drift; instructing the model to generate in-language is
  cheaper + higher quality.

## Consequences

- One dropdown makes every script/copy/analysis (and the voiceover that reads the script) come out in the
  chosen language. Empty = auto (unchanged behaviour). A per-generation override + an explicit TTS voice-locale
  are documented follow-ups.
