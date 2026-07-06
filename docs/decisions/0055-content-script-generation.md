---
id: 0055
title: Content script + beats generation with a stub fallback (F1.2)
status: accepted
date: 2026-07-06
tags: [content, script, ai, stub, expansion-f12]
supersedes: []
depends_on: [0049, 0052, 0053, 0054]
---

# Content script + beats generation (F1.2)

## Context

The `script` stage turns a brief into a narration Script + storyboard Beats (each beat carries a `visualPrompt` that drives the per-beat image in F1.4). Script generation is text, so it uses the text AI abstraction (`runAiCompletion`) — but that has NO stub fallback (unlike the media registry, F0.3), and no keys exist. So with no key it would return `ai.providerUnavailable` and the pipeline would stall.

## Decision

1. **A content-script service `server/content/script.ts`** — `generateScript(prisma, { workspaceId, contentProjectId, brief, styleKey?, extraInstructions? })` resolves the `script` style + composes the system prompt (F0.4), calls `runAiCompletion('script', …)`, then writes a `Script` + ordered `Beat` rows and returns `{ scriptId, beatCount, stub, providerId }`.
2. **A CONTENT-LOCAL stub fallback.** When the provider is unavailable (no key), `generateScript` produces a valid-shaped 4-beat script from the brief (dummy-data mode) — the stub lives in the content layer, NOT in `runAiCompletion`, so the global text abstraction (incl. the coding agent) never silently stubs.
3. **`script` is a text `AiFeature`** (default `gemini-api` — non-coding bulk text, overridable). The `Script` records the resolved `providerId` + links the resolved `styleId`.
4. **Driven by a `content-gen-script` control-op** (B-23, `workTickets`) — the Conductor calls `generateScript` for the piece.

## Rejected alternatives

- **Add a stub fallback to `runAiCompletion`.** Rejected — it would make EVERY text feature (including the PTY coding agent) silently return dummy text when a provider is down; the stub must be content-scoped. (Mirrors F0.3's registry-level media stub, but kept in the content service because the text registry is shared with coding.)
- **One giant prompt that returns script+beats as JSON parsed live.** Deferred — no key to exercise it; `parseLiveScript` is a simple line-split placeholder until the live prompt format is finalised (keyed follow-up). The stub is the tested path now.
- **Store beats as a JSON blob on Script.** Rejected — first-class `Beat` rows (F0.1) let F1.4 attach a produced image per beat + F1.5 time the montage per beat.

## Consequences

- New `server/content/script.ts` + `script` AiFeature + the `content-gen-script` op. F1.3 (voice) + F1.4 (per-beat image) consume the Script + Beats; F1.5 assembles them.
- `tests/integration/contentScript.test.mts` (8 assertions): a script + 4 ordered beats written, style resolved + linked, provider recorded, beats reflect the brief + carry visual prompts. `rbac` 122/122, `aiRegistry` 12/12 with the new feature.
