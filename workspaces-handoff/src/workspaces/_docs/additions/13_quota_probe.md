# Addition 13 — Real quota probe

> **Tier:** V1 (light) · **Lane:** A + B · **Status:** NEW (2026-06-11).
> **Pitch:** Poll the host `claude /usage` view as the AUTHORITATIVE fleet quota gauge so the advisory char-count budget becomes a real, quota-backed limit — with an admin-set threshold below which the Conductor auto-pauses NEW stage starts — without building a token meter.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #13. **FLAG:** this ledger file does not yet exist in `_docs/additions/` — create it (or fold these rows into whatever `00_*` ledger the additions set formalizes) when the set lands; this addition is #13 in it (same posture as additions 01/03/07, which already cite a not-yet-created `00_DECISIONS_LEDGER.md`).

---

## 1. The gap this closes (advisory char-count vs real subscription quota)

The entire cost story today is **advisory by design**. [01 §6] states it plainly: *"Budget (`SpendRecord`/`WorkspaceBudget`, B-35) is **advisory** on the subscription (the real limit is quota, not dollars). The cap + queue + suspend + self-handoff are the actual levers."* And the precision of that advisory number is itself soft — [P0_CLI_SPIKE §4] (Spike D, `Q-ENG-TOKENFEED`) resolves that in interactive PTY mode the per-turn usage source is *either* a hook-payload `usage` field *or*, failing that, a **labeled char-count estimate** derived from PTY bytes ([06 §4]). Spike D "never `RED`s into an ESCALATE" precisely because the char-count floor is always available — but that floor is an **estimate of dollars/tokens spent**, not a reading of **how much subscription quota remains**.

So there is a structural gap: the system tracks an *advisory spend estimate* (`SpendRecord.tokensIn/Out`, [04b §9], explicitly `// ADVISORY in PTY mode`), but it has **no reading of the one number that actually stops the fleet** — the Max subscription's rolling quota. When the subscription throttles, the orchestrator only learns *reactively*, after the fact: [01 §6]'s "Rate-limit → `stopped`" path trips on *"repeated retries / an explicit limit message in the stream,"* flipping the affected session to `stopped` (mapped to `stuck`, note "rate limit — subscription quota"). That is a **post-hoc** signal — the quota is already exhausted, work is already wedged, and the only recourse is backoff.

The gap this addition closes: turn the advisory estimate into a **proactive, authoritative gauge** by reading the same quota view a human reads — `claude /usage` — on a polling loop, so the Conductor can pause *before* the wall instead of bouncing off it. [features/19 §Deferred] flagged exactly this as missing: *"Hard quota surfacing (the subscription's actual rate-limit window) — advisory cost is shown; the real quota signal arrives as a `stopped` rate-limit state … not a budget number here."* This addition supplies that real quota signal.

