# PRODUCT ANALYTICS — cycle-time, throughput, stuck-points, cost-per-type & agent-quality, derived from the event log

> The **product-insight** layer for a workspace: the metrics a *team lead / workspace member* reads to answer "how fast do tickets move, where do they get stuck, what does a feature-ticket cost, and is the AI getting better or worse?". This is **NOT** the operator stream — [OBSERVABILITY] is logs/metrics/liveness/alerts for an *on-call human* watching the orchestrator. This doc is the *user-facing* read-side: every metric is **DERIVED from the append-only `TicketEvent` log** ([04b §6]) plus the `SpendRecord` cost facts ([04b §9]) the Conductor already writes — **no new write path, no new persisted model, no new verb**. Where [OBSERVABILITY] asks "is the machine up?", this doc asks "is the *work* flowing well?". Prereq: [01](./01_ARCHITECTURE.md), [02](./02_PROTOCOL_AND_FLOW.md), [04b](./04b_DATA_MODEL_ADDENDA.md), [OBSERVABILITY](./OBSERVABILITY.md), feature [19](./features/19_USAGE_AND_BUDGET.md)/[20](./features/20_ACTIVITY_AND_EVENT_LOG.md)/[05](./features/05_PER_SESSION_INFO.md). Cites [FORGE_ABSTRACTION] for the MR/CI event sources that now also land as `TicketEvent`s. Carries `Q-ANALYTICS-*`. Last updated: 2026-06-04.
>
> **No new verbs.** Nothing here touches the frozen 7+6 structured-channel surface ([02 §2], all `read|propose`, none write). Product analytics is a **pure projection** of facts the Conductor already owns: `TicketEvent` ([04b §6], the only writer is the Conductor, B-23), `SpendRecord` ([04b §9]), and the `AgentSession`/`MergeRequest`/CI events those reconcile into the log. There is **no analytics write surface** — the dashboard is a read-only `_api` aggregation over the existing append-only log. Any "metric" below is a `fold` over events; it never writes a row, never adds a column, never enqueues a Conductor action.

---

## 0. Scope & the product/operator boundary (the one hard rule)

**The boundary, stated once and binding (mirrors [OBSERVABILITY §6]):**

```
┌─ PRODUCT ANALYTICS (this doc) ────────────┐   ┌─ OPERATOR OBSERVABILITY ([OBSERVABILITY]) ┐
│ cycle-time, throughput, stuck-points,     │   │ active/queued turns, lease state,         │
│ cost-per-ticket-type, agent-quality trend │   │ container-boot failures, loop liveness,   │
│ DERIVED from TicketEvent + SpendRecord    │   │ RAG/reconcile lag, split-brain alerts     │
│ store: the append-only TicketEvent log    │   │ store: @luckystack/monitoring (separate)  │
│ consumer: a workspace MEMBER / team lead  │   │ consumer: an on-call HUMAN                 │
│ question: "is the WORK flowing well?"     │   │ question: "is the MACHINE up?"            │
└───────────────────────────────────────────┘   └───────────────────────────────────────────┘
         ▲                                                       ▲
         └── both read facts the Conductor owns; NEVER merged. ──┘
         product folds TicketEvent/SpendRecord; operator ships logs/metrics to monitoring.
```

Five product-insight surfaces, all derived, all single-workspace-scoped, all rendered in-app:

