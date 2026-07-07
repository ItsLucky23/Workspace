---
title: A workspace-wide AI instruction is prepended to every AI completion, at one choke-point
status: accepted
date: 2026-07-07
tags: [ai, workspace, steering, freedom-program]
---

## Context

FREEDOM_PROGRAM item **Q4**. There was no way to set a workspace-wide "how the AI should work here" —
tone/rules/preferences that ALL AI features (dev + content) always follow. The dead `Workspace.handoffInstruction`
field was named for a different (unbuilt) self-handoff purpose. Per-stage prompts steer one stage; the content
brand context (Q2) steers creative facts — neither is a global behavioural steer.

## Decision

- A dedicated `Workspace.aiInstruction` field (not the mis-named `handoffInstruction` — a clean field avoids
  overloading a differently-purposed one; a conscious deviation from the program's literal "revive
  handoffInstruction" wording, Rule 3b).
- It is prepended to **every** AI completion's system prompt at ONE choke-point — inside `runAiCompletion`
  (`server/ai/registry.ts`), which every feature already routes through — fetched best-effort via
  `getPrismaClient()` (the same singleton the media registry uses), so all 15 text features are steered without
  touching 13 call sites.
- Editable in a new "AI" tab in workspace settings; persisted via a `save-ai-instruction` control-op
  (single-writer) broadcast back to the room.

## Rejected alternatives

- **Revive `handoffInstruction`.** It is named/documented for a specific self-handoff mechanism; overloading it
  as a general behavioural instruction is confusing. A dedicated field is clearer and leaves the other for its
  intended purpose.
- **Inject at each call site.** 13 features would each need to read + prepend it — duplication + drift. The
  registry choke-point does it once.
- **Put it in content settings.** It applies to ALL AI (dev + content), so workspace settings is the correct home.

## Consequences

- One instruction ("always British English, be concise, never invent stats") now steers every AI task in the
  workspace. Combined with Q2 (brand facts) and Q3 (styles), the user shapes AI behaviour without code.
- One extra indexed `findUnique` per completion (best-effort, cached by Mongo); negligible next to a model call.
