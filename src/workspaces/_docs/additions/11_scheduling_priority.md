# Addition 11 — Scheduling: priority + next-ticket picker

> **Tier:** HORIZON (designed, not built in V1) · **Lane:** A (orchestrator) + B (data) · **Status:** NEW (2026-06-11).
> **Pitch:** Add a small `Ticket.priority` enum and make the CapacityManager admission path deterministically pick the **highest-priority, then oldest** queued (ticket,stage) turn when a slot frees — replacing today's implicit "whoever's signal lands first" FIFO.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #11. *(Ledger not yet created; this addition is its first entry — create the file with row #11 when the ledger lands.)*

---

## 1. The gap this closes

Concurrency today is a flat FIFO. [`01 §6`](../01_ARCHITECTURE.md) caps simultaneous generation at `MAX_CONCURRENT_ACTIVE` (default ~4) and **queues the excess in a Redis FIFO** — "a worker shows `idle`+'queued' until a slot frees." [`07b §8.2`](../07b_CONTAINER_RUNTIME.md) restates the same admission gate (`Q-CT-CAPACITY`): when nothing is reclaimable the request is **enqueued, never hard-rejected**, and drained in arrival order.

The consequence: **arrival order, not business value, decides what runs next.** When 4 slots are full and a slot frees, the FIFO hands it to whatever was enqueued earliest — even if a critical hotfix ticket was activated thirty seconds later and is sitting behind three chores. There is no lever for "do this one first." The user's only workaround is the heavy ones — `pause`/`kill` something already running to free a slot manually ([`CONTROL_API §8`](../CONTROL_API.md)). That's a blunt instrument and it loses work.

This addition gives the queue an **ordering key with intent**: a priority field on the ticket plus a deterministic picker so the *next* admitted turn is the most important admissible one, not merely the oldest.

---

## 2. Locked decision (priority + next-pick only; deadlines/SLA/business-hours OUT)

**LOCKED scope — build exactly two things, nothing more:**

1. **`Ticket.priority`** — a small enum (`low | normal | high | urgent`, default `normal`), set via a control-API op, surfaced read-only on the board card and backlog row.
2. **A deterministic next-ticket picker** inside the CapacityManager admission path: when a slot frees, among the **admissible** queued `(ticketId, stageId)` work items, pick **highest priority, then oldest enqueue order (FIFO tie-break)**. No LLM. This replaces/augments the flat FIFO of [`01 §6`](../01_ARCHITECTURE.md) and the arrival-order drain of [`07b §8.2`](../07b_CONTAINER_RUNTIME.md).

**Explicitly NOT in this addition (further-future, do not spec here):**

- **Deadlines / due-dates / SLA timers** — no time-to-deadline weighting, no countdown, no escalation-on-overdue. A `Ticket.dueAt` + an aging boost is a *separate, later* addition; it would layer a time term onto the picker's sort key but is out of scope now.
- **Business-hours awareness** — no "only run urgents overnight", no calendar/working-window gating of admission. Out.
- **Preemption** — the picker chooses among *queued* work when a slot frees; it does **not** evict a running lower-priority turn to admit a higher one. Non-preemptive only (see §5 sub-decision SD-3).
- **Per-priority concurrency reservations** (e.g. "always keep one slot for urgent") — out (SD-4).

> **DEFAULT — flag if wrong:** the prompt proposed precisely the shape above (small enum on `Ticket`; deterministic policy in the CapacityManager admission path; highest-priority-then-oldest; no LLM; set via control-API; surfaced in backlog/board). **This addition adopts it verbatim — no deviation.** Two surfaced reconciliations the implementer must honor (neither changes the decision):
> - **(a)** [`01 §6`](../01_ARCHITECTURE.md) names the cap `MAX_CONCURRENT_ACTIVE`; [`07b §8.1`](../07b_CONTAINER_RUNTIME.md) names it `MAX_ACTIVE_TURNS` (with `MAX_RESIDENT` as the *container*-residency cap). They are the **turn-admission cap** under two names; the picker orders the **turn queue** that this cap gates, NOT the resident-container queue. Cite both; do not introduce a third name.
> - **(b)** [`CONTROL_API §8`](../CONTROL_API.md) has **no `set-priority` row** today. This addition **proposes a new catalogue row** (§3.3) — it is a control-API op (a Conductor write), never a new structured-channel verb (B-23 / FROZEN verbs honored).

