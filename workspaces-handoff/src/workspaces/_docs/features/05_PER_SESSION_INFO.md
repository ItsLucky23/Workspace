# 05 — Per-session info (token + duration estimates, cost chips)

> Surfaces the running token/duration telemetry of every Stage-Agent and Assistant session, plus a **forward-looking estimate** for the stages a ticket hasn't reached yet. Extends [01 §4] (watchdog/`tokenEstimate`), [02 §2] (`emit_carryover`/`report_status`), and [06 §4] (the PTY token-estimate heuristic). Persistence already lives in [04] (`AgentSession.tokenEstimate`, `SpendRecord`, `WorkspaceBudget`).

---

## Scope

**In**

- A per-ticket **cost chip** = `actual-so-far` + `projected-remaining`, shown as a **range with a confidence level**, replacing the static `Ticket.costLabel` string.
- The **D4 estimate model** (BOTH): a planning Stage-Agent **self-estimates** `{ tokenEstimate, durationEstimate }` for the upcoming stage(s) at cold-start, emitted *inside its carry-over output* (no new verb); once history exists, that self-estimate is **blended** with the rolling `SpendRecord` averages for the same (preset, stage, model).
- A **per-model pricing table** (Haiku / Sonnet / Opus) so the range is reported in tokens *and* an advisory cost figure.
- Three UI surfaces: ticket-detail **header chip**, **board-card hover**, and the **Workspace-AI panel** ("how much will DEV-1240 cost?").
- **Stuck/idle detection interval** + the **raise-cap-and-resume** flow (B-35): when a session is parked `stuck` on a runaway guard, show why and offer a one-tap "raise cap & resume".

**Out**

- No monetary *budget enforcement* UI here — cap/auto-pause editing lives in WorkspaceSettings; this doc only **reads** `WorkspaceBudget` for context. We run on the Max subscription, so cost is **advisory** ([01 §6]), the real limit is quota.
- The estimate is never a write verb and never gates promotion. It is display + a soft watchdog target only.

**Deferred**

- Estimate **accuracy tuning / model retraining** beyond a flat blend (e.g. per-author or per-label priors) — later.
- Cross-workspace benchmarking ("your refine stage is slower than average") — later.

---

## User flow

1. **Ticket created → planning stage runs.** The planning Stage-Agent (the `advanced`/`professional` `Planning` stage; on `simple` the `Refinement` stage stands in) finishes its turn and calls `emit_carryover` (02 §2). Its envelope's `summary` carries a short **estimate block** for the downstream stages it can foresee (e.g. *"Coding ~120k tokens / ~25m, Review ~30k / ~8m"*). The Conductor parses that block out of the envelope on persist and seeds the projection.
2. **Cold-start vs warm.** First time a workspace runs a given (preset, stage, model), there's no `SpendRecord` history → the chip shows the **planning self-estimate** with **confidence: low** (wide range). After a few completed tickets, the Conductor blends self-estimate with the rolling average → **confidence: medium/high** (range tightens).
3. **During work.** Each `report_status` bumps the heartbeat; the orchestrator's running `tokenEstimate` ([06 §4]) ticks up. The chip's `actual-so-far` grows live; `projected-remaining` = (sum of estimates for not-yet-done stages) − (whatever the current stage has already spent).
4. **Stuck / idle.** The watchdog ([01 §4]) flips a session to `stuck` on a stale heartbeat, an `idle_prompt` hook, or a `--max-turns`/budget cap. The chip turns amber and the ticket banner shows the reason (e.g. *"paused — turn cap reached (40)"*). The user taps **Raise cap & resume**: this opens an **inline editor** for the new cap value, alongside a **quick "+50%" button** that bumps the run's `--max-turns`/budget cap by half. Either path lifts that run's cap and resumes the same session via `--resume` (`busy` again). The action is **gated on the pipeline/config RBAC capability** (not any member) since it edits a cap; members without it see the reason but not the lever. No new verb — this is a Conductor state write triggered by a user lever.
5. **Asking the Assistant.** "How much has DEV-1240 cost and what's left?" → the Assistant calls `get_ticket` (which already returns `costLabel`) and renders the same range inline.

**Desktop.** Header chip sits in the `TicketDetail` meta-chip row next to branch/MR. Hover reveals a small breakdown popover (actual per stage + projected per remaining stage + the confidence label).

