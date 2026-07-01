# OBSERVABILITY — structured logging, metrics, liveness & alerting for the orchestrator + engine

> The operability layer for the **single-instance orchestrator** ([01 §2], [07 §A–§D]) and the **PTY engine** ([01 §1, §3]). Companion to [08_DEPLOYMENT.md] (run model + boot lease + `resumeAll`) and the DR runbook in SETUP. Where 08 answers "how does it stay running", this doc answers "how do we *see* it running, and how do we know when it stops". Prereq: [01](./01_ARCHITECTURE.md), [07](./07_ORCHESTRATOR.md), [00_SPEC_RECONCILIATION.md], [REFERENCE_CODES.md], [04b_DATA_MODEL_ADDENDA.md]. Carries `Q-INF-OBSERVABILITY` (recommendation accepted 2026-06-04). Last updated: 2026-06-04.
>
> **No new verbs.** Nothing here touches the frozen structured-channel surface ([02 §2]). Observability is a *read-side* of the runtime: every signal below is derived from facts the Conductor already owns (`TicketEvent`, `AgentSession`, `SpendRecord` — [04b §6/§7/§9]), the Redis lease ([REFERENCE_CODES → G8/G16]), and process-local counters. It is **not** product telemetry: the user-facing event log ([20], `TicketEvent`) is the *product* fact stream; this doc is the *operator* fact stream. The two are deliberately separate (see §6).

---

## 0. Scope & the one decision (Q-INF-OBSERVABILITY)

Five operability surfaces, all app-owned, all single-instance-aware:

1. **A structured-logging contract** — every session / worker / loop line tagged with `SessionKey` + `ticketId` + `stageId` + `workspaceId` so any log line is traceable to the exact engine actor that emitted it (§1).
2. **A minimal metrics set** — active/queued turns, resident containers, lease state, indexer/reconcile lag, watchdog fires, CLI/token usage, container-boot failures (§2).
3. **Per-leased-loop liveness probes** — every `withLease`-guarded loop ([07 §A/§C/§D]) heartbeats; a stalled loop is detectable (§3).
4. **An alerting baseline** — orchestrator down, lease lost, container-boot failure, RAG drift (§4).
5. **The transport decision** — a **thin app adapter** that feeds the external `@luckystack/monitoring` repo; the framework owns *hooks*, not the metrics pipeline (§5).

**The decision (locked, `Q-INF-OBSERVABILITY` opt-1 = rec):** ship an **app-owned Observability section + a thin monitoring adapter**, NOT a defer-to-the-monitoring-repo punt and NOT a bespoke in-app dashboard. Rationale: the metrics and log fields are *Workspaces-domain-specific* (they reference `SessionKey`, the per-ticket container, the orchestrator lease) — only the app can emit them. But the *pipeline* (scrape, ship, store, alert-route) is generic and reusable, so it lives in the standalone `@luckystack/monitoring` repo (separate GitHub repo + npm package, NOT a `packages/` workspace — memory `project_monitoring_separation`). The app emits; monitoring transports. See §5 for the seam.

> **Explicitly out of scope:** product TicketEvent telemetry. The event log ([20], [04b §6]) is the *user's* audit trail, rendered in-app, append-only, restore-priority-1 ([04b §11], `Q-INF-DR`). Operator metrics are a DIFFERENT stream with a DIFFERENT consumer (an on-call human, not a workspace member). Do NOT route operator metrics through `TicketEvent`, and do NOT route `TicketEvent` rows into the metrics pipeline. §6 states the boundary as a hard rule.

---

## 1. Structured-logging contract

**Overview.** The orchestrator runs N concurrent PTYs (Assistants + Stage-Agents, [01 §3]), a serial indexer ([07 §D]), a serial reconcile worker ([07 §C]), the SessionManager watchdog ([01 §4]), and the Conductor's signal-consumption loop ([01 §3.3], B-O6). When something misbehaves at 3am, a log line is only useful if it answers *which actor, on which ticket, in which stage, in which workspace*. So **every log line carries a structured context envelope** — no bare `console.log`, no free-text-only lines.

### 1.1 The mandatory context envelope

Every log line emitted anywhere in the orchestrator process carries these fields (absent → `null`, never omitted, so log queries can filter on presence):

