# Addition 02 — Cross-ticket collision radar

> **Tier:** V1 · **Lane:** A (engine/orchestrator) + C surface · **Status:** NEW (2026-06-11).
> **Pitch:** the Conductor keeps a live `file → ticketIds` index, rebuilt from the durable hook/`TicketEvent` log, so it can deterministically answer "is another ticket touching this file?" — then **warn the human** (board badge + auto-raised `link-tickets` suggestion) and **inform the agent** (overlap line injected into stage context / readable via `query_context`). No LLM, no blocking.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #2.

---

## 1. The gap this closes

[`02 §6`](../02_PROTOCOL_AND_FLOW.md) already names the exact motivating case — an agent that needs to know *now* "**is another ticket touching this file?**" calls **`query_context`** ([`02 §2`](../02_PROTOCOL_AND_FLOW.md)) and "the orchestrator answers from the DB." But **no doc says what the orchestrator reads to answer it.** Today the answer would require an ad-hoc scan of every active ticket's `CarryOver.envelope.changedFiles[]` ([`04 §2`](../04_DATA_MODEL.md)) plus replaying `TicketEvent(type:'file-change')` rows ([`04b §6`](../04b_DATA_MODEL_ADDENDA.md)) per query — O(active tickets × events) on a synchronous, agent-blocking call.

Two concrete failure modes without a radar:

- **Silent merge collisions.** Two `aiEnabled` tickets edit `src/_functions/session.ts` on parallel branches; nobody notices until both MRs conflict at merge. [`02 §6`](../02_PROTOCOL_AND_FLOW.md) explicitly cites "two tickets touched the same file → `link-tickets`" as a *deterministic* Conductor rule — but the rule has no data source to fire on **while both are still live** (it only had merge-time `changedFiles`).
- **Blind agents.** A Stage-Agent rewrites a file another active ticket is mid-edit on, with no signal to proceed carefully, because the `query_context` answer it could ask for has nothing behind it.

The radar is the **deterministic index** that backs the `query_context` answer and lets the existing `link-tickets` rule fire live — closing both, **with zero new verbs** and **no LLM** (the Conductor is the only actor involved, per [`01 §3.3`](../01_ARCHITECTURE.md) / B-23).

---

## 2. Locked decision

**Warn human + inform agent. Never block, never serialize.** On a detected per-file overlap between two tickets that each have an active stage:

| | Action | Surface | Mechanism (existing) |
|---|---|---|---|
| **(a)** Warn human | board collision **badge** on each overlapping card + auto-raise the existing `link-tickets` `WorkspaceSuggestion` | Lane C (Board) + the AI panel | deterministic Conductor rule → `WorkspaceSuggestion(type:'link-tickets', status:'open')` ([`04b §8`](../04b_DATA_MODEL_ADDENDA.md)); accept via `accept-suggestion` [control-API] ([CONTROL_API §8](../CONTROL_API.md)) |
| **(b)** Inform agent | inject "ticket DEV-X is also editing `<file>`" into the overlapping stage's context | Lane A | the agent reads it via **`query_context`** ([`02 §2`](../02_PROTOCOL_AND_FLOW.md)) **OR** the Conductor folds the current overlap set into the next rendered stage context ([`07b §3`](../07b_CONTAINER_RUNTIME.md) per-stage `.claude` re-render) — **no new verb** |

**DEFAULTs (flag if wrong):**

1. **Granularity = per-file** (exact `path` string), not per-directory. Directory-level would false-positive on every ticket touching anything under `src/`. → §5 D1.
2. **Index is rebuilt from the durable hook/`TicketEvent` log on orchestrator boot** — it survives a restart, holding no truth the log doesn't already hold (the log is the source of truth, [`04b §6`](../04b_DATA_MODEL_ADDENDA.md); the index is a derived cache, exactly like the pty-agent scrollback cache in [`07b §9`](../07b_CONTAINER_RUNTIME.md)). → §3.1 / §5 D2.
3. **An overlap on a file counts ONLY while BOTH tickets have an active stage** (`AgentSession.status ∈ {busy, needs-input, paused}`, [`04b §7`](../04b_DATA_MODEL_ADDENDA.md)). A `done`/torn-down ticket drops out of the radar; its files are released. → §3.1 / §5 D3.

