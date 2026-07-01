# Addition 03 — Institutional memory (Handoff/CarryOver as RAG)

> **Tier:** HORIZON (designed, not built in V1) · **Lane:** B (data) + A (orchestrator/RAG) · **Status:** NEW (2026-06-11).
> **Pitch:** Index the distilled `Handoff` + `CarryOver` corpus per-workspace so a fresh Stage-Agent retrieves "what prior agents learned on similar tickets" automatically at stage start — a `memory` namespace on the existing self-hosted-embeddings + `$vectorSearch` RAG infra ([07 §D]).
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #3.
>
> **HORIZON, not V1.** This is a *design-grade* spec — clear enough for a future lane to pick up cold — and is **NOT in the V1 build**. [V1_SCOPE §2] ships the RAG infra ([07 §D]) for **codebase** context only; a *memory* namespace over `Handoff`/`CarryOver` is post-V1. The shapes here add **no new persisted models** and **no new verbs** (B-23): every write is a `[control-API]` Conductor action, every read rides the existing `$vectorSearch` path; the `RagEntry` reuse is namespace-additive, not a schema change. Where this spec needs a field that does not yet exist on `RagEntry`, it is proposed as an **explicit delta** (§3.1) for the day the lane opens — not authored in V1 ([04b §18] deferral discipline).

---

## 1. The gap this closes

The pipeline already has two carry-forward mechanisms, but **both are scoped to a single ticket's life and then go cold**:

| Mechanism | Scope | Audience | Lives in | Goes cold when… |
|---|---|---|---|---|
| `CarryOver` envelope (`{ summary, changedFiles[], openQuestions[], commitHash }`, B-O2) | stage → stage **within one ticket** | machine | `CarryOver` model ([04b §14]) | the ticket finishes — the next ticket never sees it |
| `Handoff` (`{ summary, decisions[], state, next[], gotchas[], carried? }`) | **within one session** (budget/`/clear`+reload self-handoff cycle, [06 §2/§6]) | machine | `Handoff` model ([04b §14]) | the session resets — a *different* ticket's agent never sees it |

So today a Stage-Agent starting ticket DEV-1300 has **no automatic access** to the `decisions[]`, `gotchas[]`, and `state` a prior agent painfully discovered on DEV-1240 — even when the two tickets touch the same files, the same subsystem, or hit the same dead-end. The knowledge exists (it is durably stored, append-only, [04b §11a]) but is **never retrieved** at the one moment it would help: the start of a similar stage.

The codebase RAG ([07 §D]) already solves the analogous problem for *code* ("what does this symbol do, frozen at this commit"). The same machinery — self-hosted embeddings, `$vectorSearch`, `runInTenant` isolation — can serve a **second corpus**: the distilled institutional memory of every prior agent on this workspace. That is the gap: **the agents' own learnings are not part of any agent's starting context.**

> **Why this is institutional, not per-ticket:** `Handoff.gotchas[]` ("the avatar fallback key must survive `?v=` cache-busts") and `Handoff.decisions[]` ("we deliberately did NOT change the public Avatar API") are *workspace-durable* lessons — they apply to every future ticket in that subsystem, not just the one that produced them. Indexing them turns a write-once audit trail ([04b §11a]) into a queryable knowledge base, the AI-quality compounding loop ([AI_QUALITY_AND_EVALS §5]) generalized from *prompt feedback* to *agent-discovered state*.

---

## 2. Locked decision (shape) + V1 deferral note