---

## 3. Design-grade mechanics

### 3.1 Priority data model (cite/propose 04/04b)

[`04 §3`](../04_DATA_MODEL.md) ("Fields to extend on existing models") lists `Ticket` as **"(none new server-side)"** — `carryOver`/`needsInput` already present. [`04b §13`](../04b_DATA_MODEL_ADDENDA.md) (the Resolved-decision field sweep) carries the current `Ticket` additive columns: `archived`, `lastActivityAt`, `creatorId`, `assigneeId`, `mrUrl`, `issueUrl`. **None is a priority.** So this is a genuine new field.

**PROPOSED DELTA — add one `Ticket` column + one prototype field:**

```prisma
// addition to model Ticket  (real schema; @map _id ObjectId, workspaceId tenant-scoped per 04 §4)
priority   String   @default("normal")   // 'low' | 'normal' | 'high' | 'urgent'  (Addition 11)
@@index([workspaceId, status, priority])  // supports the admissible-queue scan + backlog sort
```

- **Prototype mirror** (`src/workspaces/_data/types.ts`, the `Ticket` interface): add `priority: TicketPriority` with `type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';`. Ships as a typed contract before any backend (mirrors the [`04 §5`](../04_DATA_MODEL.md) "types only, no behavior" migration pattern).
- **Why an enum string, not an `Int` rank:** LuckyStack convention favors readable enums (small union over magic numbers); the picker maps the enum to an ordinal at sort time (`urgent=3, high=2, normal=1, low=0`). A free `Int` rank invites drag-to-reorder, which [`13 §Deferred`](../features/13_BACKLOG_AND_SPRINTS.md) explicitly forbids ("Drag-to-reorder / manual backlog ranking — order is pipeline/AI-owned + sort-derived, never hand-ranked"). The enum keeps ordering **policy-derived**, not hand-ranked — staying inside that decision.
- **Tenancy / append-only:** `Ticket` is a mutable tenant-scoped model (not in the append-only set of [`04b §append-only`](../04b_DATA_MODEL_ADDENDA.md)), so `priority` is an in-place field; each change is a normal Conductor write that *also* appends a `TicketEvent` for the audit log (§3.3). Cascade-delete already covers `Ticket` ([`04b §workspace-teardown`](../04b_DATA_MODEL_ADDENDA.md)).
- **04b §13 field-sweep row to add:** `| Ticket.priority | Ticket | String @default("normal") | Addition 11 | scheduler sort key + board/backlog surface |`.

### 3.2 The next-ticket picker policy (cite 01 §6, 07b §8; interplay with slot-release + staged resumeAll)

The picker is a **pure deterministic comparator** the CapacityManager consults at the moment a turn-slot frees — it is *not* a new component, just the ordering function applied to the existing queue. It lives in the orchestrator (Lane A), runs **under the Redis lease** like the rest of admission ([`07b §8.2`](../07b_CONTAINER_RUNTIME.md)), and wraps in `runInTenant(workspaceId, …)` per the mandatory Security rule ([`04 §4`](../04_DATA_MODEL.md), `Q-SEC-RUNINTENANT`).

**The change to [`07b §8.2`](../07b_CONTAINER_RUNTIME.md)'s admission pseudocode** — only the *dequeue* step changes; `admit()` is untouched:

```
# today (07b §8.2 / 01 §6): drain is implicit FIFO
onSlotFree():
  next = queue.dequeueOldest()          # arrival order
  admit(next)

# Addition 11: order the admissible set, then take the best
onSlotFree():
  candidates = queue.filter(isAdmissible)        # see "admissible" below
  next = candidates
           .sortBy(priorityOrdinal(ticket), DESC)  # urgent > high > normal > low
           .thenBy(enqueuedAt, ASC)                 # FIFO tie-break — preserves today's fairness within a band
           .first()
  if next: admit(next)                  # admit() itself unchanged: resident-cap + RAM watermark + reclaim-before-reject (D87)
  # else: nothing admissible → leave slot, a Notification already informs (B-34)
```

- **"Admissible"** = the work item can actually run right now: its `(ticketId, stageId)` is not blocked on an open `QuestionSet` (`needs-input`, [`04 §2`](../04_DATA_MODEL.md)), not `paused`/`killed`, its container is reclaimable-or-warm within `MAX_RESIDENT` ([`07b §8.1`](../07b_CONTAINER_RUNTIME.md)), and it isn't rate-limit-parked ([`01 §6`](../01_ARCHITECTURE.md) → `stopped`). **Priority never overrides admissibility** — an `urgent` ticket waiting on a human answer does not jump ahead of a runnable `normal` one; it isn't a candidate at all until its question is answered.
- **Determinism:** priority-then-`enqueuedAt` is a total order (the `enqueuedAt`/signal-`seq` tie-break is unique), so the picker is fully deterministic — no LLM, no randomness, reproducible from the queue state. This satisfies the "deterministic Conductor is the only writer/coordinator" floor ([`01 §3.3`](../01_ARCHITECTURE.md)): the picker is Conductor/CapacityManager logic, plain TypeScript.
- **Starvation note (SD-2):** strict priority-first **can** starve `low` work under sustained `urgent` inflow. V1-of-this-addition ships strict-priority for simplicity (default); an optional aging term (boost `enqueuedAt` weight as a queued item ages) is the documented escape hatch in §5 — but **deadlines/SLA are NOT that** (those are out, §2). Aging is purely queue-age fairness, no wall-clock due-date.

**Interplay with the Tier-2 hardening fixes** (reference-only — those are separate concepts this picker must compose with cleanly):

