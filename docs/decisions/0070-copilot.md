---
id: 0070
title: AI-drives-UI copilot — propose a directive, never write (F4.3)
status: accepted
date: 2026-07-06
tags: [content, copilot, assistant, b-23, expansion-f43]
supersedes: []
depends_on: [0049, 0067]
---

# AI-drives-UI copilot (F4.3)

## Context

The user wants the AI to steer the app (navigate + pre-fill forms) for a good UX — but B-23 forbids LLMs writing authoritative state, and literal pixel-clicking of our own UI is an anti-pattern (ADR 0049). F4.3 builds the copilot as a PROPOSAL model: the Assistant proposes a UI directive; the client applies the navigate/pre-fill guidance; the user confirms the underlying control-op (the Conductor writes).

## Decision

A `copilot-propose` op (B-23, `workTickets`) creates a `WorkspaceSuggestion(type:'copilot', patch:{navigate, prefill, op})` — the UI directive: WHERE to navigate, WHAT to pre-fill a form with, and the underlying control-op the user would confirm. The copilot **writes nothing authoritative** — only the proposal. The client (browser-deferred) reads it, navigates + pre-fills, and the user taps the real control-op (which the Conductor executes). This is "AI drives, human confirms".

## Rejected alternatives

- **The AI clicks the real UI (Playwright/agent-browser on our own app).** Rejected (ADR 0049) — brittle + slow + an anti-pattern for our own app; browser-automation is the fallback ONLY for EXTERNAL tools with no API.
- **The copilot executes the op directly on propose.** Rejected — that skips the confirm; the op runs only on the user's explicit action (B-23; the directive just pre-fills it).
- **A bespoke copilot channel outside suggestions.** Rejected — a `WorkspaceSuggestion(type:'copilot')` reuses the existing propose→accept surface (no new verb/entity, invariant #2).

## Consequences

- New `copilot-propose` op → a `copilot` suggestion carrying `{navigate, prefill, op}`. The client rendering (navigate + pre-fill the named form) is the browser-deferred UX layer; the backend proposal model + the never-write invariant are proven now.
- `tests/integration/copilot.test.mts` (7): a copilot proposal creates a suggestion with navigate+prefill+op and writes NOTHING authoritative; confirming the named op creates the content piece (Conductor writes). Closes Fase 4. rbac 122/122.