**Mobile (~99% parity, B-37).** The chip stays in the collapsed ticket header; tap (not hover) opens the same breakdown as a sheet. The "Raise cap & resume" action is a full-width button in the needs-input card so it's thumb-reachable.

**Mockup hint (header chip + hover):**

```
TicketDetail header:  [⎇ DEV-1240]  [⑂ branch]  [⚐ MR !42]  [📊 €1.18 + ~€0.90  ·  ~33m left  ◔ med]
                                                              └─ hover ─────────────────────────┐
                                                              Coding   spent 82k   ~€0.74        │
                                                              Review   est 30k     ~€0.27  ◔ med │
                                                              Test     est 18k     ~€0.16  ◔ low │
                                                              confidence rises as history fills  │
                                                              ──────────────────────────────────┘
Board card:  DEV-1240  Add SSO   [busy]   📊 €1.18 +~€0.90   (hover → same breakdown)
```

---

## Data

All additive; nothing edits `04_DATA_MODEL.md`.

- **`AgentSession.tokenEstimate`** `Int @default(0)` — **already in [04 §2]**; this doc *surfaces* it (running per-session count from the PTY heuristic, [06 §4]). Not introduced here, listed so the chip's `actual-so-far` source is explicit.
- **`AgentSession.durationEstimate`** `Int?` (seconds) — optional cold-start self-estimate for *this* session, parsed by the Conductor from the planning agent's carry-over `summary` estimate block. Sibling of the existing `tokenEstimate`. Validation: `>= 0`, nullable until a planning stage has run.
- **`PipelineStage.avgTokensPerTurn`** `Int?` (prototype: add to `PipelineStageCfg`) — rolling per-stage average, recomputed by the Conductor from `SpendRecord` rows for that (stage, model). Feeds the D4 blend and the `projected-remaining` math. Validation: `>= 0`, nullable until ≥1 `SpendRecord` exists; recomputed on each stage `done`.
- **Prototype display type** — extend the existing `Ticket.costLabel` *concept* with a derived (ui-only) `CostEstimate` shape the chip renders (not persisted; computed from `SpendRecord` + the two fields above):
  ```ts
  interface CostEstimate {            // ui-only, derived
    spentTokens: number;              // Σ tokenEstimate of done+active sessions
    projectedTokens: [number, number];// [low, high] range for remaining stages
    spentCostAdvisory: number;        // priced via the per-model table
    projectedCostAdvisory: [number, number];
    durationRemainingMin: [number, number];
    confidence: 'low' | 'medium' | 'high';
  }
  ```
  `Ticket.costLabel` stays the denormalized one-liner for the board (now formatted as `"€1.18 +~€0.90 · ~33m"`); `CostEstimate` is the hover/breakdown detail. The per-model pricing table is an **editable workspace setting** (`PRICING` keyed by `StageModelTier` = `'haiku' | 'sonnet' | 'opus'`) with sensible defaults; advisory only, and zeroing the entries out renders the chip in **tokens only**.

**INDEX delta:** AgentSession.tokenEstimate (surfaced, already in 04), AgentSession.durationEstimate, PipelineStage.avgTokensPerTurn

---

## Verbs / Events / Hooks

**No new verbs.** Everything rides existing surfaces:

