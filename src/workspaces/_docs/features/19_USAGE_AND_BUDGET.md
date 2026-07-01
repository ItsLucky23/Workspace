# 19 — Usage & Budget

> The existing `Usage.tsx` screen (activity chart + by-ticket + by-person), extended with the **budget** surfaces of **B-35**: a spent/cap bar with an alert threshold, budget settings (monthly cap, alert-%, auto-pause), a cap-reached modal, the per-ticket cost chip (shared with feature `05`), and the workspace-level **Pause all agents** lever. Extends `[01 §4]` (the watchdog that auto-pauses), `[01 §6]` (budget is advisory on the subscription, the hard limit is quota), and feature `05_PER_SESSION_INFO` (the `CostEstimate` chip + raise-cap flow). Grounds the budget model in **B-35** + **DATAMODEL §8**.

---

## Scope

**In**

- The existing **Usage** content, unchanged in shape: the **7-day activity chart** (`SPEND_7D`), **By ticket** table (`USAGE_ROWS`: tokens-in / tokens-out / time), and **By person** breakdown.
- A **budget bar** — `spent / cap` with a fill, an **alert** state once `spent >= cap * alertPct/100`, and a cap-reached state at `spent >= cap` (reads `WorkspaceBudget`).
- **Budget settings** — monthly **cap**, **alert-%**, and an **auto-pause** toggle (pause agents at the cap). Gated on the workspace-settings RBAC capability (Owner/Admin per **B-28**).
- A **cap-reached modal** — when `autoPause` fires at the cap: **Raise cap** (inline editor + `+50%`, reusing feature `05`'s flow) or **Resume** (resume the paused sessions for this period).
- The **per-ticket cost chip** (D4) — surfaced on the Usage **By ticket** rows as a projected column, consistent with feature `05`'s `CostEstimate` chip.
- The workspace **Pause all agents** lever — a control-API request the Conductor executes, Admin+ per **D69**.

**Out**

- The **per-ticket / board / ticket-detail** rendering of the cost chip and the **raise-cap-and-resume** mechanics themselves → feature `05_PER_SESSION_INFO` (this doc *reuses* them; it owns the workspace-budget settings, 05 owns the per-session estimate model).
- The **estimate blend math** (planning self-estimate × rolling `SpendRecord` average, D4/D27–D31) → feature `05`.
- **Per-ticket / per-stage pause-resume RBAC** (ticket-scoped, anyone with "work on tickets") → feature `05` + the levers in `[02 §1]`; this doc owns only the **workspace-wide** "Pause all agents" (Admin+).
- The auto-pause **watchdog implementation** → `[01 §4]` (cited, not built here).

**Deferred**

- Per-member / per-sprint budget sub-caps — later (one workspace cap in v1).
- Historical budget periods / month-over-month trend view — later (current period only).
- Hard *quota* surfacing (the subscription's actual rate-limit window) — advisory cost is shown; the real quota signal arrives as a `stopped` rate-limit state handled by `[01 §4]` / `[05 P4]`, not a budget number here.

---

## User flow

1. **Usage as today.** The screen header keeps its subtitle (token volume + time on the Max subscription). The activity chart, By-ticket table, and By-person breakdown render unchanged.
2. **Budget bar.** A new card at the top (above the chart) shows the budget: `€168.40 / €200.00` with a fill bar. Tones: normal below the alert threshold, **warning** once `spent >= cap * alertPct/100`, **wrong** at/over the cap. A small note reads "Advisory — runs on the Max subscription; the hard limit is your plan quota" (`[01 §6]`).
3. **Budget settings.** A **Budget settings** affordance (a `WsButton` or gear on the budget card) opens a small form: **Monthly cap** (number, `€`), **Alert at %** (number, 1–100), and an **Auto-pause at cap** `Toggle`. Editing is gated on the workspace-settings capability (Owner/Admin, **B-28**); a Member sees the bar read-only.
4. **Alert.** When `spent` crosses the alert threshold, the bar turns amber and a `Notification` (B-34, type `ai-suggestion`/`container-failure`-adjacent budget alert) can fan out — a soft heads-up; nothing pauses yet.
5. **Cap reached → auto-pause.** When `spent >= cap` and `autoPause` is on, the **watchdog** (`[01 §4]`) flips active agents to `stopped`/paused and a **cap-reached modal** appears: the spent/cap figure, the reason, and two actions —
   - **Raise cap** → an **inline editor** for the new cap + a quick **`+50%`** button (the same control reused from feature `05`'s raise-cap-and-resume), then resumes.
   - **Resume** → resume the paused sessions for this period without changing the cap (the user accepts continuing past the advisory cap).
   Both are **control-API** requests the Conductor executes; raising the cap is gated on the pipeline/config RBAC capability (consistent with feature `05`, **D30**).
6. **Per-ticket cost chip.** The By-ticket table gains a **projected** column (a range) beside `tokensIn`/`tokensOut`/`time`, sourced from the same `CostEstimate` shape feature `05` defines (D4) — keeping one cost story across board card, ticket header, and Usage.
7. **Pause all agents.** A workspace-level **Pause all agents** button (in Usage or workspace settings) pauses every running session at once — a **control-API** request the Conductor runs serially over the active sessions (no optimistic mutation; **Admin+** per **D69**, reusing the **B-28** tiers, no matrix change). A matching **Resume all** appears while paused.

**Desktop.** Budget bar is a full-width card atop the Usage stack; settings open as a small inline form / popover; the cap-reached modal is a centered `menuHandler` dialog.

**Mobile (~99% parity, B-37).** The budget bar stacks above the chart; settings + cap-reached are bottom-sheets; **Raise cap** / **Resume** / **Pause all agents** are full-width thumb-reachable buttons. Complex budget actions can also be driven via the Assistant ("raise the budget cap to €300"), which proposes the same control-API request to accept (B-23).

**Mockup hint (budget bar + cap modal):**

```
Budget · this month                         [ ⚙ Budget settings ]
€168.40 / €200.00   ████████████████░░░░  84%   ⚠ alert ≥ 80%
Advisory — runs on the Max subscription; the hard limit is plan quota.

─ cap reached ─────────────────────────────────────────────┐
 Budget cap reached (€200).  3 agents paused.               │
 [ Raise cap  €[ 300 ]  (+50%) ]      [ Resume this period ]│
────────────────────────────────────────────────────────────┘
```

---

## Data

All additive over existing prototype types in `_data/types.ts`; nothing edits `04_DATA_MODEL.md`.

- **`WorkspaceBudget`** (existing prototype type) — `{ spent, cap, alertPct, currency }`. Maps to the `WorkspaceBudget` model (**DATAMODEL §8**): `periodCapCost?` (null = unlimited), `spentCost @default(0)`, `autoPause @default(true)`, `alertAtPct @default(80)`. The prototype `BUDGET` seed (`{ spent: 168.4, cap: 200, alertPct: 80, currency: '€' }`) drives the bar. Validation: `cap >= 0` or null; `alertPct` 1–100; `spent >= 0`.
  - **Surfaced-not-introduced fields** from `WorkspaceBudget` (DATAMODEL §8): `autoPause` (the auto-pause toggle) and `alertAtPct` (the alert-%). These already exist on the model; the prototype type currently carries `alertPct` (= `alertAtPct`) and gains `autoPause` usage in the settings form. If the prototype type needs the boolean, add `WorkspaceBudget.autoPause: boolean` to the ui-only shape only.
- **`SpendRecord`** (DATAMODEL §8, server-only) — `{ inputTokens, outputTokens, costEstimate, ticketId?, stageId?, sessionId?, at }`. The aggregate behind `spent`, the activity chart, and the By-ticket rows. Not a prototype type (the UI reads pre-aggregated `USAGE_ROWS`/`SPEND_7D`/`BUDGET`).
- **`UsageRow`** (existing) — `{ ticketId, tokensIn, tokensOut, cost, time }`. The By-ticket table; gains a derived **projected** column from feature `05`'s `CostEstimate` (ui-only, not persisted).
- **`CostEstimate`** (feature `05`, ui-only derived) — reused for the projected column + chip; defined and owned by `05`, not re-introduced here.
- **Pause-all state** — paused/active is `AgentSession.status` (`'stopped'`/`'paused'`, **DATAMODEL §5**); "Pause all agents" is a bulk control-API operation over those sessions, not a new field.

**INDEX delta:** `WorkspaceBudget.enforcement`, `WorkspaceBudget.periodWindow` (both net-new persisted, from D81/D82 — `WorkspaceBudget` becomes a multi-row collection of caps). `UsageRow`, `SpendRecord`, `CostEstimate` are surfaced-not-introduced (`CostEstimate` owned by `05`; the rest already in `_data/types.ts` / DATAMODEL §8). The ui-only `autoPause` boolean on the prototype shape is not a persisted addition (the persisted `autoPause` already exists on the DATAMODEL §8 model).

---

## Verbs / Events / Hooks

**No new verbs.** Budget enforcement is a watchdog + Conductor control-API concern; nothing here is a structured-channel verb (the frozen `[02 §2]` surface is untouched).

- **Watchdog auto-pause.** Crossing the cap with `autoPause` on is handled by the existing **watchdog** `setInterval` (`[01 §4]`, **B-35**) — the same loop that flips `stuck`/idle/turn-cap. It writes `AgentSession.status` (Conductor = only writer, `[01 §3.3]`); no verb.
- **User levers → control-API.** Raise-cap, Resume (this period), Pause all agents, Resume all, and editing budget settings are **control-API** requests the Conductor executes (`[02 §1]` — levers are control-API, never verbs). Raise-cap reuses feature `05`'s lever (D30 RBAC gate); Pause-all is **Admin+** (**D69**) and runs **serially** over active sessions (no optimistic client mutation).
- **Budget alert → notify.** The alert-threshold + cap-reached events can fan a `Notification` (B-34) through the existing `notify` `TriggerActionKind` (`[03 §1]`) / an optional `WorkspaceTrigger` (`stage.on_stuck`-style budget rule) — config, not a verb.
- **`SpendRecord` accrual.** The per-turn token accounting that feeds `spent` is reconciled on the **`Stop`** hook (`[02 §3]`, the same place feature `05` writes `SpendRecord` + `avgTokensPerTurn`) — existing hook, no change.
- **Assistant.** May *propose* a budget change ("raise the cap") via `propose_suggestion` (`[02 §2]`); Accept routes through the same control-API path (B-23). Read-only `get_ticket`/cost answers reuse feature `05`.

---

## UI

**Reused (real components):**

- `Usage.tsx` — the host screen; its `Card`, the activity chart, the By-ticket table, and the By-person breakdown stay; the budget bar + projected column are added.
- `WsButton`, `Toggle`, `IconButton`, `AvatarBubble`, `Icon` (`_components/primitives`) — settings form, auto-pause toggle, buttons.
- `menuHandler.confirm` / `menuHandler.open` (`src/_functions/menuHandler`) — the cap-reached modal + budget-settings form.
- `WorkspacesContext` — `moveTicket`/`openTicket` (already wired); the budget + pause-all state hangs off the workspace context for the prototype.
- Feature `05` surfaces — `CostEstimate` + `CostBreakdown` (the projected column / chip) and the raise-cap inline editor + `+50%` button are reused verbatim (no parallel implementation).

**New (small):**

- A **BudgetBar** card (spent/cap fill + tone by alert/cap state + the advisory note) — a small presentational component atop the Usage stack.
- A **Budget settings** form (monthly cap + alert-% + auto-pause toggle), opened inline / via `menuHandler`.
- A **cap-reached modal** body (figure + reason + Raise-cap / Resume), reusing feature `05`'s raise-cap control.
- A **Pause all agents** / **Resume all** button (workspace-wide), surfaced on Usage (and/or workspace settings), Admin+.

**Mobile parity.** Budget bar stacks; settings + cap modal are bottom-sheets; the Raise-cap / Resume / Pause-all buttons are full-width.

---

## Extends

- `[01 §4]` "Watchdog (stuck/idle, spec B-35) … the same loop checks each session's `tokenEstimate`" — the loop that fires **auto-pause at the cap** and that the Pause-all lever drives.
- `[01 §6]` "Budget (`SpendRecord`/`WorkspaceBudget`, B-35) is **advisory** on the subscription" — why the bar is advisory and the real limit is quota; the basis for the advisory note.
- `[02 §1]` "status is AI-owned/read-only … levers … control-API requests the Conductor executes, NOT verbs" — Pause-all / Raise-cap / Resume are levers, not verbs.
- `[02 §3]` the **`Stop`** hook — where per-turn `SpendRecord` accrual (feeding `spent`) is reconciled.
- **B-35** — spend/budget + runaway control: token accounting per ticket/stage/workspace, per-workspace budget + alert + **auto-pause at cap**.
- **B-28** — the RBAC tiers reused for "edit budget settings" (Owner/Admin) and **D69** "Pause all agents" (Admin+) — no matrix change.
- **B-34** — notifications (the alert / cap-reached pings).
- **DATAMODEL §8** — the `SpendRecord` + `WorkspaceBudget` models (`periodCapCost`, `spentCost`, `autoPause`, `alertAtPct`) this doc surfaces.
- **DATAMODEL §5** — `AgentSession.status` (`stopped`/`paused`) that Pause-all toggles.
- feature `05_PER_SESSION_INFO` — owns the `CostEstimate` chip, the D4 estimate blend, and the raise-cap-and-resume control reused here (the projected By-ticket column + chip).

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D81–D82)

1. **Advisory vs the "no monetary budget" Usage comment → confirmed (report-only):** framing confirmed — **advisory budget + auto-pause, with plan quota as the hard limit**. The `Usage.tsx` header comment is a **build-time code cleanup** (flag, do not auto-fix): change it to "advisory budget + auto-pause; the hard limit is plan quota" so code and docs agree.
2. **Auto-pause scope → ⚑ D81 (expanded beyond a single default):** a workspace supports **multiple budget caps**, each with its own **enforcement mode** — `pauseNew` (block newly-starting sessions, let in-flight stages finish) **or** `pauseAll` (pause all active sessions to `stopped` immediately). The cap-reached modal reports which cap + mode fired and how many agents paused. Persistence: `WorkspaceBudget` becomes **multi-row** with `enforcement: 'pauseNew' \| 'pauseAll'` (see the `## Data` INDEX delta).
3. **Budget period → ⚑ D82 (expanded — user-configurable):** the reset period is a **per-cap configurable window** (`WorkspaceBudget.periodWindow`), defaulting to **calendar month in the workspace timezone** (D55), but able to express provider-native windows (e.g. Claude's rolling 5-hour quota window). **Parked — revisit:** aligning these windows with a future **multi-provider AI abstraction** (see INDEX "Parked for later").

> **Forward-compat note (report-only):** advisory + auto-pause is the subscription billing mode; a future **metered-API backend** inverts "advisory" into a hard **pre-flight gate**, and `D82 periodWindow` needs a meter **UNIT** before it can enforce a metered cap — parked, do not pre-shape the field now (see [MULTI_PROVIDER_SEAM](../MULTI_PROVIDER_SEAM.md) Q-MP-BILLING / Q-MP-CAPREG).
