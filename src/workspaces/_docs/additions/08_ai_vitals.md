# Addition 08 — AI vitals heartbeat

> **Tier:** V1 (light) · **Lane:** C · **Status:** NEW (2026-06-11).
> **Pitch:** An always-visible global pulse in the TopBar — N agents working · M waiting on you · €X/hr burn · quota% — that expands to a full vitals panel and deep-links into the surface behind each number.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #8.

---

## 1. The gap this closes

The operator of an autonomous AI dev-team has one recurring question that no current surface answers in one glance: **"Is everything OK, or does the AI need me?"** Today that answer is scattered:

- **Agents working** lives only as per-card `busy` status pills on the Board ([12], [02 §1]) and per-PTY tabs in Terminals ([14]) — you must be *on* the board to count them, and the count of concurrently-generating turns (the real load axis, [01 §6]) is invisible.
- **Waiting on you** is split across the `needs-input` banners on individual tickets ([09], [02 §5]), the TopBar bell's unread badge ([18]), and the `done`-stage promote gates ([07], [09 §`approve == promote`]). No surface sums "how many things are blocked on a human right now".
- **Burn rate** is only on the Usage screen's budget bar ([19]) — a *cumulative* `spent / cap` figure, not an at-a-glance *rate* — and on per-ticket cost chips ([05]). You have to navigate to Usage and do mental math to know if the spend is accelerating.
- **Quota headroom** (the *real* hard limit on the Max subscription, [01 §6]) surfaces only reactively, as a `stuck` "rate limit — subscription quota" state after a session has already been throttled ([01 §6], [05 P4], [24 §runaway]).

So the operator context-switches across Board → Usage → bell → Terminals just to take the fleet's pulse — exactly the "phone-from-the-beach" friction V1 is built to remove ([README], [V1_SCOPE §0]). **Addition 08 is a single always-on heartbeat**: four numbers, derived entirely from product state the per-workspace room already syncs, that tell the operator at a glance whether to relax or to open the app — and one click deeper to the exact surface that needs them.

This is **read-only**. It introduces no verb, no write, no new persisted field. It is a *projection* of state the Conductor already owns and already fans out over the workspace room — the same pattern as [18]'s bell and [12]'s live board.

---

## 2. Locked decision (TopBar pulse + expandable panel; the 4 vitals)

