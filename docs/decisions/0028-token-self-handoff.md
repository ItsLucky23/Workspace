---
id: 0028
title: Token self-handoff — controlled handoff → reset → reload on budget
status: accepted
date: 2026-07-03
tags: [workspaces, tokens, context, handoff, orchestrator]
supersedes: []
---

# 0028 — Token self-handoff

## Context

Goal-item #4 (doc 06). A long interactive `claude` turn fills its context window; letting the CLI
auto-compact is opaque and drops whatever it decides. The `Handoff` schema + the `emit-handoff` verb
existed, but nothing drove the cycle. We want a CONTROLLED handoff → reset → reload: when a session
crosses a token budget, the AI writes a thorough handoff, we store it, reset, and reload it into a
fresh session — carry-over generalized to WITHIN a session.

## Decision

- **`server/orchestrator/handoff.ts`** (pure + persistence): `budgetForStage` (per-stage
  `modelCfg.contextBudgetTokens`, else `WS_TURN_TOKEN_BUDGET` default), `shouldHandoff`,
  `parseHandoff` (extracts the AI's ` ```ws-handoff ` JSON block, like ws-carryover),
  `recordHandoff` (persists a `Handoff` + RESETS `AgentSession.tokenEstimate` — the reset frees
  context), `latestHandoff` + `renderHandoffReload` (the reload text), and the editable
  `DEFAULT_HANDOFF_INSTRUCTION`.
- **Trigger** (`stageRunner.runStage`, after a turn that did NOT complete the stage — the session
  persists): if the running estimate (#16) crossed the budget, drive a handoff turn (the AI, with
  full context, writes its handoff), store it, and **clear `claudeSessionId`** so the next turn
  starts a FRESH claude session — this IS the `/clear`. No interactive slash-command needed.
- **Reload** (`renderStage`): when a session starts fresh (no `claudeSessionId`) and has a stored
  handoff, inject `renderHandoffReload(handoff)` as the opening context. A crash-resume (#1, which
  keeps `claudeSessionId`) continues the old transcript instead, so it skips the reload.
- **PreCompact backstop**: a `PreCompact` hook in the stage settings drops a marker when Claude is
  about to auto-compact; the trigger fires the handoff on that marker even under budget (reason
  `precompact`), then clears it. "Use whichever fires first" (doc 06 §4).
- **Config**: per-stage budget is `modelCfg.contextBudgetTokens` (already schema→save→snapshot
  plumbed) + a new editable input in the Pipeline "Model & Effort" tab (i18n en/nl/de/fr).

## Rejected alternatives

- **Interactive `/clear` to the PTY.** Each turn already spawns a fresh `claude --resume`; dropping
  `claudeSessionId` (→ no resume → empty context) achieves the reset without an interactive command,
  and is testable. `/compact` (keep Claude's own summary) remains a future per-workspace option.
- **Let the CLI auto-compact.** Opaque — we lose control of what survives. The whole point is a
  curated handoff.
- **A separate top-level `PipelineStage.contextBudgetTokens`.** Redundant — the budget already lives
  in the `StageModelCfg` composite and flows to the frontend; runStage reads that.

## Consequences

- A session that crosses its budget hands off + resets cleanly; the next turn resumes lean from its
  own summary. PreCompact is the hard backstop.
- Verified: `handoff.test.mts` (18/18) — budget/shouldHandoff/parseHandoff/renderHandoffReload
  (pure) + the real record→reset→reload cycle (recordHandoff resets tokenEstimate to 0, latestHandoff
  reads it back). Full suite 30/30. Browser: the Context-budget input renders + persists end-to-end
  (UI 80000 → save-stage-config → DB `modelCfg.contextBudgetTokens=80000`). The live PTY handoff-turn
  drive + `/clear`-reset is wired but only runs against Docker + a genuinely over-budget session
  (not exercised headless).