No blocking, no serialization, no write verb — overlap is advisory. Both tickets proceed; the human decides whether to link/serialize via the suggestion.

---

## 3. Build-ready mechanics

### 3.1 The live file→tickets index (data source = hooks; rebuild on boot)

**What it is.** An in-memory map the Conductor owns, living in the single-instance orchestrator ([`07 §Overview`](../07_ORCHESTRATOR.md)), under the same Redis lease as every other writer mechanic (G8/G16):

```ts
// Conductor-owned, in-memory; derived cache, NOT a source of truth.
// filePath → set of ticketIds whose ACTIVE stage has touched it.
type CollisionIndex = Map<string /*filePath*/, Set<string /*ticketId*/>>;
// reverse map for O(1) drop-on-deactivate:
type TicketFiles   = Map<string /*ticketId*/, Set<string /*filePath*/>>;
```

**Data source (the load-bearing point) = the `PostToolUse(Edit|Write)` hook.** [`02 §3`](../02_PROTOCOL_AND_FLOW.md) + [`07b §0/§9`](../07b_CONTAINER_RUNTIME.md): a `type:http` hook fires `PostToolUse` for `Edit`/`Write`/`Bash`/`mcp__*` **in interactive PTY sessions too**, POSTing to the orchestrator's `X-WS-Hook-Token`-gated endpoint. The Conductor already serializes those into `TicketEvent(type:'file-change')` with the edited path(s) on `metadata.changedFiles[]` ([`04b §6`](../04b_DATA_MODEL_ADDENDA.md)). The radar is a **second consumer of that same hook event** — no new hook, no new verb, no stdout scraping.

**Live update (steady state).** When the Conductor processes a `PostToolUse(Edit|Write)` for `ticketId` editing `path`:

```
on PostToolUse(Edit|Write){ ticketId, sessionKey, paths[] }:   # under the lease, runInTenant(workspaceId)
  if session(sessionKey).status not in {busy, needs-input, paused}: return   # D3 guard
  for path in paths:
    others = index.get(path) ?? ∅
    index.add(path, ticketId); ticketFiles.add(ticketId, path)
    overlap = others \ {ticketId}
    if overlap not empty:
      evaluateCollision(workspaceId, path, ticketId, overlap)    # §3.3 / §3.4 — idempotent, deduped
```

`paths[]` comes from the hook payload's tool input (`Edit`/`Write` carry the target `file_path`); the Conductor normalizes to the **repo-relative path** (the worktree root is the container's clone path, [`07b §4`](../07b_CONTAINER_RUNTIME.md)) so two tickets on different `DEV-####` worktrees compare on the same key. **New op required** — *path normalization*: see §5 D4 ("propose normalize-to-repo-relative on the hook ingest").

**Drop-on-deactivate (D3).** When a ticket's stage leaves the active set — `emit_carryover`→`done` ([`02 §1`](../02_PROTOCOL_AND_FLOW.md)), `kill`/teardown ([CONTROL_API §8](../CONTROL_API.md), [`07 §A`](../07_ORCHESTRATOR.md)), or final-stage terminal:

```
on stageDeactivated(ticketId):                                  # under the lease
  for path in ticketFiles.get(ticketId) ?? ∅: index.remove(path, ticketId)
  ticketFiles.delete(ticketId)
  recomputeBadges(affectedPaths)    # clear badges that drop below 2 owners (§3.3)
```

A **paused** ticket stays in the radar (it still owns the file on its branch — D3 includes `paused`). Resume re-enters cleanly because the entry was never removed.

**Rebuild on boot (D2).** `resumeAll()` ([`07b §9`](../07b_CONTAINER_RUNTIME.md)) already reads `AgentSession` rows in `{ready, busy, paused}` to re-associate containers. The radar rebuild rides that same boot pass, under the lease, `runInTenant` per workspace:

```
rebuildCollisionIndex():                                        # at boot, before steady-state hook ingest
  index = ∅; ticketFiles = ∅
  for each AgentSession s where s.status in {busy, needs-input, paused}:   # D3 active set
    workspaceId = s.workspaceId; ticketId = s.ticketId
    # union of two durable sources, both already persisted:
    files  = TicketEvent.where(ticketId, type:'file-change').flatMap(e => e.metadata.changedFiles ?? [])
    files += CarryOver.where(ticketId, latest-per-stage).envelope.changedFiles      # 04 §2 (machine envelope)
    for path in dedupe(files): index.add(path, ticketId); ticketFiles.add(ticketId, path)
  for path with ≥2 owners: evaluateCollision(...)   # re-raise badges/suggestions idempotently (dedup on the open suggestion)
```

Because the log is the source of truth and the index holds nothing new, a crash mid-edit loses **no** radar state — the next boot reconstructs the identical index from `TicketEvent` + `CarryOver`. (Same crash-safety posture as the [`07b §5.3`](../07b_CONTAINER_RUNTIME.md) Caddy boot-reconcile.)

### 3.2 Data model (cite [04](../04_DATA_MODEL.md) / [04b](../04b_DATA_MODEL_ADDENDA.md))

**No new persisted model. No new column.** The radar is a derived in-memory cache over rows that already exist:

| Concern | Existing field/model | Cite |
|---|---|---|
| The edit events the index is built from | `TicketEvent{ type:'file-change', metadata.changedFiles[], seq }` (append-only, Conductor-only writer, Redis-INCR `seq`) | [`04b §6`](../04b_DATA_MODEL_ADDENDA.md) |
| The per-stage machine carry-over (boot-rebuild second source) | `CarryOver.envelope.changedFiles[]` (B-O2) | [`04 §2`](../04_DATA_MODEL.md) |
| Which tickets are "active" (the D3 gate) | `AgentSession.status ∈ {busy, needs-input, paused}` + `ticketId`/`workspaceId` | [`04b §7`](../04b_DATA_MODEL_ADDENDA.md) |
| The human-facing **warning output** | `WorkspaceSuggestion{ type:'link-tickets', ticketIds[], status:'open', patch:null }` (5-value enum, CANONICAL; `link-tickets` carries no `patch`) | [`04b §8`](../04b_DATA_MODEL_ADDENDA.md) |
| The accepted link itself (when the human accepts) | prototype `TicketLink{ id, rel, ai:true, reason }` ↔ Prisma `TicketLink` | [`04 §1`](../04_DATA_MODEL.md), `_data/types.ts:88` |
| The board **badge** state | **DERIVED, ui-only** — `Ticket` already exposes `hasTerminal`/`costLabel`-style ui-only flags; the badge is computed from the active suggestion set, **not** persisted | [`12 §Data`](../features/12_BOARD_AND_KANBAN.md) ("no new persisted fields") |

**Model delta — NONE required for persistence.** The one *optional* delta to propose (flag in §5 D5): a denormalized `Ticket.collisionFiles?: string[]` (ui-only, not persisted, pushed over `ws-ai:*`) IF the board badge needs the file list inline without a second fetch — otherwise the badge reads the `link-tickets` suggestion's `ticketIds[]` and the file list rides the suggestion `body`. **Default: do NOT add it**; mirror [`12 §Data`](../features/12_BOARD_AND_KANBAN.md)'s "no new persisted fields, render existing + deltas owned elsewhere."

### 3.3 Human surface — badge + link-tickets suggestion (cite [features/12](../features/12_BOARD_AND_KANBAN.md), [CONTROL_API](../CONTROL_API.md))

**The auto-raised suggestion (the canonical "warn").** `evaluateCollision` is a **deterministic Conductor rule** — exactly the one [`02 §6`](../02_PROTOCOL_AND_FLOW.md) names ("two tickets touched the same file → `link-tickets`"), now firing **live** instead of only at merge:

```
evaluateCollision(workspaceId, path, ticketId, overlapTicketIds):   # runInTenant, under the lease, NO LLM
  pair = sort([ticketId, ...overlapTicketIds])                       # canonical key for dedupe
  if openSuggestion(type:'link-tickets', ticketIds=pair) exists: updateBody(+path); return   # idempotent
  Conductor.raise WorkspaceSuggestion{
    type:'link-tickets', status:'open', ticketIds: pair, patch: null,        # link-tickets carries no patch (04b §8)
    title: `DEV-A and DEV-B are editing the same files`,
    body:  `Both tickets have an active stage touching: ${path} (+N more). Link them?`,
  }                                                                   # this raise is a Conductor write (01 §3.3), not a verb
  emit ws-ai:suggestion  +  ws-ai:* board-delta carrying the collision badge for pair
```

- **Who drafts:** the **deterministic Conductor** — this is the simple, rule-drafted case ([`02 §6`](../02_PROTOCOL_AND_FLOW.md): "deterministic Conductor rules for the simple ones, e.g. two tickets touched the same file → `link-tickets`"). **No Assistant, no reasoner, no LLM.** (Contrast `config-review` which needs LLM judgement.)
- **Accept path (unchanged):** the human taps Accept in the AI panel (`features/11`) → an **`accept-suggestion`** [control-API] request ([CONTROL_API §4 bridge + §8](../CONTROL_API.md)) → `preApiExecute` RBAC ("work on tickets") → enqueue → the Conductor materializes the `TicketLink{ rel:'relates to', ai:true, reason:'edited the same files' }`. The radar **never writes the link**; it only proposes (B-23). Dismiss/snooze ride the existing suggestion lifecycle.
- **The board badge (Lane C).** On each overlapping `KanbanCard` ([`Board.tsx`](../../_screens/Board.tsx) `KanbanCard`), render a small collision marker next to the existing terminal/cost chips — an `Icon name="link"` (or `code-branch`/`triangle-exclamation`) in a `text-warning`/`bg-container2` chip, `title="Also edited by DEV-X"`. It is a **pure render** of pushed state (the `ws-ai:*` board-delta from `evaluateCollision`), consistent with [`12 §Verbs/Events`](../features/12_BOARD_AND_KANBAN.md) ("subscribe-first → snapshot → merge-on-seq; no board-specific event kind added"). Tapping the badge opens the `link-tickets` suggestion / the related ticket. Tailwind tokens only (`warning`, `container2`, `muted` — [`index.css @theme`]); i18n via `useTranslator` for the chip `title` + any label.
- **Clear-on-resolve.** When a ticket drops out of the active set (§3.1 drop-on-deactivate) the pair falls below 2 owners → `recomputeBadges` emits a `ws-ai:*` delta clearing the badge and `supersede`s the open `link-tickets` suggestion if it no longer applies (merge-on-`seq` reconciles the board, [`12`](../features/12_BOARD_AND_KANBAN.md) / [CONTROL_API §6.3](../CONTROL_API.md)).

### 3.4 Agent-inform path (cite [02](../02_PROTOCOL_AND_FLOW.md) — via existing read verb / stage context, NO new verb)

Two existing, **read-only** mechanisms — **pick both, no new verb either way:**