```ts
interface LogContext {
  // --- identity (who) ---
  sessionKey?: SessionKey;     // `assistant:${wsId}:${userId}` | `worker:${ticketId}:${stageId}` | `reasoner:${wsId}:${jobId}` ([01 §4])
  workspaceId: string;         // ALWAYS present — every loop runs runInTenant (Q-SEC-RUNINTENANT); a missing wsId is itself a bug to alert on
  ticketId?: string;           // worker/reasoner lines
  stageId?: string;            // typed StageKind, not bare string (Q-DATA-STAGEID); worker lines
  userId?: string;             // assistant lines (identity from the SSH capability-gate, [01 §8])
  // --- runtime (where) ---
  loop?: 'launch' | 'teardown' | 'indexer' | 'reconcile' | 'watchdog' | 'signal-consumer' | 'cron' | 'capacity';
  containerId?: string;        // persisted on AgentSession ([04b §7], Q-CT-RESUME); resolves a line to a docker container
  claudeSessionId?: string;    // for cross-referencing a turn against `claude --resume` state / the .jsonl
  cliVersion?: string;         // the EXACT pinned Claude CLI version (Q-CT-CLIPIN) — "which CLI built this MR" (B-36)
  // --- correlation (audit) ---
  seq?: number;                // when the line corresponds to a TicketEvent, its monotonic seq ([04b §6]) — cross-links operator log ↔ product log WITHOUT merging the streams
  leaseHeld: boolean;          // is THIS process the lease holder right now (G8/G16)? a writer line with leaseHeld=false is a split-brain alarm (§4)
}
```

- **`workspaceId` is non-optional by construction.** Every background worker wraps its body in `runInTenant` (`Q-SEC-RUNINTENANT`, a tracked P1 prerequisite) — the indexer, pty-agent relay, Conductor, signal-consumer, and cron tick all run inside a tenant scope. The logger reads the ambient tenant; a line with no `workspaceId` means a loop escaped `runInTenant` (the failure mode is `currentWorkspaceId()` throwing), which is itself loggable + alertable.
- **`sessionKey` is the primary correlation key.** It collapses the three-role taxonomy ([01 §3]) into one filterable string. Grepping `worker:DEV-1042:implementation` reconstructs that exact Stage-Agent's whole life across launch ([07 §A]), every turn, the watchdog's verdicts, and teardown.
- **`leaseHeld` makes split-brain visible.** Single-instance is enforced by the Redis lease ([REFERENCE_CODES → G8/G16], `packages/core/src/lease.ts` → `acquireLease`/`renewLease`/`releaseLease`). Any *writer* log line (a status flip, a container start, an indexer append) stamped `leaseHeld:false` is a contract violation — two processes think they own the children. This is the single highest-severity log-derived alert (§4).

### 1.2 Mechanics

- **Source the logger from `@luckystack/core`** ([01 §2] — the orchestrator may import core for `tryCatch`/logger/Redis). Wrap it once in an orchestrator-local `functions/log.ts` shim that binds the ambient `LogContext` (tenant + the current `SessionManager` actor) so call-sites write `log.info('turn started', { tokenEstimate })` and the envelope is injected automatically — never hand-assembled per call (drift risk).
- **JSON lines, one event per line** (machine-parseable for the §5 shipper); human-readable pretty-print only behind a dev flag.
- **Levels:** `debug` (per-turn PTY chatter — sampled, OFF in prod by default to avoid logging subscription-billed token content), `info` (lifecycle milestones — spawn/suspend/kill, route POST/DELETE, indexer delta done), `warn` (retry, schema-reject→retry on carry-over enforcement `Q-ENG-CARRYOVER-ENFORCE`, capacity reclaim), `error` (container-boot failure, lease-renew failure, `tryCatch` left-tuple from any loop).
- **NEVER log secrets or PTY content at `info`+.** The mounted RO `.credentials.json` (`Q-SEC-CLAUDEMOUNT`), the tmpfs-injected ro/rw DB creds (`Q-SEC-CREDLIFETIME`), and the GitLab PAT (server-side MCP tool) must never reach a log line. PTY byte streams may contain user code/secrets — scrollback lives in the in-container ring-buffer ([07 §pty-agent], B-31), not the operator log.

