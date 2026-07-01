# Addition 14 — Predictive budget / ETA

> **Tier:** HORIZON (designed, not built in V1) · **Lane:** B + C · **Status:** NEW (2026-06-11).
> **Pitch:** Before a stage starts, forecast a ticket's *"≈N turns / €X / done ~T"* and, fleet-wide, *"quota exhausts ~T at current burn"* — deterministic projections from history (`PipelineStage.avgTokensPerTurn` + `SpendRecord` rolling rates + the D4 blend), NO LLM, shown with a confidence band like the existing per-session estimate.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #14.

---

## 1. The gap this closes

The per-session cost surface ([features/05]) already answers *"what has DEV-1240 cost and what's left **on the stage it's in**?"* — a `CostEstimate` chip = `actual-so-far` + `projected-remaining`, ranged, confidence-banded. Two questions it does **not** answer today:

1. **Per-ticket, look-ahead-before-start.** [05] seeds `projected-remaining` only once a **planning stage has run** and emitted its self-estimate inside `emit_carryover` (the D4 cold-start block). A ticket sitting *unstarted* in the backlog has no number — you can't see *"this ticket will take ≈4 turns / €0.90 / done ~35m"* until work begins. [05]'s `projectedTokens` math is *remaining-stages-from-here*, not *whole-ticket-from-zero*.
2. **Fleet-level, time-to-quota.** [01 §6] makes cost **advisory** (the Max subscription's real limit is **quota**, not euros) and handles exhaustion **reactively** — *"on sustained throttling … the orchestrator sets the affected session to `stopped` (mapped to `stuck`, note 'rate limit — subscription quota')"*. There is no **forward** signal: *"at the current burn rate, the rolling quota window empties ~16:40."* The operator learns about exhaustion only when a session already stalled.

Addition 14 closes both with the **same deterministic machinery** [05] already trusts — no new estimator, no model, no LLM. It is the *whole-ticket* and *whole-fleet* projection of the per-stage estimate that [05] proved.

---

## 2. Locked decision (both per-ticket ETA + fleet quota forecast)

**Build BOTH** (LOCKED, ledger #14):

| | Per-ticket ETA | Fleet quota-exhaustion forecast |
|---|---|---|
| **Question** | *"≈N turns / €X / done ~T"* for a ticket, **before its next/first stage starts** | *"current quota − burn rate → exhaustion ~T"* across the whole host |
| **Inputs (all existing)** | per-stage `PipelineStage.avgTokensPerTurn` × the preset's remaining `StageKind` sequence + [05]'s D4 blend (`α·selfEstimate + (1−α)·rollingAvg`) | rolling `SpendRecord` token-rate (tokens/min over a trailing window) vs the current quota headroom |
| **Surface** | the [05] ticket/session **cost chip** + breakdown popover (a *whole-ticket from-zero* row added to the existing *remaining-from-here* rows) | feeds **[additions/08] vitals**; **pairs with [additions/13] quota probe** (probe supplies *current quota headroom* → 14 supplies *burn rate* → exhaustion time) |
| **Confidence** | the existing low/med/high band, keyed by sample count per (preset, stage, model) — [05] Resolved 3 | a band on the burn rate (wide when the trailing window is short / bursty) |

**DEFAULT — flag if wrong (the four defaults this addition assumes; correct any in §5):**

- **D14.1 — Deterministic, NO LLM.** Both forecasts are pure projections from persisted history; no agent is asked to estimate the fleet or the whole ticket. (The planning agent's per-stage self-estimate already feeds the blend via [05]; 14 adds *no* new agent-sourced estimate.)
- **D14.2 — Per-ticket ETA lives on the [05] cost surface**, not a new screen — it extends the existing chip/breakdown.
- **D14.3 — The fleet forecast feeds [additions/08] vitals and pairs with [additions/13]'s quota probe** — 14 owns the *burn-rate → exhaustion-time* projection; 13 owns *reading current quota headroom*; 08 owns *rendering* the resulting "quota exhausts ~T" vital.
- **D14.4 — Confidence band identical in shape to [05]'s D4 estimate** (low/med/high, widening when history is thin).

> If any of D14.1–D14.4 is wrong (e.g. the fleet forecast should be its OWN surface, not an [08] vital; or 13 should own the projection and 14 only the data) — **flag before building**; these are the addition's load-bearing assumptions.

---

## 3. Design-grade mechanics

### 3.1 Per-ticket ETA (extend the D4 estimate; cite [features/05], [04b §9])

The per-ticket ETA is the **whole-ticket** generalization of [05]'s **remaining-stages** projection. [05] already computes, for the stages *not yet done*:

```
projectedTokens = Σ over not-yet-done stages ( avgTokensPerTurn[stage,model] × expectedTurns[stage] )   // [05] §Data
```

…blended at cold-start with the planning agent's self-estimate (`α=1` at 0 samples decaying to ~0.3 by ~10 samples, [05] Resolved 2). **14 changes the summation domain, not the math:** project across the **full ordered `StageKind` sequence the preset will instantiate** (from `refine` through `final`, [04b §12]) starting from the ticket's *current* position — including, for a backlog ticket, position = before stage 0.

**Inputs (every one already persisted — no new field):**

| Input | Source | Cite |
|---|---|---|
| per-stage rolling average | `PipelineStage.avgTokensPerTurn Int?` (recomputed by the Conductor from `SpendRecord` on each stage `done`) | [04b §9] field-sweep row; [05] §Data |
| per-turn cost facts behind the average | `SpendRecord { tokensIn, tokensOut, model, costEstimate, stageId, sessionKey }`, indexed `@@index([workspaceId, stageId, createdAt])` ("rolling per-stage average → the D4 estimate blend") | [04b §9] |
| the preset's stage sequence | the ordered `StageKind[]` a preset emits (3-tier `['refine','code','review']` … 7-tier `['refine','plan','code','review','review','test','final']`) | [04b §12] |
| cold-start self-estimate (when no history) | `AgentSession.durationEstimate Int?` + the `tokenEstimate` parsed from the `` ```ws-estimate `` fenced block in `emit_carryover` | [04b §7], [04b §14], [05] §Data |
| advisory pricing | `Workspace.pricing Json` (per-model price map, editable; zero-out → tokens-only) | [04b §13], [05] Resolved 5 |

**Output — extend the existing `CostEstimate` (ui-only, derived; [05] §Data) with a from-zero whole-ticket projection.** [05]'s shape already carries `projectedTokens: [low,high]`, `projectedCostAdvisory`, `durationRemainingMin`, `confidence`. 14 adds **one derived sibling** the chip can render for an unstarted/early ticket — a whole-ticket total rather than remaining-from-here:

```ts
// ui-only, derived — extends [05]'s CostEstimate; NOTHING persisted, NOTHING edits 04.
interface TicketEta {                  // the whole-ticket, before-next-stage forecast
  expectedTurns: [number, number];     // ≈N turns, ranged
  totalTokens:   [number, number];     // Σ over the FULL remaining StageKind sequence
  totalCostAdvisory: [number, number]; // priced via Workspace.pricing; tokens-only when zeroed
  etaMinutes:    [number, number];     // ≈ done in ~T
  confidence: 'low' | 'medium' | 'high'; // same banding as CostEstimate ([05] Resolved 3)
}
```

- **Cold-start (no `SpendRecord` for a (preset, stage, model)):** fall back to the planning self-estimate at `confidence: low` exactly as [05] does; for a *fully* unstarted backlog ticket with no planning run yet, project from the **workspace-wide** rolling `avgTokensPerTurn` per `StageKind` (the cross-ticket average) at `confidence: low`. **Never invent a number from an LLM** (D14.1).
- **Warm:** the band tightens to med/high as sample count per (preset, stage, model) grows — identical thresholds to [05] Resolved 3.
- **No new verb, no new persisted field.** `TicketEta` is computed by the Conductor/server from existing rows on read, exactly as `CostEstimate` is. The `` ```ws-estimate `` fenced-block parsing contract ([04b §14]) is unchanged.

### 3.2 Fleet quota-exhaustion forecast (burn rate vs [additions/13] probe; cite [01 §6])

[01 §6] establishes the world this forecast lives in: *"Budget … is **advisory** on the subscription (the real limit is **quota**, not dollars)"*; exhaustion is currently **reactive** (`stopped` mapped to `stuck`, note *"rate limit — subscription quota"*). 14 makes it **predictive**:

```
exhaustionAt  =  now  +  ( quotaHeadroom / burnRate )

  quotaHeadroom  ← from [additions/13] quota probe (current remaining in the active quota window)
  burnRate       ← tokens-per-minute over a trailing window, summed from SpendRecord across ALL active sessions
```

- **Burn rate (14 owns this):** a rolling tokens/min (and €/min, advisory) computed from `SpendRecord` over a trailing window (e.g. the last 30m, or aligned to the quota window's unit). `SpendRecord` is per-turn and append-only ([04b §9], [04b §11a]); summing the trailing slice across all `sessionKey`s gives the live fleet burn. This is the fleet analogue of [05]'s per-session `actual-so-far`.
- **Quota headroom ([additions/13] owns this):** the **quota probe** reads how much of the current subscription quota window remains. [04b §9]'s `WorkspaceBudget.periodWindow` already models a rolling window (`{ rolling: '5h' }`) *"to express provider-native quotas (e.g. Claude's 5-hour)"* — the probe's headroom is read against that window. **14 consumes 13's headroom number; it does not re-probe.** (If 13 is not installed, the forecast degrades to *burn-rate only* — "≈X tokens/min, no quota signal" — never a fabricated headroom.)
- **The projection (14 owns this):** `exhaustionAt` = a clock time, with a **confidence band on `burnRate`** (wide when the trailing window is short or bursty; narrow under steady multi-session load). When `exhaustionAt` falls inside the alerting horizon, it is a signal [08] renders and (optionally) a `Notification` fans out — reusing the existing notify path, **no new verb**.
- **Alignment with the reactive path:** the predictive forecast does **not** replace [01 §6]'s reactive `stopped`-on-throttle behavior — it *precedes* it. The reactive map is the floor (correctness); the forecast is the heads-up (UX). Both read the same quota reality.

### 3.3 Surfaces (ticket cost chip + [additions/08] vitals)

| Forecast | Surface | Reuse |
|---|---|---|
| **Per-ticket ETA** (3.1) | the **[05] cost chip** in the `TicketDetail` meta-chip row + the board-card pill + the hover/sheet **`CostBreakdown`** popover — a whole-ticket *"≈N turns · €X · ~T · ◔/◑/●"* line above the existing per-stage rows. Also answerable by the Assistant ("how long will DEV-1240 take?") via the read-only `get_ticket` path ([05] §Verbs). | `MetaChip`, `CostBreakdown`, `InfoDot`, the confidence dot `◔/◑/●` — all from [05]. **No new screen.** |
| **Fleet quota forecast** (3.2) | a **vital in [additions/08]** — *"quota exhausts ~16:40 at current burn (≈12k tok/min ◑)"* — alongside the other fleet vitals; **pairs with [additions/13]** (13 = headroom gauge, 14 = the projection that turns it into a time). | [08]'s vitals layout; [13]'s probe value; [19]'s budget-bar styling for the advisory tone + the *"hard limit is plan quota"* note ([01 §6], [19] flow 2). |

Mobile parity follows [05]/[19]: the ticket ETA is tap-to-open (sheet), the fleet vital stacks in the [08] vitals view; both are read-only (no lever — raising a cap stays [05]/[19]'s raise-cap-and-resume flow, unchanged).

---

## 4. Invariants honored

| Invariant | How 14 honors it |
|---|---|
| **B-23 (Conductor is the ONLY writer; AI proposes, never writes)** | Both forecasts are **read-side derivations** computed by the Conductor/server from existing rows. No forecast is *written* by an LLM; the planning self-estimate keeps riding the existing `emit_carryover` fenced block ([04b §14]). Any action off a forecast (raise cap, pause) is the existing [control-API] lever. |
| **FROZEN 7+6 verbs (none added, none write)** | **No new verb.** `get_ticket` (read), `emit_carryover` (existing fenced `` ```ws-estimate `` block), the `Stop` hook (existing `SpendRecord` accrual) are the only surfaces touched — all unchanged ([05] §Verbs, [04b §14]). |
| **`runInTenant` on every non-`/api` path** | The per-ticket ETA aggregation runs tenant-scoped (`SpendRecord`/`PipelineStage` carry `workspaceId`, [04b §11b/§11c]). The **fleet** burn-rate is a host-level roll-up — it MUST still iterate per-workspace under `runInTenant` and sum the results host-side (never a cross-tenant `SpendRecord` read; [04b §11c] — `currentWorkspaceId()` throws on a bare read). Flagged in §5 as a sub-decision. |
| **PTY-billing reality (advisory cost, quota is the real limit)** | The euro figures stay **advisory** ([01 §6], [05] Scope-Out, [19] flow 2); the **fleet** forecast is expressed against **quota** (tokens / the rolling window), not dollars — the cost number rides along only as the priced advisory. `SpendRecord.tokensIn/Out` are explicitly **ADVISORY in PTY mode** (hook payload else char-count, [04b §9]) — the band reflects that. |
| **LuckyStack conventions** | `TicketEta` is a ui-only derived type (like [05]'s `CostEstimate`) — nothing edits `04_DATA_MODEL.md`. Components reused, not parallel-built (Rule 12). i18n on all new strings (Rule 13). No new persisted field unless §5 promotes the trailing-window cache (defaults to *not*). |
| **V1_SCOPE wins** | This whole addition is **HORIZON — OUT of V1** ([V1_SCOPE §4 — analytics/insight surfaces are post-MVP]). The event log + `SpendRecord` + `avgTokensPerTurn` it folds over ship in V1; the *forecast* surface does not. Pinned here so a future lane doesn't re-derive it. |

---

## 5. Open sub-decisions (DEFAULTs)

| # | Sub-decision | DEFAULT (flag if wrong) |
|---|---|---|
| **S1** | Does the fleet forecast live as an **[08] vital** or its **own surface**? | **[08] vital** (D14.3). It is one number among the fleet vitals; a dedicated screen is over-built for a single projection. Flag if the operator wants a forecast *history/trend* (then it earns its own surface). |
| **S2** | Who owns *current quota headroom* — **[13] probe** or 14? | **[13] owns headroom; 14 owns burn-rate × projection.** Keeps 14 a pure projector over history (D14.1) and 13 the single quota-reader. If 13 is absent, 14 shows burn-rate only, never a fabricated headroom. |
| **S3** | Trailing burn-rate window length + alignment | **Default 30m trailing, but align to the active `WorkspaceBudget.periodWindow` rolling unit when one is set** ([04b §9] `{ rolling: '5h' }`). A `5h` quota window → a `5h`-aligned burn slice is the most honest projection. |
| **S4** | Is the fleet roll-up **cached** or computed on read? | **Computed on read** in V-of-this-addition (no new persisted field), matching [05]'s on-read `CostEstimate`. Promote to a small cached `FleetBurn` snapshot **only if** the host-wide per-tenant `runInTenant` sweep proves too heavy at fleet scale — that's a perf decision, deferred. |
| **S5** | Whole-ticket ETA for a ticket whose preset has **two `review` stages** (dual-review, [04b §12]) | Project each `review` stage **separately** by `order` (they share `kind:'review'` but the rolling average is keyed per stage `id`, not per `kind`) — matches [04b §12]'s "distinguished by order, not kind". |
| **S6** | Confidence banding for the **fleet** rate (vs per-ticket) | Reuse [05]'s low/med/high shape but key it on **trailing-window sample density + variance** (bursty load → low), not the (preset,stage,model) sample count [05] uses for per-ticket. Same dots `◔/◑/●`. |

---

## 6. Future build checklist (per-lane + verification)

> All **HORIZON / deferred** — do not build in V1. This is the day-the-lane-opens checklist.

**Lane B (data / projection engine):**

- [ ] **Whole-ticket ETA aggregator** — server fn that sums `avgTokensPerTurn × expectedTurns` over the full remaining `StageKind` sequence from a ticket's current position; blends the planning self-estimate per [05] Resolved 2 at cold-start. **Verify:** unit test — a ticket with N `SpendRecord` rows yields a `TicketEta` whose band narrows as N grows (low→med→high at the [05] thresholds); a zero-history ticket falls back to the workspace-wide per-`StageKind` average at `confidence:'low'` and **never** calls an LLM.
- [ ] **Fleet burn-rate roll-up** — host-level tokens/min (+ advisory €/min) summed from `SpendRecord` over the trailing window, **iterated per-workspace under `runInTenant`** and summed host-side. **Verify:** a test with two tenants confirms the roll-up sums both *without* a cross-tenant read (assert `currentWorkspaceId()` is set on every `SpendRecord` query; a bare read throws — [04b §11c]).
- [ ] **Exhaustion projection** — `now + headroom/burnRate` consuming [13]'s headroom; degrades to burn-rate-only when 13 is absent. **Verify:** with a fixed headroom + fixed burn, `exhaustionAt` is the expected clock time; with 13 absent, the output carries `headroom: null` and no fabricated time.

**Lane C (surface):**

- [ ] **Ticket ETA on the [05] chip/breakdown** — render the whole-ticket `TicketEta` row above [05]'s remaining-stage rows; tap-to-open on mobile. i18n all strings. **Verify:** the chip shows `≈N turns · €X · ~T · ◔/◑/●`; tokens-only when `Workspace.pricing` is zeroed ([05] Resolved 5); Assistant `get_ticket` answers "how long will DEV-#### take?" with the same numbers.
- [ ] **Fleet vital in [08]** — *"quota exhausts ~T at current burn (≈R tok/min ◑)"*, with [19]'s advisory tone + the *"hard limit is plan quota"* note. **Verify:** the vital renders against [13]'s headroom; shows a burn-rate-only state when headroom is unavailable; no lever (raise-cap stays [05]/[19]).

**Cross-lane verification:**

- [ ] **No new verb / no LLM in the forecast path** — grep the diff: no new entry in the frozen 7+6 verb surface; no agent call inside either aggregator (D14.1).
- [ ] **Nothing edits `04_DATA_MODEL.md`** — `TicketEta` is ui-only derived; only `FleetBurn` *might* be promoted to a persisted cache (S4) and only as a separate, justified decision.

---

## 7. Citations

| Cited | Used for |
|---|---|
| [04b §9] `SpendRecord` / multi-row `WorkspaceBudget` (`tokensIn/Out` ADVISORY, `@@index([workspaceId, stageId, createdAt])` "rolling per-stage average → the D4 estimate blend", `periodWindow {rolling:'5h'}` for Claude's quota window) | the per-stage rolling-average + burn-rate source; the quota-window unit |
| [04b §7] `AgentSession.tokenEstimate` / `durationEstimate` (ADVISORY; durationEstimate parsed from the planning carry-over) | cold-start self-estimate inputs |
| [04b §12] typed `StageKind` (the ordered preset sequence; dual-`review` by order not kind) | the full-ticket projection domain + S5 |
| [04b §13] field-sweep — `PipelineStage.avgTokensPerTurn Int?`, `Workspace.pricing Json`, `Workspace.timezone` | the rolling average, advisory pricing, window tz |
| [04b §14] the `` ```ws-estimate ``/`` ```ws-carryover `` fenced-block parsing contract (Conductor-side, no envelope change) | how the self-estimate enters without a new verb |
| [04b §11a/§11b/§11c] append-only `SpendRecord`; tenant scoping; mandatory `runInTenant` | invariant honoring + the fleet roll-up's per-tenant sweep |
| [features/05] D4 blended estimate + `CostEstimate` + confidence band + raise-cap flow (the model 14 extends) | the per-ticket ETA's math, shape, banding, surface, and Resolved 1–5 |
| [features/19] Usage & Budget — advisory bar + *"hard limit is plan quota"* note; D81/D82 multi-cap + `periodWindow` | the advisory tone/note the fleet vital reuses |
| [01 §6] concurrency & cost control — advisory cost, quota is the real limit, reactive `stopped`-on-throttle | why the fleet forecast is quota-denominated and *predictive ahead of* the reactive path |
| [additions/13] quota probe (sibling reference) | supplies current quota headroom; 14 consumes it for `exhaustionAt` |
| [additions/08] vitals (sibling reference) | renders the fleet quota-exhaustion forecast as a vital |
| [V1_SCOPE §4] analytics/insight surfaces deferred | why this whole addition is HORIZON / OUT of V1 |

---

**Self-check:** No new verb introduced; no LLM in either forecast path (deterministic projections only, D14.1). Conductor stays the only writer (B-23) — forecasts are read-side derivations. `runInTenant` enforced on the fleet roll-up (per-tenant sweep, summed host-side). Cost stays advisory; the fleet forecast is quota-denominated (PTY-billing reality). `TicketEta` is ui-only derived — this doc edits neither `04_DATA_MODEL.md` nor `features/INDEX.md`. HORIZON: designed, not built in V1 ([V1_SCOPE] wins).