**LOCKED ([DECISIONS_LEDGER] #3):**

1. **Index `Handoff` + `CarryOver` records per-workspace.** Both corpora (the within-session superset and the stage→stage envelope, [04b §14]) are distilled and embedded into a **`memory` namespace** scoped by `workspaceId` — `runInTenant`-isolated, never cross-tenant ([04b §11c]).
2. **Retrieve automatically at stage start.** Top-K by similarity to the ticket's `title + description + stage`, with a relevance/recency filter capping injection size, retrieved at launch and **injected into the rendered stage-instructions / `CLAUDE.md`** ([GOLDEN_PLAN_STAGE §4/§5] injection point) — no agent action required.
3. **DEFAULT (flag if wrong): reuse the existing RAG infra ([07 §D]) as a separate `memory` namespace/collection**, the same indexer + self-hosted embeddings + `$vectorSearch` that serves the codebase `RagEntry`. Retrieval = top-K cosine/`$vectorSearch` over the memory namespace, filtered by `workspaceId` (NOT by `commitHash` — memory is *not* frozen-per-commit, unlike code; §3.3).

**DEFAULT-flag note (Rule 3b):** reusing `RagEntry` + the `[07 §D]` indexer is the right call — it inherits self-hosted/no-egress embeddings (B-18), the serial leased worker (G1), the zod-parsed `$vectorSearch` wrapper (G23), and `runInTenant` isolation for free, and avoids a parallel vector store. The **one place the default needs a conscious deviation** is the **freezing model**: codebase RAG filters *inside* `$vectorSearch.filter` on `commitHash` ([07 §D], B-25) so a ticket sees a frozen snapshot. Memory is the opposite — a ticket *wants* the latest cross-ticket learnings, so the filter is `workspaceId` (+ a recency/relevance cap), **never** `commitHash`. This is called out as a deliberate divergence, not an accident; if a future reviewer wants frozen-per-commit memory, that is a different (and worse) product and should be re-decided at the ledger.

**V1 deferral:** [V1_SCOPE §2] ships `[07 §D]` for codebase context only; [V1_SCOPE §4] does not list a memory namespace because it is HORIZON. This addition **does not** enter the V1 migration, **does not** add a row to [04b §16]'s count, and **does not** edit `04`/`04b`/`07`. Its `RagEntry` delta (§3.1) lands "the day its lane opens" ([04b §18] discipline). The §6 checklist is gated behind that.

---

## 3. Design-grade mechanics

### 3.1 The memory corpus + namespace (cite [04b §14], [04b §6], [07 §D])

**The corpus = distilled `Handoff` + `CarryOver`, not raw rows.** A raw `Handoff` JSON is noisy (it carries `state`/`next[]` that are operationally transient); a raw `CarryOver` envelope is a one-ticket promotion. What is *institutionally* valuable is the **durable lesson subset**: `Handoff.decisions[]`, `Handoff.gotchas[]`, and the `summary`; plus `CarryOver.summary` + `openQuestions[]` (an unresolved question on one ticket is a known-hazard for the next). The distilled unit is chunked and embedded.

**Reuse `RagEntry` with a `namespace` discriminator (the proposed delta).** The codebase index is `RagEntry` rows carrying `commitHash` ([07 §D], DATAMODEL §3 dedupe key `commitHash + filePath + chunkId`). Memory rides the **same model**, distinguished by a namespace field and keyed to its source record rather than a file:

```prisma
// PROPOSED DELTA to RagEntry ([07 §D] / DATAMODEL §3) — design-only, lands when the lane opens ([04b §18]).
// Does NOT edit 04/04b/07; recorded here so a future lane does not re-derive it.
model RagEntry {
  // ── existing codebase fields ([07 §D]) ──
  // id, workspaceId (tenant), commitHash, filePath, chunkId, content, embedding, createdAt …

  // ── ADDED for the memory namespace (additive, nullable; codebase rows leave them null) ──
  namespace   String   @default("code")   // 'code' | 'memory' — the corpus discriminator (default keeps codebase rows unchanged)
  sourceKind  String?                       // memory only: 'handoff' | 'carryover'  (which model the chunk distilled from)
  sourceId    String?  @db.ObjectId         // memory only: the originating Handoff/CarryOver id (provenance + dedupe)
  ticketId    String?  @db.ObjectId         // memory only: the ticket the lesson came from (recency/attribution, [04b §6] join)
  stageId     String?                        // memory only: the StageKind key it occurred in ([04b §12]) — same-kind boost (§3.3)
  // commitHash stays NULLABLE for memory rows — memory is NOT frozen-per-commit (§3.3, the §2 divergence)

  @@unique([workspaceId, namespace, sourceKind, sourceId, chunkId])  // memory dedupe key (analogous to the codebase commit+file+chunk)
  @@index([workspaceId, namespace, ticketId])                         // recency/attribution scan
}
```

- **Append-only, like its siblings.** `RagEntry` is in the append-only set ([04b §11a]); memory rows inherit that — a re-distillation of a superseded `Handoff` is a NEW append (the source `Handoff`/`CarryOver` are themselves append-only, [04b §11a]), never an update. A separate Atlas vector index (`memory`) or a `namespace` filter on the existing `rag` index serves the queries (§3.3).
- **Tenant-scoped.** `RagEntry` carries `workspaceId` and is in `TENANT_MODELS` ([04b §11d]/[MIGRATION §3.4]); the memory namespace is therefore `runInTenant`-isolated for free — no cross-workspace leakage (the same guarantee [AI_QUALITY_AND_EVALS §5.2] gives few-shot examples).
- **Provenance via `sourceId`/`ticketId`** lets the injected context cite *which* prior ticket a lesson came from (§3.3), and lets a `TicketEvent` ([04b §6]) record "memory indexed for DEV-1240" as an auditable fact.

> **Alternative considered (flag):** a standalone `MemoryEntry` model instead of overloading `RagEntry`. Rejected as the default — it would duplicate the embeddings pipeline, the `$vectorSearch` wrapper (G23), and the leased worker (G1) for no benefit. The `namespace` discriminator is the cheaper, single-pipeline path. If a future requirement makes memory's shape diverge hard from code (e.g. multi-vector per record), splitting the model is the escape hatch — recorded here, not chosen now.

### 3.2 Indexing pipeline (reuse RAG infra; `runInTenant`)

Memory is indexed by the **same serial leased worker** as the codebase delta-indexer ([07 §D]): one worker, `concurrency:1` under `lease:orchestrator` (G1), self-hosted embeddings (B-18, no egress), zod-parsed results (G23). The trigger is different: codebase RAG indexes on **merge** ([07 §C] webhook → `ragDeltaQueue`); memory indexes on **handoff/carry-over emission**.

**Trigger points (both are existing Conductor-observed events — no new verb):**

- **`emit_carryover`** (worker verb, [02 §2]) → the Conductor already stores a `CarryOver` envelope ([06 §6], [04b §14]) and parses its fenced blocks ([04b §14]). At that same Stop-hook turn-end ([GOLDEN_PLAN_STAGE §7], `Q-ENG-TURNEND`), enqueue a **`memoryIndexQueue`** job for the new envelope.
- **`emit_handoff`** (worker verb, [02 §2]) → the self-handoff cycle ([06 §6]) stores a `Handoff` keyed by `sessionKey` and resets. At that store, enqueue the same job for the new `Handoff`.

```ts
// memoryIndexQueue.process(1, …) — SAME worker/lease as ragDeltaQueue ([07 §D], G1).
// Fed by the Conductor at emit_carryover / emit_handoff store time (NO new verb — these are existing verbs;
// the Conductor is the writer, B-23). Every body wraps runInTenant ([04b §11c], MIGRATION §7).
memoryIndexQueue.process(1, async (job) => {
  await withLease(`lease:orchestrator`, async () => {
    await runInTenant(job.data.workspaceId, async () => {            // mandatory — non-/api path (Q-SEC-RUNINTENANT)
      const record = await loadSource(job.data);                     // the Handoff or CarryOver row ([04b §14])
      const lessons = distill(record);                               // decisions[]/gotchas[]/summary[/openQuestions[]]
      for (const chunk of chunkLessons(lessons)) {
        const id = { namespace: 'memory', sourceKind: job.data.kind, // 'handoff'|'carryover'
                     sourceId: record.id, chunkId: chunk.id };
        if (await rag.exists({ workspaceId: job.data.workspaceId, ...id })) continue;  // idempotent (§3.1 dedupe key)
        const embedding = await selfHostedEmbed(chunk.text);         // SAME embedder as code (B-18, no egress)
        await rag.appendEntry({ ...id, workspaceId: job.data.workspaceId, content: chunk.text,
                                ticketId: record.ticketId, stageId: record.stageId });  // append-only ([04b §11a])
      }
    });
  });
});
```

**Pipeline invariants it inherits from [07 §D] (verbatim, not re-derived):**
- One worker, **`concurrency:1` under the Redis lease** (G1) — serial, race-free; memory jobs share the queue/worker with the codebase delta jobs.
- **Self-hosted embeddings** (nomic-embed / BGE / jina-code, B-18) — no code/lesson egress, no per-call cost.
- **Idempotent append** on the §3.1 dedupe key; **append-only** (no update/delete, [04b §11a]).
- **`runInTenant(workspaceId, …)` mandatory** — this is a background worker outside `/api` ([MIGRATION §7] checklist row; add a "memory indexer" line to that list when the lane opens). `currentWorkspaceId()` throws on omission (loud-fail by design, [04b §11c]).

> **Distillation is deterministic, not an LLM call (default, flag if wrong):** `distill()` slices the already-structured `decisions[]`/`gotchas[]`/`summary`/`openQuestions[]` fields — it does **not** spawn an agent to summarize (that would burn subscription turns, [06]'s whole reason to exist, and add non-determinism). The records are *already distilled* (an agent wrote them via `emit_handoff`/`emit_carryover`); memory re-uses that work. An optional LLM re-distillation (cluster + compress, like [AI_QUALITY_AND_EVALS §5.2]'s few-shot clustering) is a later enrichment, propose-grade, gated — not the default path.

### 3.3 Retrieval + injection at stage start (cite [GOLDEN_PLAN_STAGE §4/§5] injection point, [06])

**Retrieval happens at launch, before the PTY starts** — in the config-renderer path that produces a stage's `CLAUDE.md` ([GOLDEN_PLAN_STAGE §4]) and `--append-system-prompt` stage-instructions ([GOLDEN_PLAN_STAGE §5]). The renderer is fed the fixture inputs ([GOLDEN_PLAN_STAGE §1]: the resolved `PipelineStageCfg`, the per-session context incl. `ticketId`/`stageId`, the carry-over envelope); memory retrieval is a **new render input** that joins them, exactly as [AI_QUALITY_AND_EVALS §5.3]'s few-shot block is "a fourth render input."

**The query** = the embedding of `ticket.title + ticket.description + stage` (the LOCKED retrieval key), run against the `memory` namespace:

```ts
// Retrieval at stage launch — runs in the renderer path ([GOLDEN_PLAN_STAGE §1] inputs), inside runInTenant.
// Mirrors [07 §D]'s frozen-per-ticket query, but filters on workspaceId/namespace — NOT commitHash (the §2 divergence).
const queryVector = await selfHostedEmbed(`${ticket.title}\n${ticket.description}\n${stage.kind}`);
const rows = await functions.db.prisma.ragEntry.aggregateRaw({ pipeline: [
  { $vectorSearch: { index: 'rag', path: 'embedding', queryVector, numCandidates, limit: K,
                     filter: { namespace: { $eq: 'memory' }, workspaceId: { $eq: ws } } } }, // NOT commitHash (memory is live)
  { $project: { content: 1, ticketId: 1, stageId: 1, sourceKind: 1, _id: 0 } },
] });
const memory = ragMemoryRowsSchema.parse(rows);   // zod, no cast (G23)
```

**The relevance/recency cap (the LOCKED "caps injection size" rule):** raw top-K is not enough — a workspace accrues thousands of lessons. The renderer applies, cheapest-first:
1. **Similarity floor** — drop rows below a configured cosine threshold (a weakly-related lesson is noise, not context).
2. **Same-`StageKind` boost** ([04b §12]) — a `code`-stage launch weights `code`/`review` lessons over `refine` ones (`stageId` on the row enables this); analogous to how the Plan fixture's skills are stage-scoped ([GOLDEN_PLAN_STAGE §3]).
3. **Recency tiebreak** — `ticketId`→`Ticket.lastActivityAt` ([04b §13]) breaks ties toward recent lessons (the subsystem's *current* truth, not a stale 2024 decision).
4. **Hard token cap** — a small fixed budget (default K ≈ 3–5, like [AI_QUALITY_AND_EVALS §5.3]'s few-shot cap, `Q-AIQ-FEWSHOT-CAP`) so memory injection never bloats the context the whole [06] budget machinery exists to protect.

**The injection point** — memory renders as a bounded, clearly-fenced block in the stage's `CLAUDE.md` ([GOLDEN_PLAN_STAGE §4], "context-doc imports" region), BELOW the `customInstructions` body and the `@import` context docs, mirroring [AI_QUALITY_AND_EVALS §5.3]'s few-shot block placement:

```markdown
## Institutional memory (lessons from prior tickets on this workspace)
<!-- rendered from the `memory` namespace, top-K capped (§3.3); attribution = source ticket; NOT frozen-per-commit -->

- (from DEV-1240, code stage) GOTCHA: the avatar fallback identity key must survive `?v=` cache-busts — do not key it off the URL.
- (from DEV-1198, review stage) DECISION: the public Avatar API is frozen; changes go through an adapter, never the component signature.
- (from DEV-1240, refine stage) OPEN QUESTION that recurred: confirm whether `avatar.ts` owns the cache-bust or the component.
```

**Interaction with the [06] self-handoff cycle (the cite):** memory injection and [06]'s within-session handoff are **complementary, not redundant**. [06] preserves *this* session's context across a `/clear`+reload ([06 §2]); memory injects *other* tickets' durable lessons at *cold* stage start. A subtle but important consequence: when [06] fires a self-handoff mid-stage and reloads, the **memory block is re-rendered into the reload context** (it is part of the rendered `CLAUDE.md`, [06 §2 step 4] "feed the handoff back as the fresh opening context"), so the institutional lessons survive the reset alongside the session's own handoff — exactly the "fold the still-relevant parts forward" instruction in [06 §3]'s default template, now extended to cross-ticket memory.

> **Why inject vs. give the agent a `query_memory` verb (flag — the verb-surface guard):** retrieval is **renderer-side injection, NOT a new verb.** Adding a `query_memory` worker verb would violate the FROZEN 7+6 surface ([02 §2], B-23). The agent already has `query_context` (read/synchronous, [02 §2]) for *on-demand* deep pulls within the current ticket; institutional memory is *automatic* starting context, so it belongs in the rendered config the agent boots with — no agent call, no verb. (If a future requirement wants the agent to *actively* search memory mid-turn, that is `query_context`'s scope extended app-side, never a new verb.)

---

## 4. Invariants honored

| Invariant | How this addition honors it |
|---|---|
| **B-23 — Conductor is the only writer** | Memory rows are written by the Conductor-driven `memoryIndexQueue` worker at `emit_carryover`/`emit_handoff` store time; no LLM session writes a `RagEntry`. Retrieval is a read. |
| **FROZEN 7+6 verbs ([02 §2])** | No new verb. Indexing rides existing `emit_carryover`/`emit_handoff` (the Conductor observes their stores, [04b §14]); injection is renderer-side; on-demand pulls reuse `query_context`. |
| **`runInTenant` ([04b §11c])** | The memory indexer is a background worker → wraps `runInTenant(workspaceId, …)` (add to the [MIGRATION §7] checklist). Retrieval runs in the renderer's tenant scope. Memory never crosses workspaces (the [AI_QUALITY_AND_EVALS §5.2] / `Q-AIQ-FEWSHOT-SCOPE` isolation, generalized). |
| **PTY-billing (hooks + structured channel, [01 §1], [06])** | `distill()` is deterministic (no agent turn); embeddings are self-hosted (B-18, no subscription cost). Memory injection respects the [06] budget — capped (§3.3) so it never inflates the context [06] protects, and is re-folded on self-handoff reload ([06 §2]). |
| **Append-only ([04b §11a])** | `RagEntry` is append-only; memory rows inherit it. A superseded lesson is a NEW append (its source `Handoff`/`CarryOver` are themselves append-only). |
| **Reuse RAG infra ([07 §D])** | Same indexer, same leased serial worker (G1), same self-hosted embedder (B-18), same zod-parsed `$vectorSearch` wrapper (G23) — `namespace`-additive, not a parallel store. |
| **No new persisted model (V1-count honest, [04b §16/§18])** | Reuses `RagEntry` with additive nullable fields; the delta is design-only ([04b §18]) and out of the V1 migration. Adds nothing to [04b §16]'s count. |
| **LuckyStack conventions** | Renderer injection point is [GOLDEN_PLAN_STAGE]'s existing path; the indexer is a function-injection background worker; `$vectorSearch` via the `functions.db.prisma` injected client (Rule 21). |
| **V1_SCOPE wins ([V1_SCOPE §5])** | HORIZON, explicitly out of [V1_SCOPE §2/§4]. Not built, not migrated, not counted in V1. |

---

## 5. Open sub-decisions (DEFAULTs — confirm/override at the ledger)

| id | Question | DEFAULT (recommended) | Why |
|---|---|---|---|
| `Q-MEM-MODEL` | Overload `RagEntry` with a `namespace` discriminator, or a standalone `MemoryEntry` model? | **Overload `RagEntry` (§3.1)** — additive nullable fields, single embeddings pipeline. | Reuses the [07 §D] worker/embedder/`$vectorSearch` wrapper; a separate model duplicates all of it. Split only if memory's shape diverges hard later (escape hatch recorded). |
| `Q-MEM-FREEZE` | Filter retrieval on `commitHash` (frozen, like code) or `workspaceId` (live)? | **`workspaceId`, live (§2/§3.3)** — memory is cross-ticket current truth, NOT frozen-per-commit. | The deliberate divergence from [07 §D]'s freeze. A ticket *wants* the latest lessons; freezing memory would re-decide the product (worse). |
| `Q-MEM-DISTILL` | Deterministic field-slice distillation, or an LLM re-summarize? | **Deterministic slice (§3.2)** — the records are already agent-distilled. | No subscription turns ([06] reason-to-exist); deterministic + idempotent. LLM clustering is a later propose-grade enrichment, like [AI_QUALITY_AND_EVALS §5.2]. |
| `Q-MEM-INDEX` | One Atlas index with a `namespace` filter, or a separate `memory` vector index? | **Separate `memory` index (or a flag fallback to namespace-filter)** — keeps memory queries off the (commit-filtered) `rag` index path. | Cleaner `$vectorSearch.filter`; the `Float[]`+cosine fallback (G10) still applies under ~10k vectors. Confirm against Atlas Local index limits at build. |
| `Q-MEM-CAP` | Injection size cap (top-K + token budget)? | **Small fixed cap, default K≈3–5, configurable (§3.3)** — mirrors `Q-AIQ-FEWSHOT-CAP`. | Bounds the context [06] protects; curated-best beats append-everything. Per-workspace knob for teams wanting more grounding. |
| `Q-MEM-SCOPE` | Per-workspace only, or a cross-workspace "org memory" bank? | **Per-workspace only (§4)** — `runInTenant` isolation. | Same call as `Q-AIQ-FEWSHOT-SCOPE`: cross-workspace leaks one project's lessons into another + complicates redaction. Org-level is a later opt-in, not HORIZON-v1. |
| `Q-MEM-REDACT` | Scan lessons for secrets/PII before they re-enter a prompt? | **Yes — a redaction gate before injection**, reusing [AI_QUALITY_AND_EVALS §5.4]'s `redactionState` posture. | A `Handoff.gotchas[]` could quote a secret; it is about to be injected into a model prompt. Gate it like the few-shot bank (`Q-SEC-CREDLIFETIME`-adjacent). |

---

## 6. Future build checklist (per-lane + verification)

> **Gate:** none of this is built until the HORIZON lane opens AND [V1_SCOPE] is amended to pull memory IN (or a successor scope doc supersedes it). The [07 §D] codebase RAG must already be GREEN (memory rides its infra). The [DECISIONS_LEDGER] #3 DEFAULTs (§5) confirmed/overridden first.

**Lane B (data) — schema delta, when the lane opens:**
- [ ] Add the §3.1 `RagEntry` delta (`namespace` default `'code'`, nullable `sourceKind`/`sourceId`/`ticketId`/`stageId`; `commitHash` confirmed nullable for memory; the memory `@@unique` + `@@index`). **Verify:** existing codebase `RagEntry` rows are unaffected (all new fields nullable / defaulted); a migration dry-run shows no backfill needed. Mirror into `types.ts` ([04b §15] pattern).
- [ ] Confirm `RagEntry` stays in `TENANT_MODELS` ([04b §11d]) and append-only ([04b §11a]) — memory inherits both. **Verify:** a cross-tenant `$vectorSearch` (wrong `workspaceId`) returns zero rows in a `runInTenant` isolation test.

**Lane A (orchestrator/RAG) — pipeline + retrieval, when the lane opens:**
- [ ] Add `memoryIndexQueue` fed by the Conductor at `emit_carryover`/`emit_handoff` store time (§3.2), on the SAME leased serial worker as `ragDeltaQueue` (G1). **Verify:** an `emit_handoff` produces idempotent memory rows (re-running the job appends nothing new — §3.1 dedupe); no second worker instance writes (lease test, G8/G16).
- [ ] Implement deterministic `distill()` over `decisions[]`/`gotchas[]`/`summary`/`openQuestions[]` (§3.2). **Verify:** zero subscription turns consumed by indexing (no agent spawn); a golden `Handoff` fixture distills to the expected chunk set.
- [ ] Wrap the indexer in `runInTenant(workspaceId, …)` and **add a "memory indexer" row to the [MIGRATION §7] background-worker checklist.** **Verify:** omitting the scope throws `currentWorkspaceId()` loud-fail ([04b §11c]) in a unit test.
- [ ] Implement retrieval in the [GOLDEN_PLAN_STAGE] renderer path (§3.3): embed `title+description+stage`, `$vectorSearch` on `namespace:'memory'`+`workspaceId` (NOT `commitHash`), zod-parse (G23), apply the similarity-floor / same-`StageKind` / recency / token-cap filter. **Verify:** the `GOLDEN_PLAN_STAGE` golden fixture gains a deterministic memory block (or empty when no memory exists) and stays byte-equivalent given fixed retrieval inputs ([GOLDEN_PLAN_STAGE §9] regression test extended).
- [ ] Render the capped memory block into `CLAUDE.md` below `customInstructions`/`@import`s (§3.3), and confirm it is re-folded on a [06] self-handoff reload. **Verify:** a simulated [06] `/clear`+reload re-injects the memory block ([06 §2 step 4]); the injected token size never exceeds the §3.3 cap.

**Quality / safety verification:**
- [ ] Redaction gate (§5 `Q-MEM-REDACT`): a lesson quoting a secret is scrubbed/blocked before injection. **Verify:** a planted secret in a `Handoff.gotchas[]` does not appear in the rendered `CLAUDE.md`.
- [ ] (Optional, gated) An [AI_QUALITY_AND_EVALS §3]-style golden ticket asserting that injecting a relevant prior lesson measurably improves the stage output (e.g. a `GT-mem` where the lesson prevents a known scope-creep regression). **Verify:** runs on the replay lane (zero subscription cost); live-lane scoring gated like `Q-AIQ-LIVE-CADENCE`.

---

## 7. Citations

| Source doc | What this addition draws from it |
|---|---|
| [06_TOKEN_OPTIMIZATION.md](../06_TOKEN_OPTIMIZATION.md) | `Handoff` shape + `emit_handoff` verb + the self-handoff `/clear`→reload cycle (§2/§6); the budget the memory cap respects; the "fold still-relevant parts forward" template (§3) that memory re-injection extends. |
| [04b_DATA_MODEL_ADDENDA.md](../04b_DATA_MODEL_ADDENDA.md) | §14 `CarryOver` envelope vs `Handoff` (the corpus); §11a append-only set (`RagEntry`/`Handoff`/`CarryOver`); §11c `runInTenant`; §11d/§13 tenant split + `Ticket.lastActivityAt`; §6 `TicketEvent`; §12 `StageKind`; §18 deferral discipline; §16 V1 count honesty. |
| [07_ORCHESTRATOR.md §D](../07_ORCHESTRATOR.md) | The RAG delta-indexer + vector store this reuses: leased serial worker (G1), self-hosted embeddings (B-18), `$vectorSearch` + zod wrapper (G10/G23), the `commitHash`-frozen query memory deliberately diverges from. |
| [MIGRATION.md §7](../MIGRATION.md) | The `runInTenant`-for-every-background-worker checklist the memory indexer joins (P1-prerequisite discipline, loud-fail by design). |
| [GOLDEN_PLAN_STAGE.md §4/§5/§9](../GOLDEN_PLAN_STAGE.md) | The injection point — how a stage's `CLAUDE.md` (§4) + `--append-system-prompt` (§5) are rendered; the §9 regression test the memory block extends. |
| [AI_QUALITY_AND_EVALS.md §5](../AI_QUALITY_AND_EVALS.md) | The few-shot-bank pattern memory generalizes: per-workspace, tenant-isolated, capped, redaction-gated, rendered below the resolved prompt as an additive context block; the golden-ticket eval lane (§3) that verifies merit. |
| [V1_SCOPE.md §2/§4/§5](../V1_SCOPE.md) | The HORIZON deferral: V1 ships codebase RAG only; memory is out of scope; V1_SCOPE wins on conflict. |
| [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #3 | The locked decision (index Handoff+CarryOver per-workspace; auto-retrieve at stage start; reuse RAG infra as a `memory` namespace). **FLAG:** this ledger file does not yet exist in `_docs/additions/` — create it (or rename the existing `00_SPEC_RECONCILIATION.md` reference) when the additions set is formalized; this addition is #3 in it. |

---

*End of Addition 03 — Institutional memory. HORIZON tier: designed, NOT built in V1 ([V1_SCOPE §2/§4]). No new verbs (FROZEN 7+6, [02 §2]); every write is a [control-API] Conductor action (B-23). No new persisted model — additive nullable `RagEntry` fields, design-only ([04b §18]), out of the V1 migration and the §16 count. Reuses the [07 §D] RAG infra as a `runInTenant`-isolated `memory` namespace; retrieval is renderer-side injection ([GOLDEN_PLAN_STAGE §4/§5]), never an agent verb. The one conscious divergence from the [07 §D] default — `workspaceId`-live, NOT `commitHash`-frozen — is flagged at §2 and `Q-MEM-FREEZE`.*