**Checklist — §1 is correct when:**
- [ ] No bare `console.*` in the orchestrator; all lines go through the context-binding `functions/log.ts` shim.
- [ ] Every line carries `workspaceId` (non-null) + `leaseHeld`; writer lines additionally carry `sessionKey`/`loop`.
- [ ] A single `sessionKey` grep reconstructs an actor's full lifecycle across all loops.
- [ ] No secret, no RO-cred, no PTY content at `info`+; `debug` token-content sampling is OFF in prod.
- [ ] `cliVersion` + `claudeSessionId` are stamped so "which CLI built this MR" (B-36) is answerable from logs alone.

---

## 2. Minimal metrics set

**Overview.** A *small, load-bearing* gauge/counter set — every metric here answers an operational question that, unanswered, causes a silent outage or a runaway cost. No vanity metrics. All are derivable from state the orchestrator already owns; none requires a new verb or a new persisted model. Labels are `{workspaceId, stageKind?}` where cheap; high-cardinality labels (`ticketId`, `sessionKey`) stay in *logs* (§1), not metrics (cardinality explosion).

| Metric | Type | Source of truth | Why it's load-bearing | Drives alert |
|---|---|---|---|---|
| `ws_active_turns` | gauge | the `MAX_CONCURRENT_ACTIVE` slot set ([01 §6]) — sessions currently *generating* | the real cost/throughput limit is concurrent active turns, not open sessions ([01 §6]); saturation = queueing | §4 saturation |
| `ws_queued_turns` | gauge | the Redis FIFO depth ([01 §6]) | sustained queue depth = under-provisioned cap or a wedged slot not releasing on Stop ([01 §4], `Q-ENG-TURNEND`) | §4 saturation |
| `ws_open_sessions` | gauge, by `kind` | `SessionManager.sessions` size, split assistant/worker/reasoner ([01 §4]) | idle PTYs are cheap but bound host RAM; pairs with capacity | — |
| `ws_resident_containers` | gauge | CapacityManager's resident set (`Q-CT-CAPACITY`) | the **uncapped-in-[01 §6]** axis: containers, not turns, exhaust the box; worst-case ~40 heavy containers (review §7) | §4 capacity |
| `ws_capacity_reclaims_total` | counter | CapacityManager reclaim-oldest-paused events (D87, `Q-CT-CAPACITY`) | frequent reclaims = host too small for load (the admission gate is thrashing) | §4 capacity |
| `ws_preview_containers` | gauge | the `previewConcurrencyCap` sub-limit inside the shared budget (`Q-PREVIEW-COST`) | a sub-limit of one shared budget — must be visible separately to re-derive the measured cap | §4 capacity |
| `ws_lease_held` | gauge 0/1 | `renewLease` success on the orchestrator's `lease:orchestrator` (G8/G16) | the single-instance pin; 0 = this process is not the writer; flapping = contention | §4 lease (critical) |
| `ws_lease_renew_latency_ms` | histogram | time to `renewLease` round-trip | rising latency = Redis pressure → imminent lease loss → `resumeAll` churn | §4 lease |
| `ws_indexer_lag_seconds` | gauge | `now − oldest unprocessed ragDeltaQueue job enqueue-time` ([07 §D]) | the serial `concurrency:1` indexer (G1) is the RAG bottleneck; lag = stale frozen-per-commit context for new tickets | §4 RAG drift |
| `ws_reconcile_lag_seconds` | gauge | `now − oldest unprocessed reconcileQueue job` ([07 §C]) | board drifts from GitLab-SoT (B-29) while reconcile backs up; the heal-cron's safety net | §4 RAG drift |
| `ws_watchdog_fires_total` | counter, by `reason` | the SessionManager watchdog ([01 §4]): `reason ∈ heartbeat-stale | idle-prompt | turn-cap | token-budget | rate-limit` | the engine's only "agent is stuck/looping/throttled" signal (B-35); a spike = systemic wedge | §4 watchdog |
| `ws_carryover_enforce_retries_total` | counter | Stop-hook forced-reconciliation retries (`Q-ENG-CARRYOVER-ENFORCE`) | a free-running PTY that won't `emit_carryover`; rising = prompt-discipline failing → tickets stall at needs-input | §4 watchdog |
| `ws_cli_turns_total` | counter, by `kind` | Stop-hook turn-end signals (`Q-ENG-TURNEND`) | engine throughput; the denominator for cost-per-turn | — |
| `ws_token_estimate_total` | counter | per-turn usage from hook payloads if present, else the labeled char-count estimate (`Q-ENG-TOKENFEED`) → `SpendRecord` ([04b §9]) | budget is **advisory** on the subscription ([01 §6], B-35); this is the advisory feed, NOT a billing meter — label it `estimate` | §4 (advisory only) |
| `ws_budget_cap_fired_total` | counter, by `enforcement` | a multi-row `WorkspaceBudget` cap hitting `spent ≥ cap` → `pauseNew`/`pauseAll` ([04b §9], D81/D82, multi-cap IS v1 per `Q-INF-BUDGET-SCOPE`) | a fired cap pauses spawns — an operator must know a workspace went quiet *because of policy*, not failure | §4 |
| `ws_container_boot_failures_total` | counter, by `phase` | non-transactional launch ([07 §A]) failing at `phase ∈ docker-run | render-config | caddy-route | stage-process | pty-attach` | the partial-launch OOM/orphan path (review §7); each failure may orphan a worktree+route | §4 container-boot (critical) |
| `ws_orphaned_resources` | gauge | boot-reconcile sweep: worktrees/routes/containers with no live `AgentSession` row | quantifies launch non-atomicity leakage; should trend to 0 after each reconcile | §4 |