- **`emit_carryover`** ([02 §2]) — the planning agent's self-estimate `{ tokenEstimate, durationEstimate }` for downstream stages travels **inside the carry-over `summary`** as a short estimate block. The Conductor extracts it on persist; the agent invents *no* new verb and emits *no* new payload field (the envelope shape `{summary, changedFiles, openQuestions, commitHash}` is unchanged — [02 §4]).
- **`report_status`** ([02 §2]) — each call bumps `lastHeartbeatAt` and lets the orchestrator advance the running `tokenEstimate`; this is what makes `actual-so-far` live.
- **`get_ticket`** ([02 §2]) — already returns `costLabel`; the Assistant uses it to answer cost questions. Read-only, no change.
- **`Stop` hook** ([02 §3]) — turn-end is where the Conductor reconciles the session's `tokenEstimate` into a `SpendRecord` row and recomputes `avgTokensPerTurn`.
- **Watchdog** ([01 §4]) — the single `setInterval` already covers stuck/idle/budget; the **raise-cap-and-resume** lever is a Conductor state write (lift the run's `--max-turns`/budget cap, `--resume`), surfaced as a UI action, never an LLM verb.
- **`WorkspaceTrigger`** ([03 §1]) — optional `stage.on_stuck → notify` rule can fan a notification when a session parks on a cap (reuses the existing `when → then` engine + `run-command` allow-list; no engine change).

---

## UI

**Reused (real components):**

- **`MetaChip`** (`_screens/TicketDetail.tsx`) — the existing `chart-column`-icon chip rendering `costLabel` becomes the **estimate chip** (text → the `"actual +~projected · ~Xm"` string; amber tone when the session is `stuck`).
- **Board card cost pill** (`_screens/Board.tsx`, the `costLabel` span) — same string; hover opens the breakdown.
- **`InfoDot`** (`_components/primitives.tsx`) — the hover/tap breakdown popover (actual-per-stage + projected-per-stage + confidence), already supports left/right align for mobile.
- **`StatusPill`** + the `TicketDetail` `Banner` — the `stuck`/needs-input banner hosts the **Raise cap & resume** `WsButton`.
- **`Usage` screen** (`_screens/Usage.tsx`) — the per-ticket table gains a **projected** column (range) beside the existing `tokensIn`/`tokensOut`/`time`, sourced from `CostEstimate`. The footer note about runaway control stays.
- **`AIPanel`** (`_shell/Shell.tsx`, the per-user Assistant) — renders the same range when asked (→ 11).

**New (small):**

- A `CostBreakdown` presentational component (the hover/sheet body): a tiny per-stage rows + confidence dot (`◔`/`◑`/`●` for low/med/high). Pure render of `CostEstimate`; lives next to `MetaChip`.

**Mobile parity:** the chip and `CostBreakdown` are tap-to-open (sheet), not hover; "Raise cap & resume" is a full-width button in the needs-input card.

---

## Extends

- "[01 §4] Watchdog (stuck/idle, spec B-35): three signals → `stuck` … The same loop checks each session's `tokenEstimate`" — the chip's `actual-so-far`, the amber state, and the raise-cap lever all hang off this loop.
- "[01 §6] Budget (`SpendRecord`/`WorkspaceBudget`, B-35) is *advisory* on the subscription" — why cost here is a range/advisory, not an enforced number.
- "[02 §2] `report_status` … bump heartbeat" and "`emit_carryover` … the envelope (§4)" — the two existing verbs that feed live spend and the cold-start self-estimate respectively.
- "[02 §4] Carry-over envelope … `{summary, changedFiles, openQuestions, commitHash}`" — the self-estimate rides inside `summary`; the envelope shape is not extended.
- "[06 §4] Triggering — estimating tokens in an interactive PTY … the orchestrator maintains `AgentSession.tokenEstimate` (chars→tokens heuristic)" — the source of `actual-so-far`.
- "[04 §2] `AgentSession` … `tokenEstimate Int @default(0)`" and "[04 §8 / DATAMODEL.md §8] `SpendRecord` / `WorkspaceBudget`" — the persistence this doc surfaces; the blend reads `SpendRecord`.
- see [02_PIPELINE_PRESETS.md](./02_PIPELINE_PRESETS.md) — the per-stage `PipelineStage.avgTokensPerTurn` rolling averages computed here feed preset/estimate tuning (the dependency-graph `05 → 02` edge).

---

## Resolved

1. **05.q1 — Estimate-block format inside `summary`.** The estimate is emitted as a **fenced JSON block** inside the planning agent's `emit_carryover` summary. The Conductor parses that block out on persist; no envelope or verb change.
2. **05.q2 — Blend weighting.** Blend = `α·selfEstimate + (1−α)·rollingAvg`, with `α=1` at 0 samples decaying to **~0.3 by ~10 samples** (accepted default).
3. **05.q3 — Confidence thresholds.** Confidence is low/medium/high keyed by sample count, **per (preset, stage, model)** (accepted default).
4. **05.q4 — Raise-cap-and-resume defaults.** Both: an **inline editor** plus a **quick "+50%" button**. The lever is **gated on the pipeline/config RBAC capability** (not any member).
5. **05.q5 — Pricing-table source.** The advisory `PRICING` is an **editable workspace setting** with sensible defaults; zero it out to show **tokens only**.
