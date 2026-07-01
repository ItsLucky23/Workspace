# Addition 12 — Failure forensics

> **Tier:** HORIZON (designed, not built in V1) · **Lane:** A + B · **Status:** NEW (2026-06-11).
> **Pitch:** Go beyond restart/retry — deterministically cluster recurring failure signatures across tickets, surface remediations as human-accepted `WorkspaceSuggestion`s (never auto-applied), and quarantine flaky tests so they stop falsely blocking test/review stages.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #12.

> **Authority & prereqs.** Builds on [`02_PROTOCOL_AND_FLOW`](../02_PROTOCOL_AND_FLOW.md) (§1 status machine `stuck`, §6 signals/suggestions/notifications), [`02b_PROTOCOL_ADDENDA`](../02b_PROTOCOL_ADDENDA.md) (§B Stop-hook forced-reconciliation loop + the `attempts` counter, §D `VERB_REGISTRY`), [`features/24_PAUSE_AND_KILL_CONTROLS`](../features/24_PAUSE_AND_KILL_CONTROLS.md) (B-35 runaway → `stuck` → `needs-input` auto-escalation), [`OBSERVABILITY`](../OBSERVABILITY.md) (the operator-vs-product metric/log substrate + the `ws_watchdog_fires_total{reason}` / `ws_carryover_enforce_retries_total` counters), [`TESTING_STRATEGY`](../TESTING_STRATEGY.md) (the test stage + the fake/replay `EngineDriver`), [`AI_QUALITY_AND_EVALS`](../AI_QUALITY_AND_EVALS.md) (quality signals: reconciliation-failure rate, the §5 reject/edit feedback loop). Data shapes: [`04b §6`](../04b_DATA_MODEL_ADDENDA.md#6-ticketevent--the-append-only-event-log) (`TicketEvent`), [`04b §8`](../04b_DATA_MODEL_ADDENDA.md#8-workspacesuggestion--5-value-type--patch) (`WorkspaceSuggestion`). Depends on **Addition #09** (per-stage commit) + the **Tier-2 hardening** doc (trigger **run-ledger** + `automation.failed` events) as data sources (§3.1). Codes via [`REFERENCE_CODES`](../REFERENCE_CODES.md) (B-23, B-35, B-O6, G2, G8/G16, G24).
>
> **No new verbs.** Nothing here touches the frozen structured-channel surface ([02 §2], 7 worker + 6 assistant, all `read|propose`, none write). Detection is deterministic Conductor-side clustering over append-only logs; every remediation is a `propose_suggestion` (existing assistant verb) → `WorkspaceSuggestion` → `[control-API]` → human-accept → Conductor write (B-23). Quarantine is config the test/review stage *reads*; flipping it is a `[control-API]` op.

---

## 1. The gap this closes

Today the failure story is **per-ticket and reactive**. When a Stage-Agent wedges, three mechanisms fire, each scoped to *one* ticket:

- the **Stop-hook forced-reconciliation loop** ([02b §B]) retries `emit_carryover` `N` times, then lands the ticket in `needs-input` with a system-authored question;
- the **B-35 runaway watcher** ([24], [01 §4]) escalates a heartbeat-stale / idle / turn-capped session `busy → stuck → needs-input`;
- the user **pauses / kills / answers** ([24]).

Each is correct and each forgets everything the moment the ticket moves on. The substrate that *would* let us see a pattern already exists but is never read across tickets:

| Already emitted (per-ticket) | Where | Never correlated across tickets today |
|---|---|---|
| `stuck` verdicts + `reason` | watchdog → `ws_watchdog_fires_total{reason}` ([OBSERVABILITY §2]) | "the same `reason` keeps firing on the same dependency" |
| carry-over retry exhaustion | `02b §B` `attempts`, `ws_carryover_enforce_retries_total` | "this stage's prompt fails to reconcile on a whole class of tickets" |
| `stopped` signals (`{reason, userQuestion?}`) | `WorkspaceSignal` ([02 §6], B-O6) | "3 tickets stopped on the same missing tool / allow-list entry" |
| test pass/fail per run | the Test stage's `emit_carryover` findings ([TESTING_STRATEGY], [AI_QUALITY §2.5]) | "this test fails 40% of the time regardless of the diff" → a **flaky** test |
| `automation.failed` + trigger run-ledger rows | **Tier-2 hardening** doc (§3.1) | "every `on_complete → start-stage` trigger on this pipeline 500s" |

The gap, named: **there is no cross-ticket memory of failure.** A human eventually notices "this keeps happening" and hand-fixes the cap / prompt / allow-list, or mutes a flaky test by hand. Addition 12 makes that noticing **deterministic, durable, and surfaced as a proposal** — without ever giving an LLM (or the Conductor) the authority to apply the fix or silence a test on its own.

The three facets correspond to three failure *kinds* the substrate can already distinguish:

1. **Recurring stuck/loop signatures** → cross-ticket pattern detection (§3.1).
2. **A stage that keeps failing the same way** → an auto-remediation *suggestion* (§3.2).
3. **A test that fails non-deterministically** → flaky-test quarantine (§3.3).

---

## 2. Locked decision (all three facets; remediations are PROPOSALS, never auto-applied)

Build **all three** facets. The locked shape (DEFAULTs in §5; flag if any is wrong):

1. **(a) Cross-ticket pattern detection is DETERMINISTIC clustering** over the append-only `TicketEvent` ([04b §6]) / `WorkspaceSignal` `stopped` ([02 §6]) / `02b §B` Stop-loop-attempt log / Tier-2 run-ledger. **No LLM is used for detection.** A `FailureCluster` is a Conductor-written rollup keyed by a deterministic **signature** (§3.1). An optional one-shot reasoner ([02 §6]) may only *phrase* a remediation suggestion — never decide whether one exists.
2. **(b) Auto-remediation is always a PROPOSAL.** A detected cluster that maps to a known remediation class (raise a cap, adjust a prompt, add a missing tool / allow-list entry) produces a `WorkspaceSuggestion` ([04b §8]) — **surfaced, never applied**. Acceptance is the existing `propose_suggestion → [control-API] → preApiExecute RBAC → Conductor write` path (B-23). The forensics engine has **no write verb** and the Conductor never self-applies a remediation.
3. **(c) Flaky-test quarantine is a per-workspace test-id list** the test/review stage config **reads**. Detection (a test that passes and fails on the *same* commit / across reruns) is deterministic; quarantining a test is a human-accepted `[control-API]` op that adds its id to the list; the test stage skips-but-reports quarantined tests so they stop *falsely blocking* a stage without hiding that they were skipped.

**The through-line (B-23):** detection observes, the engine proposes, a human decides, the Conductor executes. Nothing in this addition is an exception to single-writer / no-write-verb.

---

## 3. Design-grade mechanics

### 3.1 Cross-ticket pattern detection (deterministic clustering over the log)

**Inputs (all append-only, all already written by the Conductor — read-side only):**

| Source | Shape | Citation |
|---|---|---|
| `TicketEvent` error/status-change rows | `{ seq, ticketId, stageId, type:'status-change'\|'file-change'\|'command', actor, metadata }` | [04b §6] |
| `WorkspaceSignal('stopped')` | `{ type:'stopped', payload:{ reason, userQuestion? }, seq }` | [02 §6], B-O6 |
| Stop-loop attempts | `02b §B` `attempts` exhaustion → the system-authored stuck question | [02b §B] |
| watchdog verdicts | `reason ∈ heartbeat-stale\|idle-prompt\|turn-cap\|token-budget\|rate-limit` | [OBSERVABILITY §2], B-35 |
| per-stage commit metadata | the frozen `commitHash` + changed-file set the stage produced | **Addition #09** |
| `automation.failed` + trigger run-ledger | per-trigger-run outcome rows (`triggerId`, `status`, `reason`) | **Tier-2 hardening** doc |

> **Dependency note (report-only).** Addition #09 (per-stage commit) and the Tier-2 hardening doc (trigger run-ledger + `automation.failed`) are **sibling HORIZON docs not yet authored**. This addition references their *named outputs* as data sources; their build-grade field bodies live in those docs. Where this spec needs a field they do not yet pin, it is proposed as a **DELTA** below, to be reconciled when those lanes open (not minted in V1).

**The signature (the deterministic clustering key).** A failure event is reduced to a **`FailureSignature`** — a stable, hash-able tuple computed purely from the inputs above, with **no LLM and no fuzzy matching** (substring/normalized-token equality only, so the same input always lands in the same bucket and the cluster is reproducible in a test):

```ts
// Conductor-side, deterministic. No model call. Proposed shape (DELTA — new persisted model, §4).
type FailureSignatureKind =
  | 'stuck-reason'        // watchdog reason (heartbeat-stale | idle-prompt | turn-cap | token-budget | rate-limit)
  | 'carryover-exhausted' // 02b §B attempts > N for this stage
  | 'stopped-reason'      // normalized WorkspaceSignal('stopped').reason
  | 'missing-tool'        // a PostToolUseFailure / stopped-reason naming a denied/absent tool or allow-list entry
  | 'dependency-file'     // a changed/needed file or import path common to the failures
  | 'automation-failed';  // a recurring automation.failed reason (Tier-2)

interface FailureSignature {
  kind: FailureSignatureKind;
  stageKind: StageKind;          // [04b §12] — the role the failure happened in
  key: string;                   // the normalized discriminator: the dep/import path, the tool name, the reason bucket
  // hash = sha256(kind + ':' + stageKind + ':' + key) — the cluster bucket
}
```

**The clustering loop (Conductor-owned, under the existing lease).** Reuses the **serial signal-consumption loop** ([02 §6], B-O6, single-consumer under `lease:orchestrator` G8/G16) — **no new loop, no new lease**. On each consumed failure-bearing event the Conductor:

```
on a failure-bearing event (stuck verdict | stopped signal | carryover-exhausted | automation.failed):
  sig = computeFailureSignature(event)                 // deterministic, no LLM
  cluster = upsert FailureCluster by sig.hash          // append-only occurrence; Conductor-write (B-23)
     cluster.occurrences += 1
     cluster.ticketIds  ∪= event.ticketId              // distinct tickets — the "3 tickets" count
     cluster.lastSeenSeq = event.seq                    // G2 seq, the ordering key (NOT createdAt)
  if cluster.distinctTickets >= THRESHOLD (default 3, per-workspace configurable, §5):
     and cluster has NO open/accepted remediation suggestion yet:
        → §3.2 (raise a remediation PROPOSAL)
```

- **Distinct-ticket threshold, not raw-count.** "3 tickets failed on the same import/dependency/file" is `distinctTickets >= 3` — one flapping ticket can't manufacture a cluster (it would inflate `occurrences` but not `distinctTickets`).
- **`seq`-ordered, gap-tolerant, idempotent.** Clustering rides the same `seq`-merge guarantee the event log rests on ([04b §6], G2): re-feeding an already-counted event (crash replay) is a no-op (the loop is idempotent under the lease, [TESTING_STRATEGY §2.4]). This makes the whole detector a **pure reducer** testable with zero subscription turns ([TESTING_STRATEGY §2/§3]).
- **Operator-vs-product boundary respected ([OBSERVABILITY §6]).** `FailureCluster` is a **product** fact (a workspace-member-facing forensics surface, rendered in-app), written by the Conductor, NOT operator telemetry. It is *derived from* `TicketEvent` (correlated by `seq`) but is its own append-only rollup — it does **not** pollute `TicketEvent`, and operator metrics (`ws_watchdog_fires_total`) stay in the monitoring stream. The clustering only *reads* the same underlying facts the operator metrics aggregate; the two streams stay separate.
- **Window + decay.** Clustering is bounded to a rolling window (default 30d / last-K events, §5) so a long-since-fixed dependency stops counting; an accepted-and-applied remediation **closes** the cluster (a new occurrence after close opens a fresh cluster, so a regression is visible as a *recurrence*, not silently folded in).

### 3.2 Auto-remediation SUGGESTIONS (suggestion → control-API → human-accept; B-23)

A cluster crossing threshold maps — **deterministically, by `kind`** — to a **remediation class**, then a suggestion is drafted. The mapping is a fixed table (no LLM decides *whether* to remediate); an optional one-shot reasoner ([02 §6]) may only enrich the human-readable `body`/`title` phrasing:

| Cluster `kind` | Remediation class | The `patch` proposed ([04b §8] `patch Json?`) | RBAC to accept |
|---|---|---|---|
| `stuck-reason: turn-cap` / `token-budget` | **raise a cap** | `{ path:'stage.maxTurns'\|'stage.contextBudgetTokens', before, after }` | Admin+ (pipeline-edit, B-28) |
| `stuck-reason: rate-limit` | **back-off / schedule** (advisory) | a `maintenance`-typed note (no auto-throttle — quota is the real limit, [OBSERVABILITY §2]) | — (informational) |
| `carryover-exhausted` | **adjust the stage prompt** | a `config-review` patch carrying a revised `systemPrompt` body — routed through the [AI_QUALITY §4] `PromptVersion` path, never a free-text mutation | Admin+ + the [AI_QUALITY §3.4] golden gate |
| `missing-tool` | **add a tool / allow-list entry** | `{ path:'stage.permissions.allow'\|'stage.tools', before, after:[…+'<tool>'] }` | Admin+ |
| `dependency-file` | **link tickets / surface the shared dep** | a `link-tickets` suggestion over `cluster.ticketIds` (the deterministic-rule case, [02 §6]) | "work on tickets" |
| `automation-failed` | **review the trigger** | an `automation`-typed `config-review` patch over the failing `WorkspaceTrigger` (Tier-2) | Admin+ |

**The path (unchanged, B-23):**

```
FailureCluster crosses threshold
  → the Conductor emits the deterministic class (table above); for a config-review/prompt class it MAY
    defer to a connected Assistant or the optional one-shot reasoner to PHRASE the suggestion body
    (propose_suggestion → WorkspaceSuggestion, [02 §6]) — read|propose only, no write
  → WorkspaceSuggestion{ type, title, body, ticketIds: cluster.ticketIds, patch }   // [04b §8]
       + a Notification(type:'ai-suggestion', [04b §10]) deep-linking the cluster
  → a human ACCEPTS via [control-API] → preApiExecute RBAC → the Conductor applies the patch (B-23)
  → on apply, the cluster is marked remediated (close + link the accepted suggestion)
```

- **Never auto-applied (the load-bearing invariant).** The forensics engine has no write verb; it can only `propose_suggestion`. The Conductor applies the patch **only** on a human `accept` `[control-API]` op — identical governance to every existing `config-review` ([03 §4], [AI_QUALITY §4.2]). A `rate-limit` or `dependency-file` class is *informational/link-only* and carries no appliable patch.
- **Reuses the existing suggestion model — no new `type`.** Remediations ride the canonical 5-value `WorkspaceSuggestion.type` ([04b §8]: `link-tickets | create-epic | config-review | maintenance | automation`). A cap-raise / tool-add / prompt-adjust is a `config-review` (it carries a `patch`); a dependency cluster is `link-tickets`; a back-off advisory is `maintenance`; a trigger fix is `automation`. **No new suggestion type, no new verb.**
- **Prompt remediations route through the quality lane.** A `carryover-exhausted` remediation does **not** hand-edit a prompt — it proposes a new `PromptVersion` candidate ([AI_QUALITY §4]) which must pass the golden-set gate ([AI_QUALITY §3.4]) before promotion. Forensics is the *trigger*; the quality lane is the *governor*. (This also closes the loop: a recurring reconciliation failure becomes a measured prompt change, not a blind one.)
- **Idempotent proposals.** A cluster with an already-open or already-accepted remediation does not re-propose (the §3.1 guard); a dismissed suggestion snoozes the cluster for a configurable cool-off before it may re-surface (§5), so a deliberately-rejected remediation doesn't nag.

### 3.3 Flaky-test quarantine (per-workspace list; stage config respects it)

**Detection (deterministic).** A test is **flaky** when it produces *different* pass/fail verdicts without a corresponding code change — observable from the substrate two ways, both deterministic:

1. **Same-commit disagreement** — across reruns at the **same per-stage `commitHash`** (Addition #09), the test passed once and failed once. (The cleanest signal; needs no diffing.)
2. **Diff-orthogonal failure** — the test failed on a ticket whose changed-file set ([04b §6] `metadata.changedFiles`) does **not** intersect the test's subject, then passed on an unrelated later ticket. (Weaker; flagged as *suspected* flaky, requires same-commit confirmation before quarantine is proposed.)

A flaky verdict is itself a `FailureSignature{ kind:'flaky-test'? , key: testId }` cluster — **DELTA:** add `flaky-test` to `FailureSignatureKind` (§3.1) so flaky detection reuses the same clustering loop and threshold machinery rather than a parallel path. A test crossing the threshold (default: 2 same-commit disagreements, §5) becomes a **quarantine proposal**, not an automatic quarantine.

**The quarantine list (the per-workspace config the stage reads).**

> **DELTA — proposed field on a stage-config surface (reconcile when Lane D / [features/02] opens):** a per-workspace `quarantinedTestIds: string[]` (tenant-scoped, `runInTenant`). Smallest correct home is a workspace-level list the test/review `PipelineStageCfg` reads; an alternative is a dedicated append-only `TestQuarantine{ workspaceId, testId, reason, clusterId, addedBy, addedAt, releasedAt? }` model if an audit trail per quarantine is wanted (recommended — keeps "why was this muted, by whom, when" answerable, mirroring [04b §11a] append-only posture). **Not minted in V1.**

**How the stage respects it (skip-but-report, never hide):**

```
Test stage runs the suite:
  for each test: if testId ∈ quarantinedTestIds:
     RUN it (or mark skipped — configurable) but DO NOT let its verdict BLOCK the stage
     ALWAYS report it in the emit_carryover findings as `quarantined: <pass|fail>` ([AI_QUALITY §2.5])
  the stage's pass/fail gate is computed over NON-quarantined tests only
Review stage:
  renders quarantined tests as a distinct, visible section ("N tests quarantined — not blocking")
  so a quarantined-but-still-failing test is never silently green
```

- **Quarantine is human-accepted, RBAC-gated.** Adding a `testId` to the list is a `[control-API]` op (`quarantine-add`, **DELTA** in the [CONTROL_API] op catalogue), Admin+ (pipeline-edit, B-28) — the AI only *proposes* it via the §3.2 suggestion path (a `maintenance` or new `config-review` suggestion carrying `{ testId, evidence: cluster.ticketIds }`). **Never auto-quarantined** (B-23): a test silently muted by an AI is exactly the failure mode this guards against.
- **Quarantine ≠ delete.** The test still runs (or is explicitly skipped-and-reported); it just stops *falsely blocking*. A release op (`quarantine-release`) un-mutes it; a quarantined test that starts passing reliably (same-commit agreement over a window) raises a `maintenance` suggestion to **release** it, so quarantine doesn't become a graveyard.
- **Scoped per-workspace, never cross-tenant.** The list is tenant-scoped (`runInTenant`, [04b §11c]) — one team's flaky test never quarantines another's. (Mirrors the [AI_QUALITY §5.2] few-shot per-workspace rule.)

---

## 4. Invariants honored (esp. B-23 — never auto-apply)

| Invariant | How this addition honors it |
|---|---|
| **B-23 — Conductor-only-writer; AI proposes, human accepts** | Detection only *reads* append-only logs and *writes* `FailureCluster` rollups Conductor-side. Every remediation + every quarantine is a `propose_suggestion` → `WorkspaceSuggestion` → `[control-API]` → `preApiExecute` RBAC → Conductor apply. **No facet auto-applies a fix or auto-quarantines a test.** |
| **FROZEN verbs (no new verb)** | Nothing here adds, renames, or relaxes a verb. The frozen 7+6 ([02 §2], [02b §D] `VERB_REGISTRY`) is the spine: detection is Conductor-internal; proposals ride the existing `propose_suggestion`; applies are `[control-API]` ops. The [TESTING_STRATEGY §5] conformance test still passes unchanged. |
| **`runInTenant` (Q-SEC-RUNINTENANT)** | The clustering loop, `FailureCluster` writes, and the quarantine list all run under the existing tenant-scoped signal-consumption loop ([02 §6], [OBSERVABILITY §1.1] `workspaceId` non-optional). No cluster, suggestion, or quarantine crosses a workspace. |
| **PTY-billing / interactive-only** | Detection is deterministic clustering — **zero** LLM calls, **zero** subscription turns. The only optional model touch is the one-shot reasoner *phrasing* a suggestion body ([02 §6]) — already a parked, gated, subscription-aware path, never on the detection hot path. |
| **Single-instance + `seq` ordering** | The loop runs under `lease:orchestrator` (G8/G16); clusters key on `seq` (G2), not `createdAt`; idempotent under crash-replay ([TESTING_STRATEGY §2.4]). |
| **Operator-vs-product stream boundary ([OBSERVABILITY §6])** | `FailureCluster` is a product fact (member-facing), correlated to operator metrics by `seq` but never merged into `TicketEvent` nor shipped as operator telemetry. |
| **V1_SCOPE wins** | This is HORIZON — **not built in V1** ([V1_SCOPE §4-style deferral]). It depends on two other not-yet-built HORIZON docs (#09, Tier-2). No V1 migration, no V1 `types.ts` backfill. Recorded as design only. |

---

## 5. Open sub-decisions (DEFAULTs)

| id | Question | DEFAULT (flag if wrong) | Why |
|---|---|---|---|
| `Q-FF-DETECT-ENGINE` | Is pattern detection deterministic clustering, or an LLM? | **Deterministic clustering over the log; no LLM for detection.** An optional one-shot reasoner may only *phrase* a suggestion body. | Reproducible, testable with zero subscription turns ([TESTING_STRATEGY §2/§3]); an LLM detector would be non-deterministic and drift. The prompt's stated default. |
| `Q-FF-THRESHOLD` | Cluster trigger threshold? | **`distinctTickets >= 3`, rolling 30d/last-K window, per-workspace configurable.** Flaky: **2 same-commit disagreements.** | "3 tickets on the same dep" is the canonical signal; distinct-ticket (not raw count) stops one flapping ticket manufacturing a cluster; the window decays fixed problems. |
| `Q-FF-CLUSTER-MODEL` | New persisted `FailureCluster`/`FailureSignature` model, or fold into an existing one? | **New append-only `FailureCluster` (product fact), keyed by signature hash.** | It's a distinct rollup with its own lifecycle (open→remediated→reopen); folding it into `TicketEvent` would violate the operator/product + append-only rules ([OBSERVABILITY §6], [04b §11a]). DELTA — minted when this lane opens, not V1. |
| `Q-FF-REMEDIATION-TYPE` | New `WorkspaceSuggestion.type` for remediations? | **No — reuse the canonical 5-value set** (`config-review` for cap/tool/prompt patches, `link-tickets` for dep clusters, `maintenance` for advisories, `automation` for triggers). | [04b §8] is canonical; a remediation IS a config-review/link/maintenance. Adding a 6th type would ripple the `types.ts` backfill + every suggestion renderer for no gain. |
| `Q-FF-PROMPT-REMEDIATION` | Do prompt remediations hand-edit the prompt? | **No — route through the [AI_QUALITY §4] `PromptVersion` candidate + golden gate.** | A blind prompt edit can degrade output; the quality lane already measures before promote ([AI_QUALITY §3.4]). Forensics triggers, the quality lane governs. |
| `Q-FF-QUARANTINE-HOME` | Where does the quarantine list live + is it audited? | **Append-only `TestQuarantine` model (audited), test/review stage config reads the derived id-set.** A bare `quarantinedTestIds: string[]` on stage config is the lighter alt. | "Why/who/when muted" must be answerable (a muted test is a real risk); append-only mirrors [04b §11a]. DELTA — reconcile with [features/02] when Lane D opens. |
| `Q-FF-QUARANTINE-RUN` | Does a quarantined test still RUN? | **Run-but-don't-block by default (report verdict as `quarantined:<pass\|fail>`); skip is configurable.** | Running keeps the flaky verdict visible (so a release proposal can fire when it stabilizes) without falsely blocking; pure-skip hides whether it recovered. |
| `Q-FF-DISMISS-COOLOFF` | What happens when a remediation/quarantine suggestion is dismissed? | **Snooze the cluster for a configurable cool-off before it may re-surface; an accept-and-apply closes the cluster.** | Prevents nagging on a deliberately-rejected fix while still letting a *recurrence* (post-close) re-open as a fresh cluster. |
| `Q-FF-REASONER-PHRASING` | May the one-shot reasoner phrase remediation bodies? | **Yes, optional, gated — phrasing only, never the detect/decide.** | Mirrors [02 §6] / [AI_QUALITY §5.2] (Assistant/reasoner enriches, never authorizes); keeps detection deterministic + free. |

---

## 6. Future build checklist (per-lane + verification)

**Prereq gate (do not start until these HORIZON deps land):** Addition #09 (per-stage commit `commitHash` + changed-file metadata) and the Tier-2 hardening doc (trigger run-ledger + `automation.failed`) must be authored and their data shapes pinned — they are §3.1 inputs.

**Lane B — Data / observability (the substrate):**
- [ ] Mint `FailureCluster` (append-only, tenant-scoped, keyed by `FailureSignature` hash) + the `FailureSignature` type (`kind`, `stageKind`, `key`). **Verify:** a pure-reducer unit test feeds an ordered batch of synthetic failure events and asserts the cluster's `occurrences`/`distinctTickets`/`lastSeenSeq` ([TESTING_STRATEGY §2.4] serial-loop pattern); re-feeding an event is a no-op (idempotent under lease).
- [ ] Add `flaky-test` to `FailureSignatureKind`; mint `TestQuarantine` (append-only, audited) or the `quarantinedTestIds` stage-config field per `Q-FF-QUARANTINE-HOME`. **Verify:** `types.ts` drift script ([TESTING_STRATEGY §5.3]) covers the new model; `runInTenant` isolation test (no cross-workspace cluster/quarantine).
- [ ] Confirm `FailureCluster` is correlated to `TicketEvent` by `seq` only, never merged ([OBSERVABILITY §6]). **Verify:** a test asserts no operator metric is written to `TicketEvent` and no `TicketEvent` body feeds the cluster — only `seq`-keyed counts.

**Lane A — Orchestrator (detection + proposal + the stage hook):**
- [ ] Implement `computeFailureSignature()` (deterministic, no model call) + the cluster upsert inside the existing serial signal-consumption loop ([02 §6]) — **no new loop/lease**. **Verify:** golden-input → golden-signature snapshot test (same input → same hash); a Conductor-matrix case ([TESTING_STRATEGY §2.2]) asserting a threshold-crossing cluster emits exactly one `propose_suggestion` and no direct write (B-23).
- [ ] Implement the deterministic `kind → remediation class` mapping (§3.2 table) → `WorkspaceSuggestion` with the right `type`/`patch` + a `Notification(ai-suggestion)`. Route `carryover-exhausted` through the [AI_QUALITY §4] `PromptVersion` candidate path. **Verify:** `VERB_REGISTRY` conformance still green ([TESTING_STRATEGY §5.2]) — no verb added; an RBAC test ([TESTING_STRATEGY §2.5]) that a Member accepting a `config-review` remediation is rejected, an Admin applies it.
- [ ] Wire the test/review stage to **read** the quarantine list: skip-but-report quarantined tests, gate pass/fail over non-quarantined only, surface a visible "N quarantined" section. **Verify:** a fake/replay `EngineDriver` ([TESTING_STRATEGY §3]) golden-ticket where a quarantined failing test does NOT block the stage but IS reported (extends the [AI_QUALITY §3.5] fixture set with a `GT-flaky` anchor).
- [ ] Add `quarantine-add` / `quarantine-release` to the `[control-API]` op catalogue (Admin+); ensure forensics only *proposes* them. **Verify:** auto-sweep ([TESTING_STRATEGY §7]) covers the new routes (contract/auth/rate-limit); a per-route `.tests.ts` asserts the route *enqueues* the Conductor action (never writes directly).

**Lane B/C — Surface (read-projection):**
- [ ] A forensics read-projection (a "Failure forensics" panel: clusters, occurrences, the `distinctTickets` count, the open remediation suggestion, the quarantine list). **Verify:** it derives purely from `FailureCluster` + `WorkspaceSuggestion` + `TestQuarantine`; renders the remediation as the standard accept/dismiss `WorkspaceSuggestion` card (no bespoke apply path).

**Cross-cutting verification (the B-23 acceptance bar):**
- [ ] **End-to-end, zero subscription turns:** a replay-lane test drives `3 distinct-ticket failures on the same dep → cluster → suggestion → human accept → Conductor applies → cluster closed`, asserting every write is a Conductor action and every proposal an existing verb. This is the single highest-leverage regression for the whole addition.

---

## 7. Citations

| Cited | What it grounds here |
|---|---|
| [`02_PROTOCOL_AND_FLOW §1`](../02_PROTOCOL_AND_FLOW.md) | the `stuck` status + status machine the failures originate from |
| [`02_PROTOCOL_AND_FLOW §6`](../02_PROTOCOL_AND_FLOW.md) | `WorkspaceSignal('stopped')`, `WorkspaceSuggestion`, `Notification`, the serial signal-consumption loop the clustering reuses, `propose_suggestion` |
| [`02b_PROTOCOL_ADDENDA §B`](../02b_PROTOCOL_ADDENDA.md) | the Stop-hook forced-reconciliation loop + `attempts` exhaustion — a `carryover-exhausted` signature source |
| [`02b_PROTOCOL_ADDENDA §D`](../02b_PROTOCOL_ADDENDA.md) | the `VERB_REGISTRY` no-write-verb guarantee this addition does not widen |
| [`features/24_PAUSE_AND_KILL_CONTROLS`](../features/24_PAUSE_AND_KILL_CONTROLS.md) | B-35 runaway → `stuck` → `needs-input` auto-escalation — the per-ticket reactive path this generalizes across tickets |
| [`OBSERVABILITY §1/§2/§6`](../OBSERVABILITY.md) | the log/metric substrate (`ws_watchdog_fires_total{reason}`, `ws_carryover_enforce_retries_total`) + the hard operator-vs-product stream boundary |
| [`TESTING_STRATEGY §2/§3/§5/§7`](../TESTING_STRATEGY.md) | the deterministic-Conductor reducer tests, the fake/replay `EngineDriver`, `VERB_REGISTRY` conformance, the test-stage + auto-sweep layering |
| [`AI_QUALITY_AND_EVALS §2.5/§3/§4/§5`](../AI_QUALITY_AND_EVALS.md) | the Test-stage prompt + verdict, the golden-tickets harness, the `PromptVersion` lane prompt remediations route through, the reject/edit feedback loop quality signals |
| [`04b §6`](../04b_DATA_MODEL_ADDENDA.md#6-ticketevent--the-append-only-event-log) | `TicketEvent` + monotonic `seq` (G2) — the primary clustering input + ordering key |
| [`04b §8`](../04b_DATA_MODEL_ADDENDA.md#8-workspacesuggestion--5-value-type--patch) | `WorkspaceSuggestion` 5-value `type` + `patch` — remediations reuse this, no new type; **propose a quarantine-evidence payload on the existing `patch`/`ticketIds`** |
| [`04b §10`](../04b_DATA_MODEL_ADDENDA.md#10-notification--pushsubscription) | `Notification(type:'ai-suggestion')` deep-link to a cluster |
| [`04b §11c`](../04b_DATA_MODEL_ADDENDA.md) / [`04b §12`](../04b_DATA_MODEL_ADDENDA.md#12-typed-stagekind--replacing-the-fixed-7-literal-stageid) | `runInTenant` isolation; `StageKind` (the signature's `stageKind`) |
| **Addition #09** (per-stage commit) | `commitHash` + changed-file set per stage — the `dependency-file` + same-commit flaky signals (sibling HORIZON dep) |
| **Tier-2 hardening** (trigger run-ledger, `automation.failed`) | the `automation-failed` signature source (sibling HORIZON dep) |
| [`REFERENCE_CODES`](../REFERENCE_CODES.md) | B-23, B-35, B-O6, G2, G8/G16, G24 |
| [`V1_SCOPE`](../V1_SCOPE.md) | HORIZON deferral posture — designed, not built in V1; V1_SCOPE wins on conflict |

---

*End of Addition 12 — Failure forensics. No new verbs. Detection is deterministic clustering over append-only logs (zero subscription turns); remediations are `WorkspaceSuggestion` proposals applied only on human accept via `[control-API]` → Conductor (B-23); flaky-test quarantine is a per-workspace, human-accepted, audited list the test/review stage reads. HORIZON — depends on Additions #09 + the Tier-2 hardening doc; not built in V1. Proposed DELTAs (`FailureCluster`/`FailureSignature` model, `flaky-test` signature kind, `TestQuarantine`/`quarantinedTestIds`, `quarantine-add`/`-release` control-API ops) are design-only, reconciled when those lanes open.*
