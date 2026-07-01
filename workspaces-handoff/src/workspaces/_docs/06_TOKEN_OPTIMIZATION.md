# 06 — Token optimization (context budget + self-handoff)

> Keeps long-lived interactive sessions from filling their context window — a custom, controllable alternative to relying on Claude's built-in auto-compaction. Prereq: [01](./01_ARCHITECTURE.md), [02](./02_PROTOCOL_AND_FLOW.md). Persistence: [04](./04_DATA_MODEL.md) `Handoff`.

---

## 1. The problem

A user who's active for a long time stacks tokens in their **Assistant** session; a big ticket stacks tokens in its **Stage-Agent**; the optional one-shot background reasoner (if ever used) is short-lived so it's least affected. We're not worried about tokens *within a single ticket turn* — we're worried about **long-lived sessions growing context unbounded**, which slows them and eventually forces an uncontrolled auto-compaction that can drop exactly the detail we needed.

## 2. The mechanism — a controlled self-handoff cycle

Instead of letting Claude auto-compact opaquely, the orchestrator drives a **handoff → reset → reload** cycle when a session crosses a configured budget. This is **carry-over generalized to *within* a session** (02 §4): the same "write a structured summary, hand it to the next state" idea, applied to the same session id.

```
after each completed turn (Stop hook / turn-end):
  estimate = session.tokenEstimate                       // running estimate (§4)
  cap      = stageBudget ?? workspaceAiBudget(role)       // §3
  if estimate > cap:
     1. send the editable HANDOFF INSTRUCTION as the next prompt
     2. AI writes a detailed handoff  →  emit_handoff({...})  →  Handoff record (04)
     3. send  /clear   (recommended; fully fresh) — or  /compact  (lighter)
     4. feed the handoff back as the fresh opening context
     →  same claudeSessionId continues, lean context.   status note: "token-optimized"
```

The **Conductor** owns this cycle (it's a state transition, not the LLM's call). It runs in the SessionManager watchdog alongside the stuck/idle checks (01 §4).

## 3. Configuration (all editable)

- **Per-stage budget** — `contextBudgetTokens` on `PipelineStageCfg`/`StageModelCfg` (04 §3). Lets a heavy code stage carry a bigger budget than a light one.
- **Per-workspace-AI budget** — `assistantTokenBudget` (+ an optional `reasonerTokenBudget`) (workspace settings). The Assistant budget is the important one (long user sessions).
- **The handoff instruction** — an **editable default template** at the workspace level, overridable per stage/role. Default reads roughly:

  > *"You're about to be reset to free up context. Write a thorough handoff so a fresh you can continue seamlessly: the goal; key decisions and why; the current state and what's done; what's left to do next; gotchas/dead-ends to avoid; open questions. If you were given carry-over from a previous stage, fold the still-relevant parts forward so they survive the reset. Be detailed — this is the only thing that survives. Call `emit_handoff` with it."*

  Editable so the user can tune what survives (e.g. "always preserve the DB schema notes").

## 4. Triggering — estimating tokens in an interactive PTY

An interactive PTY does **not** hand you an exact live token count, so:
- **Primary: an orchestrator-side running estimate.** The orchestrator sees every byte written to and read from the PTY; it maintains `AgentSession.tokenEstimate` (chars→tokens heuristic, or per-turn deltas). Rough but fully in our control and good enough to fire a budget at, say, 70–80% of the model's window.
- **Secondary: co-opt Claude's `PreCompact` hook** — it fires when Claude itself is about to auto-compact (i.e. genuinely near the limit). Treat that as a hard trigger: do *our* handoff cycle instead of (or just before) letting auto-compaction run, so we control what survives.
Use whichever fires first. The budget is a soft target; `PreCompact` is the backstop.

## 5. `/clear` vs `/compact`

- **`/clear` + reload (recommended default):** fully empties the context, then we inject the handoff as the opening message. Maximum control — the handoff file *is* the curated state, and nothing stale lingers.
- **`/compact` (lighter):** keeps Claude's own summary. Less control, but cheaper and keeps some implicit context. Offer as a per-workspace option.

Both are interactive-CLI slash commands (write `\r`-terminated to PTY stdin) — they work because every session is interactive (01 §1). There is no headless path here.

## 6. Persistence & verbs

- **`emit_handoff`** verb (02 §2) — `{ summary, decisions[], state, next[], gotchas[], carried? }`. The AI calls it; the orchestrator stores a **`Handoff`** record (04) keyed by `sessionKey`, then resets.
- A session's handoff history is auditable (debugging "what did it carry across the reset?") and can seed the UI ("context optimized 2× this session").

## 7. Who it applies to

| Session | Budget source | Notes |
|---|---|---|
| **Assistant** (per-user) | `assistantTokenBudget` | the main case — long user chats |
| **Stage-Agent** (code/worker) | stage `contextBudgetTokens` | big tickets; the handoff folds carry-over forward |
| **Reasoner** (optional, one-shot) | `reasonerTokenBudget` | rarely hit (short-lived); budget still applies if a batch is huge |

## 8. Why this beats relying on auto-compaction

Controllable (you set the budget + the instruction), observable (the `Handoff` is stored and inspectable), and it **preserves exactly the cross-stage detail** auto-compaction can silently drop — especially the carried prior-stage context that agents building on previous work depend on. It also reuses machinery you already have (the carry-over template + the structured channel), so it's cheap to build.

> Build order: this is a **P2/P3 lane** in [05](./05_BUILD_PLAN.md) — after the thin Assistant PoC proves the interactive-PTY chat works, layer the budget check + self-handoff onto long sessions.