1. **Cycle-time** — per-ticket and per-stage wall-clock durations, from `status-change`/stage-transition events (§2).
2. **Throughput** — tickets (and stages, and merges) completed per unit time, per pipeline/preset (§3).
3. **Where tickets get stuck** — `needs-input` dwell time, rejection rate per stage, the stage-level flow-efficiency view (§4).
4. **Cost per ticket-TYPE / preset** — `SpendRecord` folded by ticket label/type and by preset, not just per-ticket (§5; complements feature [19]'s per-ticket Usage).
5. **Agent quality trend** — rejection/rework rate over time, the `AI_QUALITY` signal (§6) — ties review-gate verdicts to a moving quality score.

**The standing rule (binding for every lane that adds a product metric):**
- **One source, two consumers, never merged.** Product analytics reads `TicketEvent`+`SpendRecord`; operator observability ships logs/metrics to `@luckystack/monitoring`. A product metric is NEVER routed through the operator pipeline, and an operator metric (lease state, boot failures) NEVER appears on a product dashboard. The only cross-link is the same `seq` ([04b §6]) [OBSERVABILITY §5.1] already names — an investigator can correlate, the dashboards do not blend.
- **Derived, not persisted.** No `Metric`/`Analytics` model. Every figure is a fold over the append-only log, computed in a read-only `_api` aggregation. Caching a rollup (§8) is an optimization detail, never a new source of truth.
- **No new verbs, no new write path** (§7).

> **Explicitly out of scope:** anything that *enforces* (budget caps are feature [19]'s `WorkspaceBudget` policy, not an analytics output); operator health (RAG lag, lease, container-boot — [OBSERVABILITY]); cross-workspace benchmarking ("your refine stage is slower than the median workspace" — deferred, `Q-ANALYTICS-XWS`, one workspace at a time in v1, consistent with feature [20] "Out: cross-workspace activity").

---

## 1. The event vocabulary analytics folds over (no new events)

Every metric is a `reduce` over the existing `TicketEvent` types ([04b §6]) and `SpendRecord` rows ([04b §9]). This section pins **which existing events carry which timing/verdict signal** — analytics adds *zero* event types; it reads provenance already in the log.

| Signal needed | Sourced from (existing) | Field on the row |
|---|---|---|
| stage enter / exit timestamps | `status-change` `TicketEvent` (`type:'status-change'`) | `createdAt` + `metadata.{from,to}` stage/status; `stageId` ([04b §6]) |
| `needs-input` open / close | `status-change` to/from `needs-input` (the TICKET state, [04b §7] mapping) + the `QuestionSet` open/answer events ([02 §5]) | `createdAt`, `metadata.questionSetId` |
| review verdict (approve / **reject**) | the `approve` `QuestionSet` answer ([02 §5], feature [07] gate); **Reject flips `done → busy`** (feature [07] 07.q3) → a `status-change` event | `metadata.verdict:'approve'\|'reject'`, `metadata.rejectNote?` |
| rework loops (a stage re-opened) | the `done → busy` `status-change` the reject produces (feature [07]) — each re-open is one rework loop on that stage | count of `done→busy` per `(ticketId, stageId)` |
| stuck (runaway verdict) | the watchdog's `stuck` escalation → forced `needs-input` ([04b §7], `Q-ENG-CARRYOVER-ENFORCE`) — a `status-change`/`ai-message` event with the reason | `metadata.reason` |
| merge (ticket completion in forge terms) | `mr` `TicketEvent` (`type:'mr'`, merged) — GitLab/GitHub webhook OR built-in git hook, normalized identically ([FORGE_ABSTRACTION §7.2]) | `metadata.mrUrl`, `metadata.state:'merged'` |
| CI pass/fail (when built-in CI is on) | the CI-status `TicketEvent` ([FORGE_ABSTRACTION §8], `type:'ci'`) | `metadata.{jobName,status}` |
| cost per turn | `SpendRecord` ([04b §9]) | `tokensIn/tokensOut/costEstimate`, `ticketId`, `stageId` |
| ticket TYPE / preset (the grouping keys) | `Ticket.labels[]`/`type` (GitLab-derived cache, [04b §13]) + `Workspace.presetKey` ([04b §13]) | joined at aggregation time, not stored on events |

- **`seq`-ordered replay is the timing engine.** Because `TicketEvent` is per-ticket monotonic on `seq` ([04b §6], B-21), a cycle-time/dwell computation is a deterministic single-pass replay: walk a ticket's events in `seq` order, pair each `enter(stage)` with the next `exit(stage)`, accumulate dwell per `needs-input` open/close pair. The rewind scrubber (feature [20], D64) already proves the log is replayable; analytics reuses that exact ordered-read.
- **Gaps are tolerated, reordering is not** ([04b §6]): a burned `seq` (crashed writer) leaves a hole but never reorders; the pairing logic skips unmatched opens (an `enter` with no `exit` = a still-open interval, measured as "now − enter").
- **No clock-skew dependency for ordering** — pairing is by `seq`; `createdAt` is read only to compute *durations within a single ticket's timeline* (same-ticket events are written by the single Conductor, so their `createdAt` is monotonic enough for a duration; cross-ticket comparisons use the same-writer clock).

**Checklist — §1 is correct when:**
- [ ] Every metric names an EXISTING `TicketEvent` type or `SpendRecord` field as its source — no new event type, no new column.
- [ ] Stage/dwell timing is a `seq`-ordered replay (reuses feature [20]'s ordered-read), never a `createdAt` sort across tickets.
- [ ] Reject/rework is read from the feature-[07] `done→busy` re-open, not a new "rework" event.
- [ ] Merge + CI signals are read from the **normalized** forge events ([FORGE_ABSTRACTION §3]) — forge-blind (GitLab/GitHub/built-in identical).

---

## 2. Cycle-time — per ticket and per stage

**Definition.** *Cycle-time* = wall-clock from a ticket's **first work-start** to its **completion**, decomposed into per-stage dwell. Computed by `seq`-replay (§1).

| Metric | Definition (the fold) | Why it's the product question |
|---|---|---|
| `ticket_cycle_time` | `completion_event.createdAt − first_work_start.createdAt` per ticket | the headline "how long does a ticket take end-to-end". *Completion* = the merge `mr` event (forge modes) or the `final`-stage `done` (built-in / no-merge) — `Q-ANALYTICS-DONE-DEF` picks the anchor. |
| `stage_dwell_time` | per `(ticketId, stageId)`: `Σ (exit − enter)` across all visits (a re-opened stage is visited >1×) | which STAGE eats the calendar; the dual-review stages (feature [07]) and `needs-input`-prone stages surface here. |
| `lead_time` | `completion − ticket_created` (includes backlog wait before work started) | the *customer-perceived* time (created → shipped), vs cycle-time (work-started → shipped). Both shown; lead-time is the honest one for a team lead. |
| `active_vs_wait` split | per stage: `busy` dwell vs `needs-input`/`paused` dwell | flow-efficiency = `active / (active + wait)`; a low ratio means the AI is fast but blocked on humans (the #1 5-person-team insight). |

- **Stage dwell sums re-visits.** Because a reject re-opens a stage (`done → busy`, feature [07] 07.q3), a stage can be entered N times. `stage_dwell_time` is the SUM over visits (the true calendar cost), while §6 separately counts the *number* of re-opens as the rework signal. Both come from the same `done→busy` events; one sums duration, one counts loops.
- **Percentiles, not just means.** Report **p50 / p85 / p95** per stage and per ticket-type, not averages — a single 3-day-stuck ticket skews a mean and hides the typical experience. The dashboard (§7) defaults to **p85** as the "what most tickets feel like" line, with mean available behind a toggle (`Q-ANALYTICS-PERCENTILE`).
- **Open intervals are "in progress".** A ticket still in flight contributes a partial (now − start) interval, clearly labelled "in progress" so the live board's WIP shows current dwell, not a zero.

---

## 3. Throughput — completions per unit time, per pipeline / preset

**Definition.** *Throughput* = count of completions per time bucket, grouped by the pipeline/preset that produced them.

| Metric | Definition | Grouping |
|---|---|---|
| `tickets_completed` | count of completion events ([§2] anchor) per day/week | by `Workspace.presetKey` ([04b §13]); by pipeline (a workspace may run multiple Projects/Pipelines) |
| `stages_completed` | count of stage `done` events per bucket | by `StageKind` ([04b §12]) — shows which stage-roles are the throughput floor |
| `merges_per_week` | count of merged `mr` events ([FORGE_ABSTRACTION §7.2]) per bucket | by pipeline; the forge-level "shipped" rate |
| `wip` (work-in-progress) | tickets currently in a non-terminal state (live board count, derived from latest `status-change` per ticket) | by stage column — Little's-Law context for cycle-time |
| `ci_pass_rate` | (built-in/forge CI on) merged-after-green vs total CI runs ([FORGE_ABSTRACTION §8]) per bucket | by pipeline |

- **Throughput is grouped by preset/pipeline because that's the lever.** A team lead tunes the **preset** (3/5/7-stage, feature [02_PIPELINE_PRESETS]) and the per-stage model tier; throughput-by-preset is how they see whether the `professional` 7-stage preset is worth its extra cycle-time vs `advanced`. This is the read-side counterpart to feature [05]'s `PipelineStage.avgTokensPerTurn` tuning.
- **Little's Law as a sanity tie** — `avg cycle-time ≈ WIP / throughput`. The dashboard surfaces all three so an inconsistency (WIP climbing while throughput flat) flags a building backlog before it's felt.
- **Bucketing in the workspace timezone** (`Workspace.timezone`, [04b §13], D55) — "this week" must mean the team's week, consistent with feature [19]'s budget `periodWindow` and the cron tick.

---

## 4. Where tickets get STUCK — dwell, rejection rate, flow efficiency

This is the highest-value product view for a small team: not "how fast" but "**where does work pile up**". All three signals are folds over the same events §1 names.

| Metric | Definition (the fold) | Surfaces the problem |
|---|---|---|
| `needs_input_dwell` | per stage: `Σ` time a ticket sat in `needs-input` (open `QuestionSet` → answered, [02 §5]) | the agent is **blocked on a human** — the dominant wait in a 5-person team; high dwell on a stage = that stage asks too many questions OR the team is slow to answer. |
| `rejection_rate` | per stage: `reject_verdicts / total_review_verdicts` (the `approve` gate, feature [07]) | the agent's output at that stage is **frequently wrong** — a quality problem localized to a stage/role (ties to §6 `AI_QUALITY`). |
| `rework_loops` | per `(ticketId, stageId)`: count of `done→busy` re-opens (feature [07] 07.q3) | how many round-trips a stage needs before it sticks — the *count* companion to §2's dwell *sum*. |
| `stuck_rate` | per stage: fraction of visits that hit a watchdog `stuck` escalation ([04b §7], `Q-ENG-CARRYOVER-ENFORCE`) | the agent **ran away / looped** — distinct from a human-answerable `needs-input`; a systemic-prompt-discipline signal. |
| `flow_efficiency` | workspace + per-stage: `active_dwell / (active + wait)` (from §2 split) | the single number a lead watches: low = lots of waiting (humans or stuck), not lots of working. |
| `aging_wip` | tickets whose current-state dwell exceeds a p85 threshold for their stage | the "these are stuck RIGHT NOW" actionable list (deep-links to each ticket via D65). |

- **`needs-input` is a TICKET state, not a session state** ([04b §7]) — dwell is measured from the `status-change`/`QuestionSet`-open to its answer, exactly the pair feature [20]'s rewind already walks. A still-open `needs-input` contributes a live "blocked for X" interval (feeds `aging_wip`).
- **Rejection vs stuck are different failures.** A *reject* is a human verdict at the approve gate (output reviewed, judged wrong → re-open with the note as the `--resume` prompt, feature [07]). A *stuck* is the watchdog's runaway verdict (the agent never reached a clean stop). The dashboard separates them: rejection → "fix the prompt/role"; stuck → "fix the turn-cap/discipline" (different operator actions, same event log).
- **The stuck-points view is the killer product page** — it turns the append-only log into a Pareto: "80% of your wait is `needs-input` on the `review` stage" is the sentence that makes a team change its preset or its review SLA. It needs **no new data** — only this fold.

---

## 5. Cost per ticket-TYPE / preset (beyond feature [19]'s per-ticket Usage)

Feature [19] (Usage & Budget) owns the **per-ticket / per-person** cost table and the **budget enforcement** (`WorkspaceBudget` caps, [04b §9]). This doc adds the **per-TYPE / per-preset** product roll-up — the analytical question "what does a *bug-fix* cost vs a *feature*, and is the `professional` preset worth its cost?" — which feature [19] does not answer.

| Metric | Definition (the fold over `SpendRecord`) | Grouping key |
|---|---|---|
| `cost_per_ticket_type` | `Σ SpendRecord.costEstimate` grouped by `Ticket.labels[]`/type ([04b §13]) ÷ ticket count of that type | ticket TYPE (bug / feature / chore — from GitLab labels) |
| `cost_per_preset` | `Σ costEstimate` per `Workspace.presetKey` ÷ tickets of that preset | preset (3/5/7-stage) — the ROI of pipeline depth |
| `cost_per_stage_role` | `Σ costEstimate` grouped by `StageKind` ([04b §12]) | which stage-role is the cost center (e.g. `code` vs `review`) |
| `cost_per_merge` | `cost_per_ticket_type` numerator ÷ merged count | the "fully-loaded cost to ship one" figure |
| `cost_trend` | `cost_per_ticket_type` over time buckets | is a type getting cheaper (better presets/models) or pricier (scope creep)? |

- **Advisory, exactly as feature [05]/[19].** Cost is the editable per-model `Workspace.pricing` map ([04b §13], D31) × token estimate; it is **advisory on the Max subscription** ([01 §6]), never a billing meter. Zeroing the pricing map renders these in **tokens only** — same contract as feature [05]'s chip. The dashboard carries the same "Advisory — runs on the subscription; the hard limit is plan quota" note feature [19] shows.
- **This complements, never duplicates, feature [19].** Feature [19] = enforcement + per-ticket/per-person table + budget caps. This doc = the *analytical* per-type/per-preset/per-role roll-up + trend. They read the same `SpendRecord`; they answer different questions (policy vs insight). The `CostEstimate` shape (feature [05]) is reused for the projected/range display where a type is mid-flight.
- **Token-feed honesty** ([04b §9], `Q-ENG-TOKENFEED`): `SpendRecord.tokensIn/Out` is the hook payload if present else a char-count estimate — so every cost figure carries the `estimate` framing; the dashboard never implies precision the PTY mode can't give.

---

## 6. Agent quality trend — the `AI_QUALITY` signal (rejection / rework rate over time)

The product question a team lead actually loses sleep over: "**is the AI getting better or worse at our codebase?**". `AI_QUALITY` is a derived, time-windowed score folded from the review-gate verdicts and rework loops — **no new judge, no new write**, just a moving aggregate of the human verdicts the team already gives at the approve gate (feature [07]).

**The `AI_QUALITY` composite (a fold, not a model):**

| Component | Definition | Direction |
|---|---|---|
| `acceptance_rate` | `approve_verdicts / total_verdicts` over a window, per stage-role | higher = better; the primary quality signal |
| `rework_rate` | `rework_loops` (§4) ÷ stages-attempted over a window | lower = better; how many re-opens per stage on average |
| `stuck_rate` | §4's runaway fraction over a window | lower = better; discipline/looping health |
| `post_merge_reopen` (opt) | a merged ticket whose stage is re-opened *after* merge (rare; a regression signal) | lower = better; `Q-ANALYTICS-POSTMERGE` (needs the ticket to re-enter a stage post-merge — a forge `mr` reopened event) |
| `time_to_accept` | median turns/wall-clock from stage-start to first `approve` | lower = better; how directly the agent lands the output |

- **`AI_QUALITY` is a TREND, scoped by (preset, StageKind, model).** The headline is a sparkline per stage-role: "your `review` stage's acceptance-rate went 62% → 81% over the last 30 tickets". Scoped by **model** so a model swap (haiku→sonnet on a stage, feature [02_PIPELINE_PRESETS]) shows its quality delta — the analytic that justifies a per-stage model-tier change. Scoping mirrors feature [05]'s `(preset, stage, model)` confidence keys exactly (same join, different fold).
- **Sourced from HUMAN verdicts, not an AI judge.** The approve/reject at the gate (feature [07], a `QuestionSet` answer by a person) is ground truth. `AI_QUALITY` never adds an LLM "grader" (that would be a new spawn + a new cost + a circular quality story) — it aggregates the verdicts the team already produces. If a future automated grader is wanted it's a separate, parked decision (`Q-ANALYTICS-AUTOGRADE`, recommended OUT of v1).
- **Ties to [OBSERVABILITY]'s operator signal without merging.** [OBSERVABILITY §2] has `ws_carryover_enforce_retries_total` + `ws_watchdog_fires_total` as *operator* counters (is the engine wedging?). `AI_QUALITY` reads the *product* consequence of the same underlying events (did the WORK get rejected/reworked?). Same root events ([04b §7] `stuck`), two consumers: the operator alert pages an on-call human; the quality trend informs a team lead's prompt/preset tuning. **Cross-linked by `seq`, never blended** (§0).
- **Quality vs cost vs speed is the real tradeoff triangle** — the dashboard (§7) puts `AI_QUALITY` next to `cost_per_preset` (§5) and `cycle_time` (§2) so a lead sees the whole tradeoff of a preset/model choice in one place. That triangulation is the product's analytical payoff.

**Checklist — §6 is correct when:**
- [ ] `AI_QUALITY` is a fold over EXISTING approve/reject/rework/stuck events — no new judge, no new write, no new verb.
- [ ] It is scoped by `(preset, StageKind, model)` (same key as feature [05]), shown as a trend (sparkline), not a single number.
- [ ] Ground truth is the HUMAN gate verdict (feature [07]); an automated grader is parked (`Q-ANALYTICS-AUTOGRADE`).
- [ ] It cross-links to [OBSERVABILITY]'s `watchdog`/`carryover` counters by `seq` but is never merged into the operator stream.

---

## 7. The dashboard spec — a read-only `_api` projection (no write surface)

**Overview.** Product analytics renders as an **Insights** screen in the web app (sibling to feature [19] Usage and feature [20] Activity), populated by a **read-only `_api` aggregation** over `TicketEvent`+`SpendRecord`. It is a pure projection: subscribe-first to the live `workspace-<wsId>` room for incremental updates (the same B-22 path feature [20] uses), snapshot via `_api`, merge-on-`seq`. **No control-API, no Conductor action, no verb** — analytics never writes.

### 7.1 Screen layout (the four panels + the quality strip)

```
┌ Insights · this sprint ▾        [ preset: all ▾ ] [ type: all ▾ ]   ● live ┐
├──────────────────┬──────────────────┬──────────────────────────────────────┤
│ CYCLE-TIME (§2)  │ THROUGHPUT (§3)   │ WHERE STUCK (§4)  ◀ the killer panel  │
│ p85  4d 6h       │ 12 merged / wk    │ ▇▇▇▇▇▇ needs-input · review   58%     │
│ ├ refine  6h     │ ▲ vs last sprint  │ ▇▇▇    reject · code          22%     │
│ ├ code   2d 1h   │ wip 9  flow-eff   │ ▇▇     stuck · code           12%     │
│ ├ review 1d 8h ◀ │     61%           │ ▇      needs-input · plan      8%     │
│ └ test    9h     │                   │ aging WIP: DEV-1240 (2d in review) ▸ │
├──────────────────┴──────────────────┴──────────────────────────────────────┤
│ COST/TYPE+PRESET (§5)         │  AI_QUALITY trend (§6)  per (preset,stage,model) │
│ feature  ~€3.10  professional │  review  acceptance ▁▂▃▅▆ 81% ▲   (sonnet)      │
│ bug      ~€0.80  advanced     │  code    rework     ▆▅▃▂▁ 0.4× ▼   (sonnet)     │
│ Advisory — runs on subscription; hard limit is plan quota.                     │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Four panels + quality strip**, all deep-linkable: clicking an `aging_wip` row or a stuck-bar calls `navigate({ view:'ticket', ticketId, tab:'activity' })` (D65, feature [20]) — the same in-app nav Activity/Notifications/⌘K use. The stuck-panel is the default-focused, largest panel (the product thesis: surface *where work piles up*).
- **Time-range + preset + type filters** are client-side over the loaded window (like feature [20]'s actor filter); range buckets in `Workspace.timezone` (§3). Default range = current sprint (or last 30 tickets for `AI_QUALITY`, the feature-[05]-style sample window).
- **Mobile parity (~99%, B-37):** panels stack full-width; the stuck-panel leads; the quality sparklines are tap-to-expand; filters become a bottom-sheet — same posture as features [19]/[20].

### 7.2 The aggregation `_api` (read-only, the only new surface)

- **One `_api` endpoint** (`src/insights/_api/aggregate_v1.ts`, `method:'GET'`, `auth:{login:true}`) returns the folded rollups for a `{ workspaceId, range, groupBy }` query. It **reads** `TicketEvent`+`SpendRecord` via `tenantDb` under `runInTenant` ([04b §11c]) — it is a tenant-scoped read like every other `_api`. **It writes nothing.** This is the *only* net-new surface in the whole doc, and it is a read.
- **Folds run server-side, paginated by `seq` window.** For a large workspace the endpoint reads the bounded recent window (feature [20] D83's bounded-window posture) and lazy-loads older buckets — the same window discipline feature [20]'s catch-up uses, so analytics never scans an unbounded log on a request.
- **RBAC:** Insights is **read-gated on workspace membership** (any member sees the dashboard — it's their team's flow); no edit capability exists because there is nothing to edit. Cost figures inherit the same visibility as feature [19]'s Usage (a member sees advisory cost; no separate gate beyond membership, consistent with [19]'s read-only-for-members budget bar). `Q-ANALYTICS-COST-RBAC` flags whether per-type cost should be Admin-gated.

### 7.3 Caching (optimization, not a source of truth)

- **Optional materialized rollup in Redis**, keyed via `registerRedisKeyFormatter` (G24, tenant-scoped), refreshed on the same `seq`-watermark the live feed advances — a derived cache, **invalidated/recomputed from the log**, never authoritative. The append-only `TicketEvent` log stays the single source of truth; the rollup is a disposable read-through. `Q-ANALYTICS-CACHE` chooses on-request-fold (simplest, recommended for v1's small teams) vs a maintained rollup (faster at scale, more moving parts).

**Checklist — §7 is correct when:**
- [ ] The dashboard is a read-only `_api` projection over `TicketEvent`+`SpendRecord` — NO control-API op, NO Conductor action, NO verb.
- [ ] It reuses feature [20]'s subscribe-first → snapshot → merge-on-`seq` live path and D83 bounded-window read.
- [ ] Every drill-down deep-links via D65 `navigate({...})`; the stuck-panel is the default-focused product thesis.
- [ ] The single new surface is ONE read `_api` under `runInTenant`; any cache is a disposable rollup, never a source of truth.
- [ ] Cost figures carry the advisory note + tokens-only fallback (feature [05]/[19] contract).

---

## 8. Self-check (review invariants)

- **No new verbs.** The frozen [02 §2] surface (7 worker + 6 assistant, all `read|propose`) is untouched. Analytics is a pure read-side fold over `TicketEvent`+`SpendRecord`.
- **No new write path, no new persisted model.** The only net-new surface is ONE read-only `_api` aggregation (§7.2); no `TicketEvent` is written by analytics, no analytics column is added, any cache is a disposable Redis rollup recomputed from the log.
- **Product ≠ operator (the hard rule, §0).** Every metric here has a *workspace-member* consumer and answers "is the WORK flowing?"; it is never merged with [OBSERVABILITY]'s operator stream. Cross-link by `seq` only, exactly as [OBSERVABILITY §5.1] mandates.
- **Forge-blind.** Merge + CI signals read the **normalized** `ForgeEvent` ([FORGE_ABSTRACTION §3]) — GitLab / GitHub / built-in produce identical `mr`/`ci` `TicketEvent`s, so analytics works in every forge mode unchanged.
- **Single-instance + tenancy preserved.** The aggregation `_api` reads under `runInTenant` ([04b §11c]); a Redis rollup uses the tenant key formatter (G24). No second writer, no cross-tenant read.
- **Advisory cost stays advisory** ([01 §6], `Q-ENG-TOKENFEED`) — every cost figure is the editable-pricing estimate, tokens-only when pricing is zeroed, with the subscription-quota caveat note.
- **Every genuine fork is an open question** (§9) with a recommended default.

---

## 9. Open questions (Q-ANALYTICS-*) — defaults recommended, user to confirm/override

| id | Question | Recommendation | Why | Options |
|---|---|---|---|---|
| `Q-ANALYTICS-DONE-DEF` | What anchors "ticket completed" for cycle-time/throughput? | **The merge `mr` event in forge modes; the `final`-stage `done` in built-in/no-merge modes (forge-aware).** | "Shipped" = merged when a forge owns the MR ([FORGE_ABSTRACTION §7.2]); built-in/no-forge workspaces have no merge, so the terminal stage `done` is the honest anchor. Both are existing events. | (a) merge-anchored forge-aware [rec]; (b) always `final`-stage `done`; (c) ticket `status:done` regardless of stage; (d) user-configurable per workspace |
| `Q-ANALYTICS-PERCENTILE` | Default cycle-time statistic? | **p85, with mean + p50/p95 behind a toggle.** | p85 = "what most tickets actually feel like"; a mean is skewed by one stuck ticket. p85 is the planning-honest default for a small team. | (a) p85 default [rec]; (b) p50 default; (c) mean default; (d) show all, no default |
| `Q-ANALYTICS-AUTOGRADE` | Add an automated AI "grader" to score output quality beyond human verdicts? | **No for v1 — `AI_QUALITY` folds only HUMAN approve/reject/rework verdicts (feature [07]).** | An LLM grader is a new spawn + new cost + a circular quality story (the AI grading the AI). Human gate verdicts are ground truth and already exist. A grader is a real future opt-in, not v1. | (a) human-verdict-only [rec]; (b) optional LLM grader as a parked P3; (c) hybrid (grader flags, human confirms) |
| `Q-ANALYTICS-POSTMERGE` | Track post-merge re-opens as a regression-quality signal? | **Yes, as an OPTIONAL `AI_QUALITY` component, only if the forge emits a reopened-MR / re-entered-stage event.** | A merged ticket that re-opens is the truest "the AI was wrong" signal, but depends on a reopen event existing per forge mode; ship it where the event lands, skip silently where it doesn't (no fabricated signal). | (a) optional, event-gated [rec]; (b) required (block until all forges emit reopen); (c) defer entirely |
| `Q-ANALYTICS-CACHE` | On-request fold vs a maintained Redis rollup? | **On-request fold over the bounded recent window for v1 (small teams); a maintained `seq`-watermark rollup is the P2 scale upgrade.** | v1 teams are ≤5 people with bounded logs — a fold-on-request is simplest (Rule 7b) and needs no invalidation logic. A rollup is the natural optimization when a workspace's log outgrows a per-request scan. | (a) on-request fold [rec]; (b) maintained Redis rollup now; (c) precomputed nightly cron snapshot |
| `Q-ANALYTICS-COST-RBAC` | Is per-type/per-preset cost member-visible or Admin-gated? | **Member-visible (same as feature [19]'s read-only-for-members advisory budget bar).** | Cost is advisory and the team's own flow is theirs to see; gating it adds a capability with no enforcement behind it. Admins still own the budget *caps* (feature [19]); analytics is read-only. | (a) member-visible [rec]; (b) Admin+ gated; (c) per-workspace toggle |
| `Q-ANALYTICS-XWS` | Cross-workspace benchmarking ("your refine stage vs the median")? | **Out of v1 — one workspace at a time (consistent with feature [20] Out: cross-workspace activity, feature [05] Deferred: cross-workspace benchmarking).** | Multi-tenant aggregation crosses the `runInTenant` isolation boundary and raises a data-sharing question no v1 team asked for. A real future opt-in, not v1. | (a) out of v1 [rec]; (b) opt-in anonymized benchmark P3; (c) per-org rollup for multi-workspace orgs |

---

*End of PRODUCT_ANALYTICS.md. Pairs with [OBSERVABILITY] (the operator counterpart — strict boundary in §0) and composes over [04b §6/§9] (the `TicketEvent`/`SpendRecord` fact sources), feature [19] (per-ticket cost + budget policy), feature [20] (the event-log render + live/catch-up path it reuses), feature [05] (the `(preset,stage,model)` scoping + advisory-cost contract), and [FORGE_ABSTRACTION §3/§7.2/§8] (the normalized merge/CI events analytics folds, forge-blind). No new verbs. No new write path. A pure read-side projection of facts the Conductor already owns.*