It is deliberately **read-only on the AI side and storage-light**: the probe is a Conductor-side poll of an existing host view; it introduces **no new verb**, no model-callable surface, and (default) one transient gauge plus an optional metric snapshot. The authoritative reading then *feeds* the surfaces that already exist (the #08 vitals gauge, the `WorkspaceBudget` bar of [features/19]).

---

## 2. Locked decision (authoritative gauge + admin-configurable auto-pause)

**LOCKED:** *The `claude /usage` reading becomes the authoritative quota gauge, and an admin can set a threshold below which the Conductor auto-pauses NEW stage starts (running stages finish).*

| Facet | Decision |
|---|---|
| **What the probe reads** | The host `claude /usage` view — the **same** view [P0_CLI_SPIKE §1] Spike A1 uses to *verify* that an interactive PTY turn draws on the **subscription** (its before/after check). If A1 proves `/usage` reflects subscription draw, this addition promotes that same view from a one-off verification tool into a **standing gauge**. |
| **Authority** | The reading is the **authoritative quota gauge** — it supersedes the char-count estimate *as the quota signal*. The char-count estimate ([06 §4], `SpendRecord`) stays the **dollars/tokens spend** story; the probe is the **remaining-quota** story. They are complementary, not competing. |
| **Auto-pause** | An admin sets a **threshold** (e.g. "pause new starts below 15% quota remaining"). When the gauge crosses it, the Conductor **auto-pauses NEW stage starts**; **in-flight stages finish** (this is the `pauseNew` enforcement mode, [04b §9 D81], never `pauseAll`). |
| **Where the knob lives** | The **threshold + an on/off** live in **workspace settings** (admin-gated, [features/19 §"Budget settings"], B-28 Owner/Admin). |
| **Mechanism** | Auto-pause **reuses the existing pause path** — it is a Conductor action applied to NEW admissions in the **CapacityManager** admission gate ([07b §8]), expressed as the existing `pause`/`pause-all`-family [control-API] enqueue, **not** a new control surface. Ties into #11 (scheduler / Tier-2 slot mechanics) and #08 (vitals). |
| **Default cadence/scope** | A Conductor-side **interval poll**, run **once per host** (fleet-wide, not per-container), storing a **transient gauge** (optionally snapshotted to a metric). See §3.1 — this is the DEFAULT, flag if wrong. |
| **Degradation** | If [P0_CLI_SPIKE] finds `/usage` unreliable/unparseable, **degrade to the advisory estimate** and surface **"quota: estimated"** on the vitals + budget surfaces (§3.4). Never block on a probe that can't read. |

**DEFAULT — flag if wrong (this is the default the prompt told me to assume; I endorse it — see §4):**

- The probe is a **Conductor-side `setInterval`** poll of `claude /usage`, run **once per host** (the quota is a single fleet-wide subscription number — polling per-container would be N redundant reads of the same gauge **and** would each cost a PTY interaction, see §3.1 PTY-billing note).
- The reading is stored as a **transient in-memory gauge** on the Conductor (the live admission input), **optionally** snapshotted as a metric/observation for the vitals time-series (§3.2) — **not** a new per-turn persisted row (that's what `SpendRecord` already is, and this is not per-turn).
- Auto-pause **reuses** the [07b §8] CapacityManager admission gate + the [CONTROL_API §8] `pause`/`pause-all` enqueue path — **no new op is strictly required** (a quota-crossing is just another admission-denial reason); a thin **new `op:'quota-pause'`/`quota-resume'` pair** is offered as a sub-decision (§5, 13.s4) only if the admin needs an explicit, separately-RBAC'd manual override distinct from budget pause-all.
- The threshold + on/off are **per-workspace admin settings**, surfaced in the same [features/19] budget-settings form, RBAC'd via the existing B-28 Owner/Admin tier (no matrix change, mirrors [CONTROL_API §5] / D69).

> **Conflict check (Rule 3b).** One tension to name explicitly, on **both** sides:
> 1. **The probe is itself a `claude` interaction → it draws on the very subscription it measures (PTY-billing, §3.1).** This is real but *bounded*: one cheap `/usage` read per host per interval (default ≥60s) is negligible against a fleet of generating turns, and it MUST run **inside the subscription model** (an interactive PTY, clean env — [P0_CLI_SPIKE §1] A1/A2), never headless (which would meter the Agent-SDK pool and *also* read a different ledger, [01 §1]). I endorse the poll; §3.1 pins the constraint. If the spike shows `/usage` is expensive or rate-limited as a *command*, lengthen the interval / cache harder (§5, 13.s2) — do not headless it.
> 2. **[features/19 §Deferred] explicitly deferred "hard quota surfacing."** This addition *un-defers* a slice of it. That is a **conscious** deviation, not an accident: [features/19] deferred a *budget-number* rendering of quota; this addition adds a *gauge + admission gate*, which is the "real quota signal" [features/19] said was missing — it does **not** turn the advisory **dollars** budget into a hard pre-flight gate (that inversion stays parked for a future metered backend, [04b §9] `Q-MP-BILLING`, [MULTI_PROVIDER_SEAM]). The advisory **spend** budget remains advisory; only the **quota** reading becomes authoritative-and-enforced. I endorse the deviation as in-scope for V1-light because it adds a *projection + an admission reason*, not a new source of truth or a new meter.

---

## 3. Build-ready mechanics

### 3.1 The probe (Conductor interval poll of `claude /usage`; once per host; spike-gated)

The probe is a **Conductor-side loop** — the same actor that already runs the [01 §4] watchdog `setInterval` (stuck/idle/turn-cap) and is the single-instance lease-holder ([07 §A] / [CONTROL_API §3]: *"the Conductor is single-instance … drains under its lease"*). It is **not** a model-callable verb and **not** a per-container concern.

```
quotaProbe loop (Conductor, single-instance, once per host):
  every QUOTA_PROBE_INTERVAL (default 60s, §5 13.s2):
    reading = readUsageView()             # drive `claude /usage` in a host PTY, parse the gauge
    if reading.ok:
      gauge.set(reading)                  # transient in-memory authoritative gauge (§3.2)
      maybeSnapshotMetric(reading)        # optional time-series sample for #08 vitals
      evaluateThresholds(reading)         # §3.3 — per-workspace admin thresholds → admission
    else:
      gauge.degrade('estimated')          # §3.4 — fall back to advisory estimate, label it
```

**How `/usage` is driven (PTY-billing constraint — load-bearing).** The reading MUST come from the subscription model, the way [P0_CLI_SPIKE §1] verifies it:

- Drive `/usage` as an **interactive slash command in a PTY** (node-pty), spawned with a **clean env** — no `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`apiKeyHelper` ([01 §1], Spike A1 procedure; A2 hard-confirms a stray key flips billing/ledger). A headless `claude -p` read is **forbidden** here for the same reason it is forbidden for throughput ([01 §1], [P0_CLI_SPIKE §0]): it meters the separate Agent-SDK pool *and* would read a different quota ledger than the one the fleet's interactive turns draw on. **The probe must itself run within the subscription model** — it reads the gauge it lives under.
- **Once per host, not per container.** The quota is one fleet-wide subscription number (the same number Spike A3 confirms *all* concurrent PTYs bill against). One host-side reader is correct; a per-container probe would be N redundant reads, each a billable PTY interaction, all reporting the same gauge.
- **Cheap and infrequent by default.** Default interval ≥60s (§5 13.s2). The `/usage` interaction is a tiny, near-zero-generation turn; at one read/host/minute it is negligible against `MAX_ACTIVE_TURNS` (~4–8, [07b §8.1]) generating turns. If the spike shows otherwise, lengthen the interval — never headless it.

**Spike-gated.** This addition's runtime correctness **depends on a [P0_CLI_SPIKE] result**: Spike A1 already exercises "inspect the subscription usage view (host `claude` `/usage` or account dashboard) before/after." For this addition to read `/usage` *programmatically as a standing gauge* it needs the parse to be stable. **Proposed spike delta (flag — does not edit [P0_CLI_SPIKE] here, Report-Without-Auto-Fixing):** add a row to Spike A (or a small Spike A4) — *"the `claude /usage` view is machine-parseable into a remaining-quota gauge (a stable field/format, not just a human-readable screen), and reading it is itself a cheap, subscription-billed, non-throttling interaction."* If that row is `GREEN`, the probe is authoritative; if `RED`/unreliable, §3.4 degradation applies. This mirrors how Spike D's verdict *labels the source* rather than blocking.

### 3.2 Feeding budget + vitals (cite 04b §9, features/19, #08)

The gauge is an **input**, fanned to the two surfaces that already render quota/spend — it does **not** create a third cost surface.

**Vitals (#08).** The probe's reading is the **authoritative quota gauge** the #08 vitals surface renders — the live "quota remaining" dial + (optionally) a short time-series from the `maybeSnapshotMetric` samples. #08 already owns the fleet-health gauges; this addition supplies the **quota** datum it was missing (previously only inferable from the reactive `stopped` rate-limit state, [01 §6]). **FLAG:** addition #08 (vitals) is a sibling in this not-yet-fully-written additions set; this addition *produces* the gauge #08 *consumes* — confirm the field name/shape when #08 lands (sub-decision 13.s5).

**Budget ([features/19] + [04b §9]).** The probe **does not** change the `SpendRecord`/`WorkspaceBudget` *spend* model:

- `SpendRecord` ([04b §9]) stays the per-turn **advisory** spend fact (`tokensIn/tokensOut` `// ADVISORY in PTY mode`, fed from hook-usage or char-count per Spike D). The probe writes **no** `SpendRecord` — it is not per-turn and not a dollar number.
- `WorkspaceBudget` ([04b §9], multi-row, D81/D82) stays the **advisory dollar caps**. The probe is a **separate, quota-remaining** reading. On the [features/19] budget surface it renders as a **distinct gauge** next to the dollar bar, replacing the existing advisory note *"the hard limit is your plan quota"* with an **actual quota figure** when the probe is `GREEN` (the note becomes live data, not a caveat). The [features/19] §"Mockup hint" budget bar gains a sibling **"quota: NN% remaining"** line; when degraded it reads **"quota: estimated"** (§3.4).
- **Reuse, not a parallel model.** Where [04b §9]'s `WorkspaceBudget.periodWindow` already supports `{ rolling: '5h' }` to *express* Claude's native window (D82), the probe is what makes that window **observable** rather than just declarable. If a workspace runs a `{ rolling: '5h' }` cap, the probe's reading is the natural data behind it — but the **quota-pause** of §3.3 is keyed off the **probe gauge + admin threshold**, independent of the dollar caps, so the two enforcement paths never fight (a dollar cap fires `pauseNew`/`pauseAll` per D81; the quota probe fires `pauseNew` of admissions — both land as the same Conductor pause action, §3.3).

### 3.3 Auto-pause of NEW starts (CapacityManager; admin threshold; cite 07b §8, CONTROL_API)

Auto-pause is **not a new mechanism** — it is one more **admission-denial reason** in the [07b §8] **CapacityManager** gate, expressed through the **existing** [CONTROL_API] pause path. This honors B-23 (Conductor is the only writer) and adds no protocol surface.

**The admission hook.** [07b §8.2] already gates every container/turn launch under the lease:

```
admit(request):                                  # [07b §8.2], unchanged shape
  if quotaGateClosed(request.workspaceId):       # NEW reason, evaluated first
     enqueue(request)                            # hold the NEW start; do NOT reject — [07b §8.2] "queue, never hard-reject"
     notify(once, 'quota-pause')                 # B-34, the user sees a queue/pause note
     return
  if residentCount < MAX_RESIDENT and ramHeadroom > watermark:
     launch()
  else:
     victim = oldestPausedOrIdle(); if victim: reclaim(victim); launch()
     else: enqueue(request)

quotaGateClosed(wsId):
  s = workspaceSettings(wsId).quotaPause          # §3.3 admin settings
  return s.enabled and gauge.remaining <= s.threshold
```

- **NEW starts only; in-flight finishes.** The gate sits on **admission** — a turn/stage that already holds a slot ([07b §8.1] "a turn holds a slot, released on the Stop hook") runs to its `Stop`. This is precisely the [04b §9 D81] **`pauseNew`** semantics ("block newly-starting sessions, let in-flight stages finish") — the quota gate IS a `pauseNew`, sourced from the probe instead of a dollar cap. **Never `pauseAll`** (that would kill running work mid-turn over a *remaining-quota* reading, which is exactly what finishing-in-flight avoids).
- **Queue, never hard-reject.** Consistent with [07b §8.2] D87 / B-34: a quota-gated start **waits in the FIFO** and a `Notification` informs the user; when the probe later reads back above threshold (quota window rolled, or admin resumed), the queued admissions drain normally. This dovetails with #11 (scheduler / Tier-2 slot mechanics): the quota gate is an additional pre-condition on the **same** FIFO/slot admission #11 governs — it does not introduce a second scheduler.
- **It's a Conductor action via [control-API], not a direct write.** The auto-pause is the Conductor reacting to its own gauge — analogous to [04b §9]'s *"enforcement is a [control-API] action"* and [CONTROL_API §7]'s automation note: *"on budget cap → pause all … request the same `pause`/`notify` control-API action … they do not write directly."* The quota gate is the same pattern with a quota trigger instead of a budget-cap trigger. Reuses the [CONTROL_API §8] `pause`/`pause-all`/`resume-all` family (sub-decision 13.s4 weighs adding an explicit `quota-pause`/`quota-resume` op vs. overloading the existing reason code).

**Admin settings (the knob).** Two fields, in the [features/19 §"Budget settings"] form, admin-gated (B-28 Owner/Admin, mirroring the existing budget-settings RBAC, no matrix change):

- `quotaPause.enabled: boolean` — the on/off toggle.
- `quotaPause.threshold` — the remaining-quota floor below which NEW starts pause (e.g. `15` for 15% remaining, units matching the probe's gauge — §5 13.s5).

Editing them is a [control-API] `edit-budget`-adjacent request ([CONTROL_API §8] `raise-cap`/`edit-budget` row; sub-decision 13.s4 on whether it's a payload field on `edit-budget` or a sibling op) → `preApiExecute` config RBAC (D30) → enqueue → Conductor persists. **Persistence:** these two fields hang off `WorkspaceBudget` or a small `Workspace.quotaPause` Json — see §5 13.s1 (the DEFAULT is a `Workspace`-level pair, since quota is fleet/subscription-wide, not per dollar-cap).

### 3.4 Degradation if `/usage` unreliable (P0_CLI_SPIKE)

The probe **never blocks the fleet on its own failure** — degradation mirrors [P0_CLI_SPIKE §4]'s "this spike never `RED`s into an ESCALATE; the char-count heuristic is always the floor."

| Probe state | Gauge authority | Auto-pause | Surface label (#08 + features/19) |
|---|---|---|---|
| **`GREEN`** (Spike row green, parse stable) | **Authoritative** — real remaining-quota reading | Active — `quotaGateClosed` evaluates the real gauge | **"quota: NN% remaining"** (live) |
| **Unreliable / unparseable / read fails** | **Degraded** — fall back to the advisory char-count estimate ([06 §4]) as a *proxy* gauge | **Disabled for the quota reason** — `quotaGateClosed` returns `false` (never pause on an estimate); the existing reactive `stopped` rate-limit path ([01 §6]) remains the backstop | **"quota: estimated"** (explicit, never silently shown as real) |

- **Why disable auto-pause when degraded:** pausing NEW starts is a real intervention; doing it off an *estimate* would pause work on a guess. The reactive [01 §6] "Rate-limit → `stopped`" path already protects against actual exhaustion, so degraded mode loses only the *proactive* gate, not the safety net. (Admins can still set dollar `WorkspaceBudget` caps, which never depended on the probe.)
- **The label is mandatory** (no silent downgrade): per the prompt's locked degradation, a degraded gauge MUST read **"quota: estimated"** on every surface that shows it, so no one mistakes an estimate for the authoritative reading. This is the same discipline Spike D bakes in: *"record which one … so consumers inherit the right precision caveat."*
- **Recovery:** if the spike result is later upgraded (e.g. a new pinned CLI version, [P0_CLI_SPIKE §6] `Q-CT-CLIPIN`, exposes a parseable `/usage`), the gauge flips back to authoritative with no schema change — it is a transient gauge, not migrated state.

---

## 4. Invariants honored

| Invariant | How this addition honors it |
|---|---|
| **B-23 — Conductor is the only writer** | The probe is a **Conductor-side** loop; the gauge is Conductor memory; auto-pause is a **Conductor** action enqueued via [control-API] ([CONTROL_API §7], [04b §9] "enforcement is a [control-API] action"). No client, no agent, writes anything. |
| **FROZEN verbs** ([02 §2]: 7 worker + 6 assistant, all read/propose) | **Zero new verbs.** The probe is not model-callable; `/usage` is read by the Conductor in a host PTY, never by a worker via a structured-channel verb. **Auto-pause is a Conductor action, not a verb** (the prompt's explicit framing — it reuses the [control-API] pause path). |
| **`runInTenant` mandatory** ([04b §11c]) | The probe is **fleet-wide** (one host gauge) but every *consequence* it triggers — per-workspace threshold evaluation, the `quota-pause` admission hold, the `Notification`, reading `workspaceSettings` — runs under `runInTenant`, exactly as [CONTROL_API §7]'s background-automation note requires ("every such orchestrator-side path runs under `runInTenant`"). |
| **PTY-billing** (interactive node-pty; the probe runs within the subscription) | The `/usage` read is driven as an **interactive PTY slash command, clean env** ([01 §1], [P0_CLI_SPIKE §1] A1/A2) — **the probe itself bills the subscription it measures**, never headless (which would meter the Agent-SDK pool and read a different ledger, [01 §1], [P0_CLI_SPIKE §0]). Once-per-host, ≥60s, negligible cost (§3.1). |
| **LuckyStack conventions** | Settings UI reuses [features/19]'s budget-settings form ([01 §components], `WsButton`/`Toggle`); i18n via `useTranslator` (Rule 13) for the "quota: NN% remaining"/"quota: estimated" labels; Tailwind tokens only from `index.css` `@theme` (Rule 14) for the gauge tones; `_api` `edit-budget`-family route is typed `apiRequest`, no `as any` (Type-Generation contract). |
| **V1_SCOPE wins** | Light, fits the V1 [07b §8] CapacityManager (which V1 already builds, [V1_SCOPE §3.4]) + the [04b §9] budget model (V1, [V1_SCOPE "Data/tenancy"]). Adds an **admission reason + a gauge + two admin fields**, not a new subsystem. No built-in-forge/MR/CI dependency; the [04b §18] DEFERRED set is untouched. |
| **Advisory-stays-advisory** ([01 §6], [04b §9] `Q-MP-BILLING`) | The dollar `WorkspaceBudget` stays **advisory**; only the **quota reading** becomes authoritative-and-enforced. The metered-backend hard-`blockTurn` inversion stays parked ([MULTI_PROVIDER_SEAM]). This addition does **not** pre-shape the metered fields. |

---

## 5. Open sub-decisions (DEFAULTs)

| # | Sub-decision | DEFAULT (proceed unless flagged) |
|---|---|---|
| 13.s1 | **Where the `quotaPause` threshold + on/off persist.** | A **`Workspace.quotaPause: Json` `{ enabled, threshold }`** pair (quota is fleet/subscription-wide, so it sits at workspace level beside the [04b §13] field-sweep adds like `assistantTokenBudget`), **not** on a per-`WorkspaceBudget` dollar-cap row. The gauge itself is **transient** (in-memory), not persisted. |
| 13.s2 | **Probe interval.** | `QUOTA_PROBE_INTERVAL = 60s` default (env/config-tunable). Lower bound gated by the §3.1 spike: if `/usage` reads are non-trivial in cost or throttle, lengthen — never go sub-30s. |
| 13.s3 | **Snapshot the reading to a metric or keep purely transient?** | Snapshot a **lightweight time-series sample** (for the #08 vitals trend) at a coarser cadence (e.g. every 5 min or on threshold-crossing), via the existing observability/metric path ([OBSERVABILITY]) — **not** a `SpendRecord` row (wrong grain). The live admission input is always the in-memory gauge. |
| 13.s4 | **Explicit `quota-pause`/`quota-resume` op vs. overloading the existing pause path.** | **Default: no new op.** A quota-crossing is an internal **admission reason** ([07b §8.2] `quotaGateClosed`) using the existing `pause`/`resume-all` mechanics; the admin *threshold edit* rides the existing `edit-budget` op as a payload-field add (mirrors addition 01's "payload-field addition to an existing op, not a new op", [CONTROL_API §8] "add rows here, never new verbs"). **Add** a `quota-resume` op only if product wants a manual "resume despite low quota this window" override distinct from budget `resume-spend` — flag at build time. |
| 13.s5 | **The gauge's UNIT.** | Whatever `claude /usage` exposes as the primary remaining-quota figure (percentage-remaining preferred; absolute if that's all it gives). The admin `threshold` is in the **same unit**. **Pin the unit from the §3.1 spike row** before wiring #08's dial / the [features/19] line — do not assume `%` until the spike confirms the field. |
| 13.s6 | **Multi-tenant fairness of one fleet gauge.** | V1: the quota gate is **per-workspace-threshold over one shared fleet gauge** — every workspace sees the same remaining-quota number and applies its own floor. **No per-workspace quota *partitioning*** (the subscription is one pool). If one workspace should be starved before another, that's a **scheduler** concern (#11 priority/fairness), not the probe's — flag to #11, do not build a per-tenant quota split here. |
| 13.s7 | **What the gauge reads if multiple subscriptions/hosts exist later.** | V1 is **single self-hosted host, one subscription** ([V1_SCOPE]). One host probe = one gauge. Multi-host/multi-subscription fan-in is **out of V1** — revisit with [ARCHITECTURE_MULTI_INSTANCE] if the fleet ever spans hosts. |

---

## 6. Build checklist (per-lane + verification)

**Lane A (engine / Conductor) — the probe + admission gate.**

- [ ] **`quotaProbe` loop** on the Conductor (single-instance, under the lease) — drive `claude /usage` in a host PTY (clean env, [01 §1]), parse → in-memory `gauge`. Once per host. Default `QUOTA_PROBE_INTERVAL=60s`.
  - *Verify:* a test asserts the loop runs only on the lease-holder (not on web-app instances); a parse-fixture test turns a captured `/usage` output into a `{ remaining, unit }` gauge; an env override changes the interval.
  - *Verify (billing):* the spawn uses a **scrubbed env** (no `ANTHROPIC_*`/`apiKeyHelper`) — assert the spawn options, mirroring [P0_CLI_SPIKE §1] A2's clean-env constraint. Headless (`-p`) is **never** used (grep the probe path).
- [ ] **`quotaGateClosed(wsId)` + admission hook** in the [07b §8.2] CapacityManager `admit()` — evaluated first, **enqueue (never reject)** on a closed gate, fire a once-per-episode `Notification` (B-34).
  - *Verify:* a test drives `admit()` with `gauge.remaining ≤ threshold` and asserts the NEW start is **queued, not launched**, and an **in-flight** session (already holding a slot) is **untouched** until its `Stop` (the `pauseNew` semantic, [04b §9 D81]); a follow-up test with the gauge back above threshold drains the queue.
- [ ] **Auto-pause via the existing [control-API] pause path** — confirm the gate enqueues a Conductor `pause`/admission-hold signal, **not** a direct write (B-23).
  - *Verify:* `git diff` shows the gate appends a `WorkspaceSignal`/uses the existing pause action; it does **not** mutate `AgentSession.status` or a container inline ([CONTROL_API §7]).

**Lane B (data / budget) — settings, gauge plumbing, surfaces.**

- [ ] **`Workspace.quotaPause` `{ enabled, threshold }`** persisted field (13.s1) + the [features/19 §"Budget settings"] form fields (toggle + threshold number), admin-gated (B-28, no matrix change). Edit rides `edit-budget` (13.s4 default).
  - *Verify:* a Member sees the fields read-only; an Owner/Admin can set them; the [control-API] edit enqueues → Conductor persists (auto-sweep RBAC contract-test, [ARCHITECTURE_TESTING]).
  - *Verify:* `.env_template`/`.env.local_template` updated if `QUOTA_PROBE_INTERVAL` is env-driven (Rule 17).
- [ ] **Feed #08 vitals + [features/19] budget surface** from the gauge — the live "quota: NN% remaining" reading (authoritative) / the optional time-series sample (13.s3).
  - *Verify:* the [features/19] budget card shows the live quota line when `GREEN`; the #08 gauge renders the same datum (confirm the shared field name when #08 lands, 13.s5). i18n keys for both labels (Rule 13); tokens-only tones (Rule 14).
- [ ] **Degradation path** (§3.4): on probe failure, gauge → `estimated`, auto-pause disabled for the quota reason, surfaces read **"quota: estimated"**.
  - *Verify:* a test forces a parse failure and asserts (a) `quotaGateClosed` returns `false`, (b) both surfaces render the **"estimated"** label, (c) the reactive [01 §6] `stopped` rate-limit backstop is unaffected.

**Cross-lane / spike verification (gating, no work owned here):**

- [ ] **[P0_CLI_SPIKE] row for machine-parseable `/usage`** (the proposed §3.1 Spike A4 delta) is `GREEN` before the probe is treated as authoritative. Until then the addition ships in **degraded/estimated** mode (the gate is off). **Flag to the spike owner** — this addition does not edit [P0_CLI_SPIKE].
  - *Verify:* the pinned CLI version ([P0_CLI_SPIKE §6] `Q-CT-CLIPIN`) the spike ran against is the one baked into the host the probe runs on (the probe parses a *pinned* `/usage` format, not `@latest`).
- [ ] **#08 (vitals) gauge field/shape** confirmed when #08 lands (13.s5); **#11 (scheduler)** confirmed that the quota gate is an additional admission pre-condition on the **same** FIFO it governs, not a second scheduler (§3.3).
- [ ] `npm run lint && npm run build` clean (Rule 11); the diff touches the Conductor probe/admission path, the `Workspace.quotaPause` field + [features/19] settings form, the #08/budget gauge wiring, and the translator catalog — **no new verb, no new model, no `SpendRecord` change.**

---

## 7. Citations

- **[01_ARCHITECTURE.md §6]** — concurrency & cost on one subscription: budget is **advisory**, *"the real limit is quota, not dollars"*, cap+queue+suspend+self-handoff are the levers; the reactive **"Rate-limit → `stopped`"** path (the post-hoc quota signal this addition front-runs); **"Never headless for throughput."** **§1** — interactive-PTY-on-subscription vs metered headless/Agent-SDK; the clean-env requirement (the PTY-billing constraint the probe inherits). **§4** — the Conductor watchdog `setInterval` (the loop the probe parallels). **§3.3** — Conductor is the only writer (B-23).
- **[P0_CLI_SPIKE.md]** — **§1 Spike A1** drives the host `claude /usage` view to *verify* a PTY turn bills the subscription (the same view this addition promotes to a standing gauge); **A2** the clean-env / stray-key billing constraint; **A3** concurrent PTYs all bill the one subscription (the fleet-wide gauge premise); **§4 Spike D** (`Q-ENG-TOKENFEED`) per-turn usage = hook-payload OR labeled char-count estimate, "never `RED`s into ESCALATE", the floor + label discipline this addition's degradation mirrors; **§0/§1** no-headless escalation rule; **§6** `Q-CT-CLIPIN` pinned-CLI (the probe parses a pinned `/usage` format). *Proposed (un-applied) delta: a machine-parseable-`/usage` spike row (§3.1).*
- **[04b_DATA_MODEL_ADDENDA.md §9]** — `SpendRecord` (`tokensIn/tokensOut` **`// ADVISORY in PTY mode`**, the spend fact the probe does **not** touch) + multi-row `WorkspaceBudget` (D81 `enforcement: pauseNew|pauseAll` — the **`pauseNew`** semantic the quota gate reuses; D82 `periodWindow {rolling:'5h'}` the probe makes observable); *"enforcement is a [control-API] action … advisory-then-pause"*; `Q-MP-BILLING` (advisory-stays-advisory until a metered backend; not pre-shaped here). **§13** — `Workspace.*` field-sweep (where `quotaPause` sits, 13.s1).
- **[features/19_USAGE_AND_BUDGET.md]** — the budget bar + **budget-settings form** (cap / alert-% / auto-pause toggle — where the quota threshold+on/off join) + RBAC (Owner/Admin, B-28); enforcement modes **`pauseNew`/`pauseAll`** (D81); **§Deferred "Hard quota surfacing … the real quota signal arrives as a `stopped` rate-limit state … not a budget number here"** — the exact gap this addition closes; the advisory note *"the hard limit is your plan quota"* that becomes live data.
- **[07b_CONTAINER_RUNTIME.md §8]** — the **CapacityManager** admission gate (`admit()`, §8.2) the quota gate plugs into; `MAX_ACTIVE_TURNS`/`MAX_RESIDENT` caps (§8.1, the slot a turn holds, released on `Stop`); **"queue, never hard-reject"** + D87 reclaim (the `pauseNew` queue behavior); "Admission/reclaim are [control-API] Conductor actions … not a protocol surface."
- **[CONTROL_API.md]** — **§8** the `pause`/`pause-all`/`resume-all`/`raise-cap`/`edit-budget` op catalogue the auto-pause + threshold-edit reuse (and "add rows here, never new verbs"); **§7** the enqueue-not-write contract + the automation note *"on budget cap → pause all … request the same control-API action … do not write directly"* + `runInTenant` for every background path; **§5** `preApiExecute` + WorkspaceRole RBAC (D69/D30); **§4** levers are human-requested control-API, never AI verbs.
- **Siblings (this additions set):** **#08 (vitals)** — consumes the authoritative gauge this addition produces (field/shape TBD, 13.s5); **#11 (scheduler / Tier-2 slots)** — the FIFO/slot admission the quota gate adds a pre-condition to (not a second scheduler, §3.3 / 13.s6). **[DECISIONS_LEDGER #13]** — to be created with the additions set (flagged in the header).