- **Slot-release on `needs-input`.** The Tier-2 "release the active-turn slot when a session parks on `needs-input`" fix means a parked turn **stops holding its slot**, so a slot frees the moment an agent asks a question — which is exactly when this picker runs `onSlotFree()`. The two compose: slot-release *creates* the admission opportunity; the priority picker *chooses* who takes it. A re-answered question re-enqueues the item, which then competes on priority like any other candidate (it does **not** get an automatic head-of-line resume — that's SD-1).
- **Staged `resumeAll`.** On orchestrator boot, [`07b §9.2`](../07b_CONTAINER_RUNTIME.md)'s `resumeAll()` re-associates surviving sessions; the Tier-2 "staged resumeAll" concept admits them **in controlled waves** rather than all at once. The picker is the natural ordering for those waves: **re-admit by priority-then-age**, so after a crash the most important in-flight tickets resume first within the `MAX_ACTIVE_TURNS` budget. `resumeAll` feeds its to-resume set through the *same* comparator (§3.2) — one ordering function, two callers (`onSlotFree` + boot-time staged resume).

### 3.3 Setting priority (control-API; surfaced in backlog/board)

**Setting priority is a [`control-API`](../CONTROL_API.md) write — a Conductor action, never an LLM verb** (B-23, FROZEN verb surface untouched). It is *not* routed through propose→accept (it's a direct user lever, like `bulk-status`), and it is *not* a structured-channel verb.

**PROPOSED DELTA — add one row to the [`CONTROL_API §8`](../CONTROL_API.md) catalogue:**

| `op` | Target | RBAC (§5) | Conductor action | Owning doc |
|---|---|---|---|---|
| `set-priority` | `{ ticketId }` *or* `{ ticketIds[] }` | work-on-tickets (D69) | set `Ticket.priority`; append `TicketEvent`; re-sort the admissible queue (no eviction) | Addition 11, [13], [12] |

- **Transport / contract:** identical to every other op ([`CONTROL_API §3/§6/§7`](../CONTROL_API.md)) — `apiRequest({ name:'workspaces/setPriority', version:'v1', data })`, `method:"POST"`, `auth:{ login:true }`, `preApiExecute` RBAC, then **enqueue one `WorkspaceSignal`** and return a `ControlAck` (`{accepted, signalSeq}`). The handler **never mutates `Ticket.priority` inline** — the Conductor drains the signal and writes (the §7 enqueue-not-write contract). The new value arrives at the client over the `ws-ai:*` merge-on-`seq` stream, never via the ack.
- **Bulk form:** the `{ ticketIds[] }` target is a **single batched signal the Conductor runs serially** (B-30), exactly like `bulk-status`/`bulk-move` ([`13 §Verbs`](../features/13_BACKLOG_AND_SPRINTS.md)) — so "set 6 tickets to high" is one enqueue. Natural home: a **6th bulk-bar action** (`Priority`) alongside Move · Status · Assign · Sprint · Archive in [`13 §User-flow step 5`](../features/13_BACKLOG_AND_SPRINTS.md), and a single-ticket entry on the board card `⋯` menu ([`12 §User-flow step 2`](../features/12_BOARD_AND_KANBAN.md)).
- **RBAC:** reuse the existing **"work on tickets"** tier (Owner/Admin/Member) — no `RBAC_CAPABILITIES` matrix change (mirrors `bulk-status`/`bulk-assign`, [`CONTROL_API §5`](../CONTROL_API.md), D69). A Member can reprioritize a ticket they can already move.
- **Audit:** each change appends a `TicketEvent` (the Conductor is the only writer of `TicketEvent`, [`04b §6`](../04b_DATA_MODEL_ADDENDA.md)) — `type:'priority-changed'`, `metadata:{ from, to }` — so the event log answers "who bumped this to urgent and when."
- **Backlog surface (read-only render):** add `'priority'` to `TicketSortKey` ([`13 §Data`](../features/13_BACKLOG_AND_SPRINTS.md): `type TicketSortKey = 'id' | 'updated' | 'status' | 'stage'` → `… | 'priority'`), a session-only client comparator (no server round-trip, no verb). Add a small priority chip to the `Row` chrome next to the status pill. **Filter** parity: optionally extend the shared `BoardFilter` predicate ([`12 §Data`](../features/12_BOARD_AND_KANBAN.md)) with a priority multi-select (SD-5 — default: ship the chip + sort, defer the filter).
- **Board surface (read-only render):** a priority chip/stripe on `KanbanCard` ([`12 §User-flow step 2`](../features/12_BOARD_AND_KANBAN.md), card chrome — `LabelChip`/`Icon` family) and in the `CardQuickview`. The **board never reorders columns by priority** — column order stays pipeline/stage-derived ([`12 §Out`](../features/12_BOARD_AND_KANBAN.md): "order is pipeline/AI-owned, never user-sorted on the board"); priority only colors the chip and feeds the *scheduler*, not the *board layout*.

---

## 4. Invariants honored

| Invariant | How this addition honors it |
|---|---|
| **B-23 — Conductor is the only writer** | `set-priority` enqueues a `WorkspaceSignal`; the **Conductor** writes `Ticket.priority` + the `TicketEvent` ([`CONTROL_API §7`](../CONTROL_API.md), [`01 §3.3`](../01_ARCHITECTURE.md)). The handler never mutates inline. The picker is **CapacityManager/Conductor** logic — no LLM writes or coordinates. |
| **FROZEN verbs (7 worker + 6 assistant, all read/propose)** | **No new structured-channel verb.** `set-priority` is a **control-API op** (web-app→orchestrator request transport), disjoint from the agent verb surface ([`CONTROL_API §4`](../CONTROL_API.md)). `VERB_REGISTRY` conformance unaffected. |
| **`runInTenant`** | The picker, the `set-priority` Conductor action, and the admission scan all run **outside** the `/api` lifecycle → wrapped in `runInTenant(workspaceId, …)` (mandatory for every background/orchestrator worker, [`04 §4`](../04_DATA_MODEL.md), [`07b §12`](../07b_CONTAINER_RUNTIME.md), `Q-SEC-RUNINTENANT`). |
| **PTY-billing (subscription-only, interactive PTY)** | Untouched — this is pure **queue ordering**, not a spawn-mode change. The picker chooses *which queued interactive `claude` PTY turn* gets the freed `MAX_ACTIVE_TURNS` slot; it never reaches for headless/`-p`/Agent-SDK ([`01 §1`](../01_ARCHITECTURE.md)). Concurrency cap economics are unchanged; only the dequeue order differs. |
| **LuckyStack conventions** | Enum-string field (not magic `Int`); typed `apiRequest` (no `as any`); `_api/<name>_v1.ts` file-routing; `preApiExecute` RBAC; i18n the new chip/menu labels via `useTranslator`; Tailwind tokens from `index.css` `@theme` for the priority chip colors (e.g. `urgent`→`wrong`, `high`→`warning`, `normal`→`muted`, `low`→`disabled`); merge-on-`seq` realtime. |
| **V1_SCOPE wins** | This is **HORIZON** ([`V1_SCOPE §design-horizon`](../V1_SCOPE.md)) — explicitly **not built in V1**. V1 ships the flat FIFO of [`01 §6`](../01_ARCHITECTURE.md) as-is. This addition is the documented upgrade path; where it over-describes beyond V1, V1_SCOPE wins. |
| **No preemption / no eviction** | The picker only orders *queued* work; `admit()`'s reclaim (D87) still targets oldest **paused/idle** containers, never a running higher-value turn is evicted *for* priority (§2, SD-3). Priority changes never kill a running turn. |

---

## 5. Open sub-decisions (DEFAULTs)

| # | Question | DEFAULT (flag if wrong) |
|---|---|---|
| **SD-1** | When a `needs-input` ticket is answered and re-enqueued, does it get head-of-line, or re-compete on priority? | **Re-compete** on priority-then-age like any candidate. No automatic resume-jump; an answered `urgent` still wins via its priority, an answered `low` waits its turn. Simplest, no special case. |
| **SD-2** | Strict priority (risk of starving `low`) vs. an aging term? | **Strict priority** in this addition (default). Document an *optional* queue-aging boost (older items gain weight) as the escape hatch — **but aging is queue-age only, NOT a deadline/SLA** (those are out, §2). Turn on aging only if starvation is observed. |
| **SD-3** | Preemption — may a freshly-set `urgent` evict a running `low` turn? | **No preemption.** Non-preemptive scheduling only; `urgent` is honored at the *next* `onSlotFree()`. Preemption loses in-flight work and complicates `--resume`; out of scope. |
| **SD-4** | Reserve a slot for `urgent` (per-priority concurrency floor)? | **No reservation.** One shared `MAX_ACTIVE_TURNS` budget ([`07b §8.1`](../07b_CONTAINER_RUNTIME.md)); priority orders the queue, doesn't partition the cap. |
| **SD-5** | Backlog/board **filter** by priority (beyond chip + sort)? | **Defer the filter; ship the chip + sort + bulk-bar action.** Extending `BoardFilter` ([`12 §Data`](../features/12_BOARD_AND_KANBAN.md)) with a priority multi-select is a small follow-up, not required for the scheduler to work. |
| **SD-6** | Default priority for AI-drafted vs. user-created tickets? | **`normal` for both.** Quick-add ([`12 §Quick-add`](../features/12_BOARD_AND_KANBAN.md)) and AI-drafted proposals both materialize at `normal`; the user bumps explicitly. No auto-priority inference (that would need an LLM — out). |
| **SD-7** | Picker scope — global across the host, or per-workspace? | **Per-workspace admissible set, single global cap.** `MAX_ACTIVE_TURNS` is host-wide ([`07b §8.1`](../07b_CONTAINER_RUNTIME.md)); the comparator sorts the global queue by priority-then-age (priority is comparable across workspaces since the enum is shared). No per-workspace fair-share in this addition (SD-future). |

---

## 6. Future build checklist (per-lane + verification)

**Lane B — data**
- [ ] Add `Ticket.priority String @default("normal")` + `@@index([workspaceId, status, priority])` to the real Prisma schema (§3.1). **Verify:** migration applies; existing tickets backfill to `normal`; index used by the admissible-queue scan (`explain`).
- [ ] Add `priority: TicketPriority` + the `TicketPriority` union to the prototype `Ticket` interface (`_data/types.ts`) and seed (`_data/seed.ts`) with a spread of values. **Verify:** `tsc` clean; INDEX delta noted.
- [ ] Add the `04b §13` field-sweep row + a `Ticket.priority` note in `04 §3`. **Verify:** docs cite Addition 11 as the decision source.

**Lane A — orchestrator**
- [ ] Implement the priority-then-`enqueuedAt` comparator as a pure function; wire it into the CapacityManager `onSlotFree()` dequeue ([`07b §8.2`](../07b_CONTAINER_RUNTIME.md)) under the lease + `runInTenant`. **Verify (unit):** given a fixed queue, the comparator is a total order and picks the documented winner; admissibility filter excludes `needs-input`/`paused`/rate-limit-parked items.
- [ ] Feed `resumeAll()`'s to-resume set through the same comparator for the staged-resume wave order ([`07b §9.2`](../07b_CONTAINER_RUNTIME.md), Tier-2 staged resumeAll). **Verify (integration):** after a simulated crash with mixed priorities, `urgent` in-flight tickets re-admit first within `MAX_ACTIVE_TURNS`.
- [ ] Confirm composition with slot-release-on-`needs-input` (Tier-2): a parked turn releases its slot → `onSlotFree()` fires → the picker admits the top admissible candidate. **Verify (integration):** parking a `normal` turn admits a queued `urgent` next; the re-answered item re-competes (SD-1), no head-of-line jump.
- [ ] `set-priority` control-API route (`src/workspaces/_api/setPriority_v1.ts`): `POST`, `login:true`, `preApiExecute` work-on-tickets RBAC, validate `priority ∈ enum`, enqueue one `WorkspaceSignal` (bulk = one batched signal, B-30), return `ControlAck`. **Verify:** the auto-sweep contract/auth/rate-limit test passes; a `_v1.tests.ts` happy-path asserts the signal is enqueued and the handler writes **nothing** inline.
- [ ] Conductor handler for the drained `set-priority` signal: write `Ticket.priority`, append `TicketEvent('priority-changed', {from,to})`, re-sort the queue (no eviction), fan out `ws-ai:*`. **Verify:** event-log row appears; client receives the new value via merge-on-`seq`, not the ack.

**Lane B/UI — surface**
- [ ] Backlog: extend `TicketSortKey` with `'priority'` + the client comparator; add a priority chip to `Row` ([`13`](../features/13_BACKLOG_AND_SPRINTS.md)); add a `Priority` bulk-bar action (6th action) dispatching the batched `set-priority`. **Verify:** sort orders correctly within each sprint section; bulk action shows "requested…" then clears on Conductor confirm (B-30).
- [ ] Board: priority chip/stripe on `KanbanCard` + `CardQuickview`; single-ticket `set-priority` on the `⋯` menu ([`12`](../features/12_BOARD_AND_KANBAN.md)). **Verify:** column order is unchanged by priority (pipeline-derived only); chip colors come from `index.css` `@theme` tokens; labels are i18n'd.
- [ ] (SD-5, optional) Priority multi-select in the `BoardFilter` popover — defer unless requested.

**Cross-cutting verification**
- [ ] **No new verb:** `VERB_REGISTRY` conformance unchanged; `set-priority` appears only in the control-API catalogue, never the structured-channel surface (`Q-ENG-VERB-CONFORMANCE`).
- [ ] **B-23:** grep the `set-priority` handler — zero direct `Ticket.priority` mutation; the Conductor is the only writer.
- [ ] **Determinism:** the picker has no `Math.random`, no time-of-day input, no LLM call (deadlines/business-hours confirmed absent).

---

## 7. Citations

| Cited | Used for |
|---|---|
| [`01 §6`](../01_ARCHITECTURE.md) — Concurrency & cost control | The flat FIFO + `MAX_CONCURRENT_ACTIVE` queue this addition reorders; rate-limit→`stopped` admissibility. |
| [`01 §3.3`](../01_ARCHITECTURE.md) — Conductor (only writer) | B-23 floor; picker is deterministic Conductor/CapacityManager logic, no LLM. |
| [`01 §1`](../01_ARCHITECTURE.md) — billing constraint | PTY-billing invariant unchanged (queue ordering, not spawn mode). |
| [`07b §8`](../07b_CONTAINER_RUNTIME.md) — CapacityManager admission (`Q-CT-CAPACITY`, D87) | The `admit()`/dequeue gate the picker modifies; `MAX_ACTIVE_TURNS`/`MAX_RESIDENT`; reclaim-before-reject; enqueue-never-reject. |
| [`07b §9.2`](../07b_CONTAINER_RUNTIME.md) — `resumeAll()` re-association | Staged-resumeAll wave ordering via the same comparator. |
| [`07b §12`](../07b_CONTAINER_RUNTIME.md) — build checklist | `runInTenant` wraps the CapacityManager; no-new-verbs self-check. |
| [`04 §3`](../04_DATA_MODEL.md) / [`04 §4`](../04_DATA_MODEL.md) / [`04 §5`](../04_DATA_MODEL.md) — data model | `Ticket` "(none new)" today → propose `priority`; tenant/append-only rules; prototype-types-first migration. |
| [`04b §13`](../04b_DATA_MODEL_ADDENDA.md) — field sweep | Current `Ticket` additive columns (priority is genuinely new); the row to add. |
| [`04b §6`](../04b_DATA_MODEL_ADDENDA.md) — `TicketEvent` | Conductor-only audit append for `priority-changed`. |
| [`CONTROL_API §3–§8`](../CONTROL_API.md) — control-API spec | `set-priority` as a new catalogue row; enqueue-not-write; RBAC reuse; bulk batched signal (B-30); ack-then-merge-on-`seq`. |
| [`features/13`](../features/13_BACKLOG_AND_SPRINTS.md) — Backlog & Sprints | `TicketSort` extension; bulk-bar 6th action; no drag-to-reorder (enum, not free rank). |
| [`features/12`](../features/12_BOARD_AND_KANBAN.md) — Board & Kanban | Card chip surface; quick-add default; board never reorders columns by priority; `BoardFilter` (SD-5). |
| [`V1_SCOPE`](../V1_SCOPE.md) — design-horizon vs build | HORIZON tier; V1 ships flat FIFO; V1_SCOPE wins on conflict. |
| Tier-2 hardening (slot-release on `needs-input`, staged `resumeAll`) | Reference-only concepts the picker composes with (§3.2); not specified here. |

> **Self-check:** No new verb introduced (FROZEN surface untouched; `set-priority` is a control-API op). No LLM writes or coordinates (deterministic picker = Conductor/CapacityManager logic). B-23 only-Conductor-writes preserved (enqueue→Conductor writes). `runInTenant` wraps every orchestrator-side path. PTY-billing unchanged. HORIZON — not built in V1; V1_SCOPE wins. Deadlines/SLA/business-hours/preemption explicitly OUT. This doc edits no existing file; it proposes additive deltas to `04`/`04b`/`CONTROL_API`/`12`/`13` for the future build lane.