**DECISION (ledger #8, locked 2026-06-11):** a **compact pulse in the TopBar, always visible**, that **expands to a full vitals panel** on click. Not a separate screen, not a nav-rail item, not a dashboard — a heartbeat that rides the chrome the operator already sees on every view.

**The four vitals (the DEFAULT — flagged for review in §5):**

| # | Vital | Compact glyph | Source (product state) | Tone driver |
|---|---|---|---|---|
| a | **Agents working** | `▮ N working` | `AgentSession`s currently *generating* (busy turns) over the workspace room ([01 §6], [02 §1]) | neutral (informational) |
| b | **Waiting on you** | `◷ M waiting` | blocking `needs-input` tickets **+** `done`-stage promote gates ([09], [07], [02 §5]) — **the same count as the #5 answer-queue badge** | `warning` when `M > 0` |
| c | **Burn rate** | `€X/hr` | rolling €/hr derived from recent `SpendRecord` rows ([19], DATAMODEL §8) — **member-visible** ([19], advisory) | `warning` near cap, `wrong` over cap (mirrors the [19] budget bar) |
| d | **Quota** | `◔ Q%` | the #13 quota probe **if present**; else the [19] advisory budget `spent/cap` as the stand-in | `warning`/`wrong` as headroom drops |

**Properties of the decision:**

- **Always-visible compact pulse.** The four vitals render as a tight glyph row in the `TopBar` (desktop) and a single condensed chip on mobile (`◷ M` is the priority glyph — "do you need me" is the operator's first question).
- **Click → expandable panel.** Clicking the pulse opens a `Popover` panel anchored under it (desktop) / a bottom-sheet (mobile) with each vital on its own row: the number, a one-line plain-language read ("3 agents generating", "2 tickets need your answer"), and a tone chip.
- **Read-only, deep-linking.** Each vital row in the panel is a link into the surface that owns it (§3.3). The pulse itself never mutates state — clicking a vital *navigates*, it does not pause/resume/promote.
- **Product state only.** Every number is derived from the **product** stream (sessions, signals, `SpendRecord`) fanned out over the **per-workspace room** — **NOT** the operator OBSERVABILITY metrics stream (§4 makes this a hard boundary).

> **FLAG (per the prompt's "DEFAULT — flag if wrong"):** the four chosen vitals and their sources are the proposed default. Two are worth an explicit operator confirm before build — see §5 sub-decisions **08.q1** (is "burn rate" member-visible, or operator-only?) and **08.q2** (quota fallback when the #13 probe is absent). Both have a stated default below; nothing is silently picked.

---

## 3. Build-ready mechanics

### 3.1 The vitals + their data sources (product state, not operator metrics — the boundary)

All four vitals are **derived (ui-only) projections** over state the workspace room already broadcasts. **No new persisted field, no new model, no `INDEX delta`.** A small ui-only shape carries them to the pulse:

```ts
interface AiVitals {                 // ui-only, derived — NOT persisted, NOT a metric
  working: number;                   // (a) AgentSessions generating a turn now
  waiting: number;                   // (b) blocking needs-input + done-stage promote gates
  burnPerHour: number;               // (c) rolling €/hr from recent SpendRecord (advisory)
  quotaPct: number | null;           // (d) #13 probe headroom %, or null → fall back to budget%
  budgetPct: number;                 // (d-fallback) spent/cap from WorkspaceBudget ([19])
  currency: string;                  // '€' — mirrors WorkspaceBudget.currency ([19])
}
```

Per-vital derivation:

- **(a) Agents working** — count of `AgentSession`s in a *generating* state. The real load axis is **concurrent active turns, not open sessions** ([01 §6]: idle/suspended PTYs are nearly free; what counts is sessions generating at once, capped by `MAX_CONCURRENT_ACTIVE`). Map to product status: tickets at `(stage, busy)` ([02 §1]) whose session is actively running, NOT `idle`/`paused`/`needs-input`/`done`. The count is already implicit in the live board fan-out ([12], merge-on-`seq`); the pulse just sums it. Optionally annotate "N working · K queued" if the FIFO depth is part of the synced snapshot ([01 §6]) — **but queue depth is borderline operator-metric** (it's `ws_queued_turns` in OBSERVABILITY §2); show it only if it is already in the *product* room snapshot, never by scraping the metrics stream (§4).
- **(b) Waiting on you** — the human-blocking count = tickets at `(stage, needs-input)` ([02 §1], [02 §5] QuestionSet blocking) **+** tickets at `(stage, done)` awaiting a promote/approve gate ([07 §promote], [09 §`approve == promote`]). This is **deliberately the same count the #5 answer-queue badge shows** — one number, one truth, so the pulse and the answer-queue never disagree. It is sourced the same way [18]'s bell sources `needs-input` notifications: a read-projection over Conductor-written product state, not a re-derivation.
- **(c) Burn rate (€/hr)** — a *rolling rate*, distinct from [19]'s *cumulative* `spent/cap` bar. Derived from recent `SpendRecord` rows (DATAMODEL §8, the per-turn token accounting reconciled on the `Stop` hook — [05 §Stop], [19 §Data]): sum `costEstimate` over a trailing window (e.g. last 60 min of `SpendRecord.at`) → €/hr. Priced **advisory** via the same per-model `PRICING` table [05] owns ([05 §Data], zeroed → tokens/hr instead of €). **Member-visible** per the default (the [19] budget bar is already member-visible read-only) — see flag **08.q1**. This is the **advisory** feed ([01 §6], OBSERVABILITY §2 labels the token metric `estimate`); it never gates anything.
- **(d) Quota %** — the *hard* limit on the Max subscription is the **plan quota**, not dollars ([01 §6]; [19] explicitly *defers* hard-quota surfacing and shows advisory cost instead). Two cases:
  - **#13 quota probe present** → show real headroom `Q%`. The live quota signal today is the reactive `stopped`/`stuck` "rate limit — subscription quota" state ([01 §6], [05 P4], [24 §runaway]); a #13 probe (if/when it lands) would turn that into a *proactive* percentage. Until then `quotaPct` is `null`.
  - **probe absent (V1 default)** → fall back to the [19] **advisory budget** `budgetPct = spent/cap` as the headroom stand-in, with the same advisory note ([01 §6]: "advisory — the hard limit is plan quota"). See flag **08.q2**.

**Why these are product state, not operator metrics:** every source above is a fact a **workspace member** is entitled to see and act on — busy tickets, their own answer queue, their workspace's advisory spend. They are read off the **product** fact stream (`AgentSession`/`Ticket.status`, the `needs-input`/`done` projection, `SpendRecord`, `WorkspaceBudget`) fanned out over the **per-workspace room** ([V1_SCOPE §3.5], B-22 subscribe→snapshot→merge-on-`seq`). They are emphatically **not** the OBSERVABILITY operator gauges (`ws_active_turns`, `ws_token_estimate_total`, `ws_lease_held` …), whose consumer is an on-call human and whose transport is `@luckystack/monitoring` (§4).

### 3.2 TopBar pulse + expand panel (cite Shell.tsx, [19], [24])

**Where it mounts.** `_shell/Shell.tsx` → `TopBar`. The TopBar already hosts the right-cluster of status affordances: the presence `AvatarStack`, the notifications `bell` + unread badge, the theme toggle, the avatar menu (Shell.tsx lines ~138–161). The vitals pulse sits in that right cluster, to the **left of the bell** (the bell is "messages for you"; the pulse is "the fleet's state") — a new sibling in the same `flex items-center gap-1.5` row. On mobile the TopBar is hidden (`hidden md:flex`, Shell.tsx line 103); the mobile pulse rides the `MobileBottomBar` / a condensed header chip instead (§3.2 mobile).

**Compact pulse (always visible).** A single horizontal glyph group, reusing the bell's button idiom (`relative inline-flex items-center ... rounded-xl hover:bg-container2`, Shell.tsx line 141):

```
TopBar right:   [presence ●●●]   [▮3 · ◷2 · €4.10/hr · ◔71%]   [🔔2] [☼] [avatar]
                                  └──────── AI vitals pulse ────────┘  click → panel
```

- **Glyphs + tones** use **only** `src/index.css` `@theme` tokens (CLAUDE.md Rule 14, no arbitrary hex):
  - **(a) working** — `text-primary` glyph + count (neutral activity; matches the board's `busy → primary` dot, Shell.tsx `statusColor`).
  - **(b) waiting** — `text-muted` at `0`; **`text-warning`** when `> 0` (matches the `needs-input/stuck → warning` mapping in Shell.tsx `statusColor` + the [19] alert tone).
  - **(c) burn** — `text-common` normal; **`text-warning`** near cap; **`text-wrong`** over cap — exactly the [19] budget-bar tone ladder (normal → warning at `spent ≥ cap·alertPct/100` → wrong at `spent ≥ cap`).
  - **(d) quota** — same warning/wrong ladder as headroom drops (e.g. warning < 25%, wrong < 10%).
- **Pulse animation** — a subtle `motion-safe` pulse on the **(a) working** glyph while `working > 0` (reuse the typing-cursor pattern already in Shell.tsx `ChatBubble`, `motion-safe:animate-pulse`), so "agents are alive" reads pre-attentively. All-zero working = static (the team is idle/done — calm).
- **i18n** — every label string (`working`, `waiting on you`, `burn`, `quota`, the panel plain-language reads) goes through `useTranslator` (CLAUDE.md Rule 13); the glyphs are icon-only, the words are translated.

**Expand panel.** Click the pulse → a `Popover` (the same `Popover` from `_components/motion` the TopBar already uses for the workspace switcher + avatar menu, Shell.tsx lines 112/148), anchored under the pulse, `rounded-xl border border-container1-border bg-container1 shadow-lg z-30` (matching the existing popovers). Closes on click-away (reuse `useClickAway`, Shell.tsx line 96). Contents — one row per vital:

```
┌ AI vitals ─────────────────────────────────┐
│ ▮  3 agents working        generating now   │  → Board (filtered busy)
│ ◷  2 waiting on you        answer / promote  │  → answer-queue (#5)        [warning]
│ €  €4.10 / hr   advisory · hard limit = quota│  → Usage (burn)            [tone]
│ ◔  71% quota   (advisory budget — no probe) │  → Usage (budget)          [tone]
└──────────────────────────────────────────────┘
```

Each row: glyph + value + a short translated read + a tone chip; the whole row is a deep-link button (§3.3). The "advisory · hard limit = quota" note on (c)/(d) reuses [19]'s exact advisory string ([01 §6]). The panel is **pure render of `AiVitals`** — no controls, no pause/resume/promote (those levers live in [24]/[19]/[09], reachable by the deep-link, never duplicated here — CLAUDE.md Rule 27, no parallel implementation).

**Mobile (~99% parity, B-37).** TopBar is desktop-only; on mobile surface a **condensed pulse chip** in the mobile header strip (priority glyph = `◷ M waiting`, tinted `warning` when `> 0`, the operator's first question). Tap → the same vitals as a **bottom-sheet** (`menuHandler` sheet, the idiom [19]/[24] use for mobile). Deep-links navigate the same way.

**Reused real components (no new chrome):** `Popover` + `SPRING_SOFT` (`_components/motion`), `IconButton`/`useClickAway` (`_components/primitives`), `Icon` (`_components/Icon`), `menuHandler` (mobile sheet), `WorkspacesContext` navigation (`navigate`, `openTicket`). **New (small, scoped):** one `AiVitalsPulse` presentational component (the glyph row + the popover/sheet body) — a pure render of the derived `AiVitals`, mounted once in `TopBar` and once in the mobile header.

### 3.3 Deep-links per vital

Every vital is read-only; clicking it **navigates** to the surface that owns the underlying state (CLAUDE.md Rule 12 — reuse the existing surface, never reimplement its actions in the panel):

| Vital | Deep-link target | Mechanism |
|---|---|---|
| **(a) working** | **Board, filtered to busy** | `navigate('board')` + apply the existing `BoardFilter` (ui-only, owner [12]) to `status: busy` — reuses [12]'s filter machinery, adds no new filter type. |
| **(b) waiting** | **Answer-queue (#5)** | the same target the #5 answer-queue badge links to (the `needs-input`/promote queue) — one destination for one count. If #5's surface is the [18] notification center filtered to `needs-input` + the [09] question cards, deep-link there via the [18] D65 deep-link convention. |
| **(c) burn** | **Usage → budget bar** | `navigate('usage')` ([19]); the burn rate's cumulative context (the `spent/cap` bar, By-ticket, By-person) lives there. |
| **(d) quota** | **Usage → budget bar** (probe absent) / a quota detail (probe present) | `navigate('usage')`; when the #13 probe lands, link to its detail instead. |

Navigation reuses `WorkspacesContext` (`navigate` / `openTicket`, already wired in Shell.tsx) and the [18] **D65 deep-link** convention; no new routing. The pulse never opens a write-capable control — it hands off to the surface that owns the lever.

---

## 4. Invariants honored (esp. the product-vs-operator stream boundary)

- **PRODUCT-vs-operator stream boundary (the load-bearing one, OBSERVABILITY §5.1/§6).** This is a **PRODUCT** surface for a **workspace member**, sourced from the **product** fact stream over the **per-workspace room** (`AgentSession`/`Ticket.status`, the `needs-input`/`done` projection, `SpendRecord`, `WorkspaceBudget`). It **must NOT** read the OBSERVABILITY **operator** stream — the Prometheus gauges/counters (`ws_active_turns`, `ws_queued_turns`, `ws_token_estimate_total`, `ws_lease_held`, …), whose consumer is an on-call human and whose transport is `@luckystack/monitoring` (OBSERVABILITY §2/§5). The two streams are **deliberately separate, cross-linked only by `seq`, never merged** (OBSERVABILITY §5.1/§6.1–2). Concretely: the pulse subscribes to the **same workspace-room product sync** the board/bell already use — it does **not** scrape `/metrics`, does **not** import the monitoring adapter, and routes nothing through (or out of) `TicketEvent`. The numbers happen to resemble operator metrics (active turns, spend); the **source and consumer are different**, and that difference is the rule.
- **B-23 Conductor-only-writer.** Read-only surface — zero writes. The pulse and panel never mutate `Ticket.status`/`AgentSession`; they render Conductor-written state and *navigate* to where the levers ([24] pause/resume/kill, [09] approve/promote, [19] raise-cap) already are. No client-side authoritative mutation (B-30).
- **FROZEN verbs / no new persistence.** No structured-channel verb (the [02 §2] 7+6 surface is untouched), no `WorkspaceTrigger`, no new model/field. `AiVitals` is ui-only/derived; **`INDEX delta:` (none)**. Same posture as OBSERVABILITY ("no new verbs, read-side over existing truth") and [24]/[18] ("no new persisted models").
- **`runInTenant` / per-workspace scope.** The vitals are scoped to the **active workspace** only — they read the active workspace's room snapshot, exactly as the board/bell do; every orchestrator-side path feeding the room runs under `runInTenant` ([V1_SCOPE §3.5], [04b §11c]). Switching workspaces (Shell.tsx `setActiveWorkspace`) re-points the pulse to the new room. No cross-workspace aggregation.
- **PTY-billing / advisory cost.** Burn (€/hr) and the budget-fallback quota are **advisory** on the Max subscription ([01 §6], B-35): priced via [05]'s editable `PRICING`, never a hard gate, never authoritative spend (OBSERVABILITY §2 `estimate` label). The **hard** limit is the plan **quota** ([01 §6]); the panel's advisory note states this verbatim ([19]).
- **V1_SCOPE wins.** This is a **light** read-projection over surfaces already IN V1 (Board [12], Usage/budget [19], notifications [18], questions [09], pause/kill [24], per-session cost [05]) — it reinstates no deferred surface (no preview, no analytics, no operator dashboard). Pure Lane-C frontend over the realtime product sync that is fully in V1 ([V1_SCOPE §2 "Real-time sync"]).
- **LuckyStack conventions.** i18n via `useTranslator` (Rule 13); Tailwind tones **only** from the `@theme` tokens — `primary`/`warning`/`wrong`/`common`/`muted`/`container1`/`divider` (Rule 14); reuse `_components` primitives + `Popover`/`menuHandler`, add one small `AiVitalsPulse` component (Rule 12/27, surgical, no parallel implementation of existing levers).

---

## 5. Open sub-decisions (DEFAULTs)

> Per CLAUDE.md Rule 3a/3b — multiple valid readings exist; each is stated with a default and proceeds, rather than being silently picked. Promote these to ledger sub-rows on the next [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) sweep.

- **08.q1 — Is burn rate (€/hr) member-visible or operator-only?** **DEFAULT: member-visible** — the [19] budget bar is already member-visible read-only and the prompt's locked default says "member-visible". *Tradeoff:* some operators may treat spend as Owner/Admin-only. If so, gate vital (c) behind the same workspace-settings RBAC capability [19] uses for budget *editing* (Owner/Admin, B-28) and show members the other three vitals only. **Proceeding member-visible; flag for operator confirm.**
- **08.q2 — Quota fallback when the #13 probe is absent (V1 reality).** **DEFAULT: show the [19] advisory budget `spent/cap` as the quota stand-in**, labeled "advisory budget — no live quota probe", with the [01 §6] hard-limit note. *Alternative:* show `quota: —` (no number) until a real #13 probe exists, to avoid implying budget% == quota%. **Proceeding with the advisory-budget stand-in (a number beats a dash for an at-a-glance pulse); flag for confirm.** When #13 lands, swap `quotaPct` to the real headroom with no UI change (the shape already carries `quotaPct: number | null`).
- **08.q3 — Include "queued turns" in vital (a)?** **DEFAULT: only if FIFO depth is already in the product-room snapshot.** Queue depth is `ws_queued_turns` in OBSERVABILITY §2 (an *operator* gauge); surfacing it here is only legal if the same number is independently present in the product sync (e.g. tickets shown `idle`+"queued", [01 §6]). **Proceeding: show "· K queued" only when the product snapshot carries it; never scrape the metrics stream** (the §4 boundary). Default off if ambiguous.
- **08.q4 — Refresh cadence.** **DEFAULT: live, off the existing workspace-room fan-out** (merge-on-`seq`, B-22) — no polling, no new subscription; the pulse recomputes `AiVitals` from the same snapshot the board/bell already receive. Burn (€/hr) is a trailing-window derivation, so it updates as new `SpendRecord` rows arrive on the `Stop` hook ([05]); a ~30–60s recompute of the rolling window is sufficient (no need for per-token ticks).

---

## 6. Build checklist (per-lane + verification)

**Lane C (frontend) — build:**

- [ ] `AiVitalsPulse` presentational component (`_shell/` or `_components/`): the compact glyph row + the expand `Popover` body, a pure render of a derived `AiVitals` — **no writes, no levers**.
- [ ] Derive `AiVitals` from the active workspace's room snapshot (sessions/status, `needs-input`+`done` projection, `SpendRecord` trailing window, `WorkspaceBudget`) — reuse the board/bell sync, add **no** new subscription and **no** `/metrics` read.
- [ ] Mount in `TopBar` (left of the bell, Shell.tsx right cluster) + a condensed mobile header chip → `menuHandler` bottom-sheet.
- [ ] Tones from `@theme` tokens only (`primary`/`warning`/`wrong`/`common`/`muted`); `motion-safe` pulse on (a) while `working > 0`.
- [ ] All labels via `useTranslator`; glyphs icon-only.
- [ ] Deep-links per §3.3 via `WorkspacesContext.navigate`/`openTicket` + [12] `BoardFilter` (busy) + [18] D65 — reusing existing surfaces, no new routes.

**Verification (turn the build into checkable goals — Rule 1a):**

- [ ] **Counts match their owners.** (b) "waiting on you" equals the **#5 answer-queue badge** count exactly (seed a `needs-input` + a `done`-stage ticket → both show the same M); (a) "working" equals the count of `busy`-generating tickets on the Board (filtered-busy deep-link lands on exactly those cards).
- [ ] **Read-only proven.** No interaction on the pulse/panel mutates `Ticket.status`/`AgentSession` (the only effect of any click is navigation); the panel exposes no pause/resume/promote control.
- [ ] **Boundary proven.** The component imports nothing from the monitoring adapter and issues no `/metrics` fetch; grep the diff for `ws_active_turns`/`ws_token_estimate`/`/metrics`/`monitoring` → zero hits in Lane-C files (the §4 product-vs-operator rule, mechanically checked).
- [ ] **Tenant scope.** Switching the active workspace (Shell.tsx `setActiveWorkspace`) re-points all four vitals to the new room; no cross-workspace leakage.
- [ ] **Tones + advisory.** Burn/quota tones cross to `warning`/`wrong` at the same thresholds as the [19] budget bar; the advisory "hard limit = quota" note ([01 §6]) renders on (c)/(d).
- [ ] **i18n + tokens.** No hardcoded user-facing string outside `useTranslator`; no arbitrary hex (only `@theme` tokens). `npm run lint && npm run build` clean (Rule 11).

**No Lane A/B/D work** — this is read-only over data those lanes already publish (the board/budget/notification product sync). If (a)'s "generating now" sub-state or the `SpendRecord` trailing-window aggregate is **not** already in the room snapshot, that is a **Lane-B sync-projection delta** (add the derived field to the snapshot, still no new *persistence*) — flag it to Lane B rather than computing it client-side from raw rows.

---

## 7. Citations

- **[features/19_USAGE_AND_BUDGET.md]** — burn/spend model, member-visible advisory cost, the `spent/cap` budget bar + alert/cap tone ladder (normal → warning at `spent ≥ cap·alertPct/100` → wrong at `spent ≥ cap`), `WorkspaceBudget`/`SpendRecord` (DATAMODEL §8), the "advisory — hard limit = plan quota" note, and the explicit **deferral of hard-quota surfacing** (§Deferred).
- **[features/24_PAUSE_AND_KILL_CONTROLS.md]** — the active/running vs `paused`/`stuck` lifecycle states (a), the runaway→`stuck`→`needs-input` escalation feeding (b), every lever as a control-API request the Conductor executes (the deep-link targets, never duplicated in the panel).
- **[02_PROTOCOL_AND_FLOW.md §1/§5]** — the `idle|needs-input|busy|done|paused|stuck` status machine (the source of "working" and "waiting"); `busy→done` does not auto-advance → the **promote gate** is a human lever counted in (b); `approve == promote` ([09]).
- **[01_ARCHITECTURE.md §6]** — concurrency/active-turn counts ("the real limit is concurrent active turns, not open sessions", `MAX_CONCURRENT_ACTIVE`, Redis FIFO queue) for (a); the **plan quota is the hard limit, cost is advisory** for (c)/(d); rate-limit → `stopped`/`stuck` as the live quota signal for (d).
- **[OBSERVABILITY.md §2/§5.1/§6]** — **cited ONLY for the product-vs-operator boundary** (§4): operator metrics/logs/liveness ship to `@luckystack/monitoring` for an on-call human and are a **different stream** from the product `TicketEvent`/room sync for a workspace member; the two are separate, cross-linked by `seq`, never merged. **No operator metric is reused here.**
- **[features/05_PER_SESSION_INFO.md]** — the per-session cost chip + the editable `PRICING` table (advisory €, zeroed → tokens) reused to price (c); the `Stop`-hook `SpendRecord` accrual feeding the burn window; the advisory-not-gate contract.
- **[_shell/Shell.tsx]** — `TopBar` right cluster (presence/bell/theme/avatar), `Popover` + `useClickAway` + `IconButton` idioms, `motion-safe:animate-pulse`, `WorkspacesContext` `navigate`/`setActiveWorkspace`, `statusColor` tone mapping — the mount point and reused primitives.
- **[V1_SCOPE.md §2/§3.5]** — real-time multi-user product sync (per-workspace room, subscribe→snapshot→merge-on-`seq`, B-22) is fully IN V1; this addition is a light Lane-C read-projection over it; V1_SCOPE wins on conflict.
- **[features/18_NOTIFICATIONS.md]** — the TopBar bell/unread-badge sibling pattern and the **D65 deep-link** convention reused for (b)'s answer-queue link.
- **[features/09_QUESTIONS_IN_TICKETS.md] / [features/07_CODE_CHANGES_REVIEW.md]** — `needs-input` QuestionSet cards + the `done`-stage promote/approve gate that together make up the (b) "waiting on you" count.
- **[features/12_BOARD_AND_KANBAN.md]** — the live `busy` board fan-out (a) and the `BoardFilter` reused for the filtered-busy deep-link.