**Mechanics.**
- **Pull or push, the app only *exposes*.** The orchestrator maintains these as in-process gauges/counters and exposes them on a `127.0.0.1`-bound `/metrics` endpoint (Prometheus text format) that the monitoring adapter (§5) scrapes — OR the adapter ships them. Either way the app *emits*; it does not store, alert, or dashboard.
- **Derived, not new-persisted.** Every metric reads existing truth (`SessionManager` maps, queue depths, lease state, `TicketEvent`/`SpendRecord`/`AgentSession` rows). **No new persistence** — consistent with the "reference index only, no new persistence" posture of the foundation docs.
- **Cardinality discipline.** `ticketId`/`sessionKey` are NEVER metric labels (a workspace may run thousands of tickets → metric explosion). They live in logs (§1); metrics aggregate by `workspaceId` + `stageKind` only.
- **The token metric is advisory by contract.** `ws_token_estimate_total` is explicitly an *estimate* ([01 §6], `Q-ENG-TOKENFEED`) — the subscription quota is the real limit, not dollars. Never wire it to a hard gate; the metered-API backend that would invert this to a hard pre-flight gate is parked (`Q-MP-BILLING`, P4). Label it so no downstream alert treats it as authoritative spend.

**Checklist — §2 is correct when:**
- [ ] Every metric maps to an existing truth source — no new persisted model introduced.
- [ ] `ws_resident_containers` + `ws_preview_containers` exist (the [01 §6]-uncapped axis is now observable).
- [ ] `ws_lease_held` is a 0/1 gauge driven by `renewLease`, scraped frequently enough to catch a flap.
- [ ] No `ticketId`/`sessionKey` metric labels; aggregation is `workspaceId`/`stageKind` only.
- [ ] `ws_token_estimate_total` carries an `estimate` label and feeds no hard gate (advisory, [01 §6]).

---

## 3. Per-leased-loop liveness probes

**Overview.** The orchestrator's correctness rests on a handful of **serial, lease-guarded loops** ([07 §A launch/teardown], [§C reconcile], [§D indexer], the [01 §4] watchdog, the B-O6 signal-consumer, the cron tick). A crashed *process* is caught by the deployment supervisor + lease expiry ([08_DEPLOYMENT.md], `resumeAll`). The subtler failure is a loop that's **alive but wedged** — the process holds the lease, `ws_lease_held=1`, but the indexer worker is blocked on a hung embedding call, or the signal-consumer deadlocked. A wedged loop is invisible to a process-level health check. So **each leased loop emits a liveness heartbeat**, and a watchdog-of-watchdogs detects a stale one.

### 3.1 The probe model

```ts
// Each leased loop stamps a heartbeat into Redis on every iteration (tenant-scoped key via registerRedisKeyFormatter, G24).
// liveness:loop:<loopName>  ->  { lastTickAt, leaseToken, pid }   (PEXPIRE = 3 × the loop's expected interval)
async function loopTick(loopName, fn) {
  await withLease(`lease:orchestrator`, async () => {        // G8/G16 — only the leader runs the loop
    await redis.set(liveKey(loopName), { lastTickAt: Date.now(), leaseToken, pid }, 'PX', 3 * intervalMs(loopName));
    await fn();                                              // the actual indexer/reconcile/watchdog body
  });
}
```