1. **Pull, on demand — `query_context` (the canonical path).** [`02 §2`](../02_PROTOCOL_AND_FLOW.md) `query_context{ question }` is **synchronous** and explicitly exists to answer "an immediate cross-ticket answer … is another ticket touching this file?". The radar is simply **what now backs that answer.** The Conductor handles a `query_context` whose question matches the collision intent by reading `index.get(path)` (O(1)) and returning inline:

   ```jsonc
   // query_context response (read-grade; the Conductor answers from the index, NO LLM, NO write):
   { "answer": "DEV-1240 also has an active stage editing src/_functions/session.ts.",
     "overlaps": [ { "path": "src/_functions/session.ts", "ticketId": "DEV-1240" } ] }
   ```
   The verb surface is **untouched** — `query_context` is already a frozen worker verb; we only give it real data. Agents proceed *carefully* (the locked decision: inform, don't block) — they may coordinate via the file, narrow their edits, or `emit_signal('dependency-hint', …)` for the human, all on the existing surface.

2. **Push, at stage boundary — fold into the rendered stage context.** When the Conductor renders the next stage's `.claude` config / opening prompt ([`07b §3`](../07b_CONTAINER_RUNTIME.md) per-stage re-render; [`02 §4`](../02_PROTOCOL_AND_FLOW.md) carry-over injection into `promptTemplate`), it appends the current overlap set for that ticket as an **advisory line in the instructions** — "Note: DEV-X also has an active stage editing `<file>`; coordinate or proceed carefully." This is deterministic config emission ([`07b §3`](../07b_CONTAINER_RUNTIME.md): "rendering is deterministic config emission, not a protocol surface") — **not a verb, not a write to any agent-visible state.**

**Hard rule honored:** neither path adds, renames, or relaxes a structured-channel verb ([`02 §2`](../02_PROTOCOL_AND_FLOW.md) frozen 7-worker + 6-assistant surface, all `read|propose`). `query_context` is read-grade; stage-context injection is orchestrator-side deterministic rendering. **No agent ever gets a write verb** (B-23).

---

## 4. Invariants honored

| Invariant | How this addition honors it |
|---|---|
| **B-23 — Conductor is the only writer; no LLM write verb** | The radar is a Conductor-owned deterministic rule. The `link-tickets` suggestion raise is a Conductor write ([`01 §3.3`](../01_ARCHITECTURE.md)); the `TicketLink` is written only on human `accept-suggestion`. No LLM is in any loop. |
| **FROZEN verb surface (writes via control-API → preApiExecute → enqueue → Conductor)** | **Zero new verbs.** Warn = a Conductor-internal rule + a `ws-ai:*` push; Accept = the existing `accept-suggestion` [control-API] op ([CONTROL_API §8](../CONTROL_API.md)); Inform = the existing read-grade `query_context` + deterministic stage-context render. |
| **`runInTenant` on every orchestrator path** | Hook ingest, `evaluateCollision`, the boot rebuild, and drop-on-deactivate all run in the orchestrator outside `/api` → each wraps `runInTenant(workspaceId, …)` ([`04b §11c`](../04b_DATA_MODEL_ADDENDA.md), `Q-SEC-RUNINTENANT`). The index is keyed within a tenant's active sessions; no cross-tenant path exists. |
| **PTY-billing (interactive node-pty only; structured output via hooks + structured channel)** | The data source is the **`PostToolUse` hook** ([`02 §3`](../02_PROTOCOL_AND_FLOW.md), [`07b §9`](../07b_CONTAINER_RUNTIME.md)) which fires in interactive PTY sessions — **no headless `-p`/SDK call** is introduced. The agent-inform read is `query_context` over the structured channel. Billing path untouched (E1). |
| **LuckyStack conventions** | File-based [control-API] route reuse (no new route — `accept-suggestion` exists); function-injection (`functions.db`, `functions.tryCatch` in any handler); strict typing (the `query_context` overlap payload is a typed shape, no `as any`; raw reads zod-parsed per [`07 §D`](../07_ORCHESTRATOR.md)); i18n `useTranslator` for badge text; Tailwind `@theme` tokens only. |
| **V1_SCOPE wins** | Radar is engine-internal + one small board badge + a reused suggestion type — no new screen, no new model, no scope expansion. If [V1_SCOPE](../V1_SCOPE.md) excludes any cited surface, V1_SCOPE wins and the badge degrades to suggestion-only. |

---

## 5. Open sub-decisions (DEFAULTs)

| # | Sub-decision | DEFAULT (flag if wrong) |
|---|---|---|
| **D1** | Overlap granularity | **Per-file** (exact repo-relative `path`). Per-directory rejected (false-positives across `src/`). A future opt-in `directory`-grain for monorepo packages is parked. |
| **D2** | Index durability | **Derived in-memory cache, rebuilt on boot** from `TicketEvent(file-change).metadata.changedFiles[]` ∪ `CarryOver.envelope.changedFiles[]`. No new persisted model. The log is the truth ([`04b §6`](../04b_DATA_MODEL_ADDENDA.md)). |
| **D3** | When an overlap counts | **Only while BOTH tickets have an active stage** (`AgentSession.status ∈ {busy, needs-input, paused}`). `done`/killed/teardown releases the files. Paused counts (still owns the branch). |
| **D4** | Path key normalization | **Normalize hook `file_path` → repo-relative** at ingest so different `DEV-####` worktrees compare on one key. *New op (orchestrator-internal, not a verb):* `normalizeWorktreePath`. Flag if the hook payload already yields repo-relative paths (then no-op). |
| **D5** | Inline file list on the card | **Do NOT persist `Ticket.collisionFiles`.** Badge reads the `link-tickets` suggestion's `ticketIds[]` + `body`; file list rides the suggestion. Add the ui-only delta only if a profiling pass shows the extra fetch matters. |
| **D6** | Self-edit / same-ticket re-edit | **No collision** — overlap is computed as `owners \ {ticketId}` (a ticket editing its own file across turns never self-collides). |
| **D7** | Bash-driven writes (e.g. `sed`, `>`) | **Out of scope for V1** — only `PostToolUse(Edit|Write)` feeds the radar (the locked pitch). `PostToolUse(Bash)` file mutations are not parsed; merge-time `changedFiles` still catches them as the backstop. Flag if Bash-write coverage is required. |
| **D8** | Suggestion churn / debounce | Dedup on the canonical sorted-`ticketIds` pair (§3.3) → one open `link-tickets` per pair, body accretes paths. Optional `debounceMs` reuse from `WorkspaceTrigger` if churn is observed. Default: dedup only, no timer. |

---

## 6. Build checklist (per-lane tasks + a verification line each)

**Lane A — engine/orchestrator (Conductor)**

- [ ] Add the `CollisionIndex` + `TicketFiles` maps to the Conductor; wire a **second consumer** of the existing `PostToolUse(Edit|Write)` hook ingest (no new hook). · **Verify:** unit test — two synthetic `PostToolUse` events for tickets A,B on the same normalized path put both into `index.get(path)`; a third on a distinct path does not.
- [ ] Implement `normalizeWorktreePath` (D4) → repo-relative key. · **Verify:** a path under `DEV-1240`'s clone and the same file under `DEV-1241`'s clone map to one key.
- [ ] Implement `evaluateCollision` as a deterministic, idempotent rule raising/updating one `link-tickets` suggestion per sorted pair (§3.3). · **Verify:** test — N edit events across the same pair raise **exactly one** open `WorkspaceSuggestion(type:'link-tickets', patch:null)`; re-running is idempotent.
- [ ] Implement drop-on-deactivate + `recomputeBadges` on `done`/`kill`/teardown; keep `paused` in (D3). · **Verify:** test — promoting A to `done` removes A's files; a pair that falls below 2 owners clears its badge + supersedes the suggestion.
- [ ] Implement `rebuildCollisionIndex()` in the boot `resumeAll()` pass, `runInTenant` per workspace, under the lease (D2). · **Verify:** test — seed `TicketEvent`/`CarryOver` rows for two active sessions sharing a file, boot, assert the index + the (deduped) suggestion are reconstructed identically.
- [ ] Back `query_context` collision-intent answers with `index.get(path)` returning the typed `{ answer, overlaps[] }` payload (§3.4); **add no verb**. · **Verify:** test — a `query_context` for a contested path returns the other ticket id; for an uncontested path returns empty overlaps. No new entry in the `VERB_REGISTRY`.
- [ ] Fold the current overlap set into the per-stage `.claude` render as an advisory line (§3.4 push path). · **Verify:** rendered stage instructions for a contested ticket contain the "DEV-X also editing `<file>`" note; an uncontested ticket's render is unchanged.
- [ ] Wrap every path (`runInTenant`) + run under the Redis lease. · **Verify:** a unit asserts `currentWorkspaceId()` is set inside `evaluateCollision`/rebuild; no path runs unleased.

**Lane C — Board surface**

- [ ] Add a collision **badge** to `KanbanCard` ([`Board.tsx`](../../_screens/Board.tsx)) rendering pushed `ws-ai:*` collision state; tap → open the `link-tickets` suggestion / related ticket. · **Verify:** a card whose ticket is in an overlapping pair shows the badge with `title` naming the other DEV-id; clears on resolve via merge-on-`seq`.
- [ ] i18n the badge label/title via `useTranslator`; Tailwind `@theme` tokens only (`warning`/`container2`/`muted`). · **Verify:** `npm run lint && npm run build` clean; no hardcoded hex, no untranslated user-facing string.

**Lane (shared) — control-API / suggestion**

- [ ] Confirm Accept routes through the existing **`accept-suggestion`** [control-API] op → Conductor writes `TicketLink{ rel:'relates to', ai:true, reason }`; no new route. · **Verify:** accepting the radar's suggestion materializes one `TicketLink` and flips the suggestion to `accepted`; RBAC ("work on tickets") gates it at `preApiExecute`.

---

## 7. Citations

| Cited | Used for |
|---|---|
| [`02_PROTOCOL_AND_FLOW.md §2`](../02_PROTOCOL_AND_FLOW.md) | frozen verb surface; `query_context` (synchronous read) + `emit_signal`; the "is another ticket touching this file?" motivating example (§6) |
| [`02_PROTOCOL_AND_FLOW.md §3`](../02_PROTOCOL_AND_FLOW.md) | `PostToolUse(Edit/Write)` hook → `TicketEvent` (fires in interactive PTY) |
| [`02_PROTOCOL_AND_FLOW.md §6`](../02_PROTOCOL_AND_FLOW.md) | deterministic Conductor rule "two tickets touched the same file → `link-tickets`"; `query_context` cross-ticket exception |
| [`04_DATA_MODEL.md §1/§2`](../04_DATA_MODEL.md) | `TicketLink`/`TicketFile`; `CarryOver.envelope.changedFiles[]` |
| [`04b_DATA_MODEL_ADDENDA.md §6`](../04b_DATA_MODEL_ADDENDA.md) | `TicketEvent{type:'file-change', metadata.changedFiles[], seq}`, append-only, Conductor-only writer, Redis-INCR `seq` |
| [`04b_DATA_MODEL_ADDENDA.md §7`](../04b_DATA_MODEL_ADDENDA.md) | `AgentSession.status` active set (D3 gate); `resumeAll()` boot pass |
| [`04b_DATA_MODEL_ADDENDA.md §8`](../04b_DATA_MODEL_ADDENDA.md) | `WorkspaceSuggestion` 5-value enum; `link-tickets` carries no `patch`; `status` lifecycle |
| [`04b_DATA_MODEL_ADDENDA.md §11c`](../04b_DATA_MODEL_ADDENDA.md) | `runInTenant` mandatory on every non-`/api` path (`Q-SEC-RUNINTENANT`) |
| [`CONTROL_API.md §4/§6/§8`](../CONTROL_API.md) | `accept-suggestion` op; proposal→accept bridge; optimistic merge-on-`seq` |
| [`07_ORCHESTRATOR.md §Overview/§A/§D`](../07_ORCHESTRATOR.md) | single-instance Conductor under the Redis lease; launch/teardown; zod-parse raw reads |
| [`07b_CONTAINER_RUNTIME.md §0/§3/§4/§9`](../07b_CONTAINER_RUNTIME.md) | `PostToolUse` hooks + pty-agent; per-stage `.claude` re-render (deterministic, no verb); clone-into-volume worktree paths; boot reconcile + derived-cache pattern |
| [`features/12_BOARD_AND_KANBAN.md`](../features/12_BOARD_AND_KANBAN.md) | board "no new persisted fields"; subscribe-first → snapshot → merge-on-`seq`; `KanbanCard` badge surface; control-API not verbs |
| [`_screens/Board.tsx`](../../_screens/Board.tsx) | `KanbanCard` — where the badge renders (alongside the existing terminal/cost chips) |
| `_data/types.ts:49/81/88` | `Ticket`/`TicketFile`/`TicketLink` real field names |