- **`/healthz` (orchestrator liveness)** — the deployment supervisor's probe ([08_DEPLOYMENT.md]). Returns 200 only if: (a) the process is up, (b) `ws_lease_held=1` OR the process is a deliberate stand-by replica, (c) Redis + Mongo are reachable. A stand-by (lease-less) instance returns 200-but-`role:standby` so the supervisor doesn't kill it.
- **`/readyz` (orchestrator readiness)** — 200 only when `resumeAll()` ([01 §4]) has finished re-attaching surviving sessions/containers after boot. Until then the orchestrator is up but not steering the fleet; the `app.` Caddy pool and any control-API enqueue must wait. (Distinct from a *ticket container's* PROD `/readyz`, which gates a preview going live — `Q-PREVIEW-COST`.)
- **Per-loop liveness** — a single SessionManager-owned watcher (`setInterval`, itself heartbeated) reads each `liveness:loop:*` key; a key older than `3 × interval` → emit `ws_loop_stale{loop=…}` + an `error` log line + an alert (§4). This catches the alive-but-wedged case the process probe misses.
- **Watchdog liveness** — the [01 §4] watchdog is itself a leased loop, so it heartbeats too; a stale *watchdog* heartbeat is the meta-alarm (no one is checking the agents) and is critical.

### 3.2 Why per-loop, not just per-process

The loops fail independently: the indexer can wedge on a hung self-hosted embedding container ([07 §D], B-18) while the reconcile worker and watchdog run fine. A process-level `/healthz` stays green. Only a per-loop probe surfaces "the indexer specifically has not ticked in 4 minutes" → `ws_indexer_lag_seconds` climbs AND its liveness key goes stale → a precise alert, not "the orchestrator feels slow".

**Checklist — §3 is correct when:**
- [ ] Every leased loop ([07 §A/§C/§D], [01 §4] watchdog, B-O6 signal-consumer, cron) stamps a `liveness:loop:*` heartbeat each iteration, keyed via `registerRedisKeyFormatter` (G24).
- [ ] `/healthz` reflects lease + Redis + Mongo reachability and distinguishes leader vs stand-by.
- [ ] `/readyz` is false until `resumeAll()` completes (the fleet isn't being steered yet).
- [ ] A stale per-loop heartbeat raises a loop-specific alert (the alive-but-wedged case), independent of `/healthz`.
- [ ] The watchdog's own heartbeat is monitored (the meta-alarm).

---

## 4. Alerting baseline

**Overview.** A minimal alert set — each tied to a §2 metric or a §3 probe, each with a clear operator action. Severity follows blast radius: **critical** = fleet-wide / data-integrity, **warning** = degraded / cost. Alert routing/dedup/escalation lives in `@luckystack/monitoring` (§5); the app only *emits* the signal (a metric crossing a threshold or a log line at `error`).

| Alert | Severity | Trip condition | Blast radius | Operator action |
|---|---|---|---|---|
| **Orchestrator down** | critical | `/healthz` non-200 for > 30s, OR no leader holds `lease:orchestrator` (`ws_lease_held=0` fleet-wide) for > one lease TTL | total — no Stage-Agents progress, no control-API actions execute | check the supervisor ([08_DEPLOYMENT.md]); on restart `resumeAll()` re-attaches surviving containers (`Q-CT-RESUME`) |
| **Lease lost / split-brain** | critical | a *writer* log line with `leaseHeld:false` (§1.1), OR `ws_lease_held` flapping (two instances alternately winning), OR `ws_lease_renew_latency_ms` p99 → TTL | data integrity — two processes may own the same children (G8/G16) | the loser must stop writing immediately (the lease helper's owner-checked compare-and-pexpire enforces this); investigate Redis health / clock skew |
| **Container-boot failure** | critical | `ws_container_boot_failures_total` increments, OR `ws_orphaned_resources > 0` after a reconcile | per-ticket — that stage can't run; may leak a worktree+route ([07 §A] non-atomic launch) | read the `phase` label; the boot-reconcile sweep ([08_DEPLOYMENT.md]) GCs the orphan; if `phase=pty-attach` suspect the auth mount (`Q-CT-AUTH`) or a CLI-version mismatch (`Q-CT-CLIPIN`) |
| **RAG / board drift** | warning→critical | `ws_indexer_lag_seconds` or `ws_reconcile_lag_seconds` over threshold (warn) / unbounded (critical) | new tickets get **stale frozen-per-commit context** (indexer) or the board diverges from GitLab-SoT (reconcile, B-29) | check the self-hosted embedding container (B-18) for the indexer; check the GitLab webhook + heal-cron ([07 §C]) for reconcile; the `concurrency:1` serial worker (G1) means one wedge blocks all deltas |
| **Watchdog spike** | warning | `ws_watchdog_fires_total` rate spikes, OR `ws_carryover_enforce_retries_total` climbs | systemic — many agents stuck/looping/throttled at once (B-35) | a `reason=rate-limit` spike = subscription quota exhaustion ([01 §6]) → expect auto-pause + backoff; a `carryover_enforce` spike = prompt-discipline regression (`Q-ENG-CARRYOVER-ENFORCE`) |
| **Capacity saturation** | warning | `ws_queued_turns` sustained > 0 with `ws_active_turns` at cap, OR `ws_capacity_reclaims_total` rate high | throughput — users wait behind the FIFO; reclaims thrash paused containers | raise `MAX_CONCURRENT_ACTIVE` toward the practical ceiling ([01 §6]) or the host's resident cap (review §7, reference 8 vCPU/32 GB); if reclaims thrash, the box is undersized |
| **Loop wedged** | critical | a §3 `liveness:loop:*` heartbeat is stale (older than `3 × interval`) | per-loop — that subsystem silently stopped while the process stays "up" | restart is safe (idempotent leased loops + `resumeAll`); identify the loop from the alert label before restarting |
| **Budget cap fired** | warning (informational) | `ws_budget_cap_fired_total` increments | per-workspace — a workspace paused spawns by **policy** ([04b §9], D81/D82) | confirm it's policy, not failure; the "which cap fired" modal (doc 19) names the cap `label`; raise/adjust the cap if intended |

- **Critical alerts page; warnings notify.** This split is configured in `@luckystack/monitoring` (§5), not the app.
- **The advisory-token line is NOT an alert.** `ws_token_estimate_total` never trips a page (it's an estimate, [01 §6]) — only a *budget cap* (`ws_budget_cap_fired_total`, a real policy threshold) alerts, and only informationally.
- **Tie-back to deployment.** Every critical alert's recovery action assumes the [08_DEPLOYMENT.md] run model: a single supervised process acquiring `lease:orchestrator` on boot and running `resumeAll()`. The orchestrator is a documented SPOF; these alerts are the SPOF's early-warning system.

**Checklist — §4 is correct when:**
- [ ] Every alert maps to a §2 metric or a §3 probe — no alert without a measurable signal.
- [ ] "Lease lost / split-brain" is wired to the `leaseHeld:false` writer-line invariant (§1.1) — the highest-integrity alarm.
- [ ] Container-boot failure surfaces the `phase` label + points at the orphan-GC reconcile.
- [ ] Advisory token usage never pages; only a fired budget cap alerts (informationally).
- [ ] Alert *routing/dedup/paging* lives in `@luckystack/monitoring`, not the app (§5).

---

## 5. Transport — the thin app adapter over `@luckystack/monitoring`

**Overview & decision (Q-INF-OBSERVABILITY, locked).** The app **emits** domain-specific signals; the standalone **`@luckystack/monitoring`** repo **transports** them (scrape, ship to a store, evaluate alert rules, route/page). The framework's job is to expose enough hooks for monitoring to attach — it does **not** own the metrics pipeline (memory `project_monitoring_separation`).

- **`@luckystack/monitoring` is a SEPARATE GitHub repo + npm package**, not a `packages/` workspace in the LuckyStack monorepo. The underlying observability code (audit emission, Prometheus vitals, log shipping) is reusable outside LuckyStack, so it lives standalone; non-LuckyStack apps can adopt it. **Web-vitals folds INTO it** as a subpath (`@luckystack/monitoring/web-vitals`), not its own package.
- **The app ships a thin adapter** — a small orchestrator-local module (mirroring the framework's thin-adapter pattern: `registerHook('preApiExecute', …)` / `registerHook('postApiExecute', …)`) that:
  1. Registers the §1 logger sink so structured lines flow to the monitoring shipper (or stdout for the shipper to tail).
  2. Exposes the §2 `/metrics` endpoint (or registers the gauges with the monitoring client).
  3. Surfaces the §3 `/healthz` + `/readyz` for the monitoring liveness checker.
  4. Forwards §4 trip-conditions as monitoring events; **alert routing/dedup/paging is monitoring's job**, not the adapter's.
- **The adapter is OPTIONAL and peer-dep-guarded.** Per the peer-dep guard policy (memory `feedback_peer_dep_guard_policy`): if a monitoring env-key is set but `@luckystack/monitoring` is absent → **hard boot crash**, never a silent fallthrough. If no monitoring key is set, the orchestrator still runs — it logs to stdout (the §1 contract holds regardless) and exposes `/metrics` for anything to scrape; only the *managed transport* is gated. (This mirrors the secret-manager fail-open posture only in that absence is allowed; a *configured-but-missing* package is fail-fast.)

### 5.1 The boundary — operator stream vs product stream (a hard rule)

```
┌─ PRODUCT stream (user-facing) ────────────┐   ┌─ OPERATOR stream (on-call) ───────────────┐
│ TicketEvent (append-only, seq-ordered)    │   │ structured logs (§1) + metrics (§2)       │
│ [04b §6] · rendered in-app [20]           │   │ + liveness (§3) + alerts (§4)             │
│ restore-priority-1 (Q-INF-DR)             │   │ shipped to @luckystack/monitoring (§5)    │
│ consumer: a workspace MEMBER              │   │ consumer: an on-call HUMAN                 │
└───────────────────────────────────────────┘   └───────────────────────────────────────────┘
         ▲                                                       ▲
         └──── correlated by `seq` in LogContext (§1.1), NOT merged ────┘
```

- **Do NOT route operator metrics through `TicketEvent`.** The event log is the *product* audit trail (B-21, B-O6, restore-priority-1). Polluting it with operator metrics would corrupt the user's append-only history and inflate the DR restore set ([04b §11]).
- **Do NOT route `TicketEvent` rows into the metrics pipeline as telemetry.** They're product facts with a workspace-member consumer, not operator signals. (A *count* of events — e.g. indexer lag derived from enqueue timestamps — is fine; shipping event *bodies* to monitoring is not.)
- **The only link is `seq`** (§1.1): an operator log line that corresponds to a `TicketEvent` carries that event's `seq`, so an investigator can cross-reference the two streams without merging them.

**Checklist — §5 is correct when:**
- [ ] The app emits; `@luckystack/monitoring` (separate repo) transports + alerts — the app owns no metrics pipeline.
- [ ] The adapter is a thin hook-registering module; web-vitals is a monitoring subpath, not a new package.
- [ ] Monitoring env-key set + package absent → hard boot crash (peer-dep guard); no key → stdout logs + `/metrics` still work.
- [ ] Operator stream and product `TicketEvent` stream are separate; the only cross-link is `seq`.
- [ ] No operator metric is written to `TicketEvent`; no `TicketEvent` body is shipped as telemetry.

---

## 6. Operator-stream ↔ product-stream boundary (the standing rule)

Stated once, binding for every lane that adds observability:

1. **Two streams, two consumers, two stores.** Product = `TicketEvent` ([04b §6], rendered in [20], for a workspace member). Operator = logs/metrics/liveness/alerts (this doc, shipped to `@luckystack/monitoring`, for an on-call human).
2. **Cross-link, never merge** — via `seq` in `LogContext` (§1.1).
3. **No new verbs, no new persistence.** Everything here is read-side over existing truth (`SessionManager` state, the lease, `TicketEvent`/`SpendRecord`/`AgentSession` rows, queue depths). The frozen structured-channel surface ([02 §2]) is untouched.
4. **Advisory cost stays advisory** ([01 §6], `Q-ENG-TOKENFEED`, `Q-MP-BILLING`): the token metric is an estimate, never a gate; only a real `WorkspaceBudget` cap ([04b §9], D81/D82) is a policy threshold.
5. **Single-instance is the spine.** Every metric/log/probe is lease-aware (`leaseHeld`, `ws_lease_held`); the highest-severity alarm is split-brain (a writer line with `leaseHeld:false`).

---

*End of OBSERVABILITY.md. Pairs with [08_DEPLOYMENT.md] (run model, boot lease, `resumeAll`, SPOF) and the SETUP DR runbook (`Q-INF-DR`). Cites [01]/[07] for the runtime, [04b §6/§7/§9] for the fact sources, and [REFERENCE_CODES → G8/G16/G24/B-26/B-35/B-O6] for the codes. No new verbs.*
