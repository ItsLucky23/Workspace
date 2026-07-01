# Addition 07 — "Why is this card here?" provenance peek

> **Tier:** V1 (light) · **Lane:** C · **Status:** NEW (2026-06-11).
> **Pitch:** Surface the last AI decision/signal that moved or blocked a card — a one-line summary always on the card, the full reasoning/signal trail in the existing quickview — so the no-drag, AI-driven board stops looking opaque.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #7.

---

## 1. The gap this closes

The board is **AI-driven, no-drag** ([12 §"AI-driven, NO-DRAG moves"], [02 §6]): a card changes column because the **Conductor** wrote a new `Ticket.stageId` after a user accepted an Assistant `propose_suggestion`, never because a human dragged it. The card animates to its new column via its shared `motion` `layoutId` ([12 §UI], `Board.tsx:73–74`) and the move "just appears." From the user's seat this is **opaque**: a card silently lands in *Review* (or sits stuck in *Implementatie* on `busy`/`stuck`) with no inline answer to *"why is this here?"* The only place that answer lives today is the **Activity screen** (doc 20) or the per-ticket Activity tab — a context switch away from the board. On a phone-from-the-beach, that switch is the difference between "I trust the board" and "I have to go dig."

This addition makes the board **self-explaining** without leaving it: the **last decision/signal** that produced the card's current `stageId`/`status` is shown inline. It is the legibility layer the no-drag model has been missing.

It is deliberately **read-only and storage-free** (see §3.1): everything it shows already exists in the append-only `TicketEvent` log (and is already streamed to the board client by the realtime contract). No new model, no new field, **no new verb**, no Conductor change.

---

## 2. Locked decision (compact line + quickview trail)

**LOCKED:** *Compact line on the card + full trail in the quickview.*

| Surface | What it shows | Source |
|---|---|---|
| **Card (always)** | A **one-line last-decision summary** — the most recent stage/status-transition event + a short rationale verb. e.g. `→ Review · agent reported done` / `⏸ stuck · max-turns, asked a question`. | The latest relevant `TicketEvent` for the ticket (client-derived). |
| **Quickview (hover/tap)** | The **full reasoning/signal trail** — a paginated recent slice of that ticket's events (`status-change` + `ai-message` + the move-causing `command`), newest-first, each deep-linkable into the full Activity tab. | The recent window of `TicketEvent`s already synced to the board client. |

**DEFAULT — flag if wrong (this is the default the prompt told me to assume; I endorse it — see §4):**

- **Data source = the existing append-only `TicketEvent` / `WorkspaceSignal` log** — specifically the latest **status/stage-transition event + its rationale**. **NO new storage, NO new verb.**
- The **compact line is derived client-side** from already-synced events (the board already subscribes to the `workspace-<wsId>` room and merges on `seq`, [01 §2], [20 §"Verbs/Events/Hooks"]) — it is a pure `useMemo` over the loaded event window, mirroring `Board.tsx`'s existing `buildColumns` projection (`Board.tsx:30`).
- The **quickview trail paginates the recent events** for that ticket (D83's bounded-window catch-up already loads a recent slice; older entries lazy-load — [20 §Resolved 20.q1]).
- **Read-only.** The board never writes the log (B-23, [20 §"Source = hooks → Conductor append (no client writes)"]).

> **Conflict check (Rule 3b):** none. The locked decision aligns with [12]'s "no new persisted fields … renders existing data" stance and [20]/[04b §6]'s "the client never writes the log, it subscribes." It adds a **projection**, not a source of truth. If a future reviewer wants the rationale to be a *first-class* field rather than a derived line (e.g. a `WorkspaceSignal.payload.reason` pinned per move), that would be a new persisted shape — **out of V1 scope** and explicitly NOT what is built here.

---

## 3. Build-ready mechanics

### 3.1 Data source (existing TicketEvent/Signal log — no new storage)

The provenance line and trail read the **`TicketEvent`** append-only log ([04b §6]) via its prototype projection **`ActivityEvent`** (`types.ts:137`):

```ts
// types.ts:137 — the real shape the board already has access to (board subscribes
// to the same workspace-<wsId> room, [01 §2] / [20]).
export interface ActivityEvent {
  time: string;
  actor: string;                                   // member id | 'ai' | 'mr'
  ticketId: string;
  type: 'command' | 'file-change' | 'ai-message' | 'status-change' | 'mr' | 'comment';
  text: string;
}
```

Real-model fields the projection stands in for ([04b §6] `TicketEvent`): `seq` (the monotonic per-ticket merge/dedupe key — the **ordering** that lets "latest" be deterministic, NOT `createdAt`/`time`, which is clock-skew-unsafe), `actor` (adds `'conductor'`), `stageId?` (the `StageKind` key the event occurred in — used to detect a *column move*), `sessionKey?` (provenance: `worker:ticket:stage` vs `conductor`), and `metadata Json?` (carries `commitHash`/`changedFiles` already — **no new column** is needed for the rationale; the rendered `text`/`metadata` already carry it).

**Which events are "provenance" events** (the move/block-causing subset):

| Event | What moved/blocked the card | Source hook/verb |
|---|---|---|
| `status-change` (the **primary** signal) | a stage move (`stageId` changed → new column) OR a status flip (`busy`→`done`, `→ needs-input`, `→ stuck`, `→ paused`). | `Stop` hook (done/promote), `Notification(permission_prompt\|idle_prompt)` → `needs-input`, Conductor `stuck` escalation ([02 §1], [02 §3]). |
| `ai-message` (the **rationale**) | the agent's narrated reason next to the transition (e.g. "tests pass, promoting"). | worker `emit_event`/`emit_signal` → Conductor append ([02 §2/§6]). |
| `command` (optional context) | the action that triggered the move (e.g. `npm test → 2 failing` preceding a `stuck`). | `PostToolUse`/`PostToolUseFailure` hook ([02 §3]). |

`WorkspaceSignal` ([02 §6], 5-value `type ∈ observation | stopped | dependency-hint | suggestion-input | config-observation`… — the prompt's "5-value enum"; the durable signal stream the Conductor consumes serially) is the **upstream cause** of a `stuck`/`needs-input` landing (the `stopped` signal path, [02 §6]). The board does **not** read `WorkspaceSignal` rows directly (it isn't streamed to the board client); it reads the **`TicketEvent` the Conductor appended in response** (`status-change` + `ai-message`). This keeps the board on the one stream it already has and honors B-23 (no new subscription, no new server surface).

> **No INDEX delta. No new persisted field. No new verb.** (Same posture as [12 §Data] "no new persisted fields" and [20 §Data] "none — reuses `ActivityEvent`/`TicketEvent`".)

### 3.2 The compact line (client-derived last decision)

A pure client projection — a `useMemo` over the loaded event window keyed to the ticket, ordered by `seq` (real) / array order (prototype stub, [04b §6] "the UI stub's render order stands in for `seq`").

```ts
// ui-only, NOT persisted — derived in Board.tsx alongside buildColumns (Board.tsx:30).
interface CardProvenance {
  icon: string;                  // FontAwesome key: 'arrow-right-long' (move) | 'circle-pause' (paused)
                                 //   | 'triangle-exclamation' (stuck) | 'circle-question' (needs-input) | 'check' (done)
  summary: string;               // i18n'd one-liner: "→ Review · agent reported done"
  kind: 'move' | 'status';       // move = stageId changed; status = same column, status flip
  seq: number;                   // the source event's seq (real) — the trail's cursor anchor
}

// derive: newest provenance event (status-change preferred) for this ticket, joined
// with the adjacent ai-message rationale if one shares the move's seq-neighborhood.
function lastProvenance(events: ActivityEvent[], ticketId: string): CardProvenance | null { /* … */ }
```

**Rendering on the card** (`Board.tsx` `KanbanCard`, between the title row and the footer, `Board.tsx:95`/`:99`):

- One line, `text-[11px] text-muted`, single-line truncate, leading `Icon` (`Board.tsx:18` `Icon` import) tinted by `kind` using **`src/index.css` `@theme` tokens only** (Rule 14): move → `text-muted`; `done` → `text-correct`; `needs-input` → `text-primary`; `stuck` → `text-warning`; `paused` → `text-disabled`. **No arbitrary hex.**
- **i18n mandatory** (Rule 13): every label string via `useTranslator` (`src/_functions/translator`) — the verb fragments ("agent reported done", "max-turns — asked a question", "moved to {stage}") are translation keys, never inline literals.
- **`idle` tickets** (`Board.tsx:85` "no AI") show **no** provenance line (nothing has decided anything yet) — render `null`.
- Pure render; it must **not** add a click target that competes with the card's `handleClick`/dwell guard (`Board.tsx:65–70`). It sits inside the existing card surface and inherits the card's click.

### 3.3 The quickview trail (cite features/20)

The **full trail** lives in the **existing hover/tap quickview** — the `CardQuickview` popover introduced by [12 §UI "New (small)"] (status, labels, assignees, cost entry-point, needs-input question). This addition **extends** that component (Rule 27 — extend, don't fork) with a **"Why is this card here?"** section:

- A **newest-first paginated list** of the ticket's recent provenance events (`status-change` + `ai-message` + the move-causing `command`), each a compact row: actor badge + type chip + relative time + the event `text` — exactly [20 §"Read an event"]'s row anatomy (`EVENT_TINT`/`EVENT_LABEL`, `actorName()`, `ActorBadge` in `Activity.tsx`), reused read-only.
- **Pagination = the bounded recent window** the board already holds (D83: catch-up snapshots a bounded recent window, lazy-loads older — [20 §Resolved 20.q1]). The quickview shows the top N; a **"View full activity →"** affordance deep-links via the existing `navigate({ view:'ticket', ticketId, tab:'activity' })` (D65, [20 §"Deep-link to the ticket"]) into the full Activity tab. **No new navigate shape, no new route.**
- **Reuse, don't rebuild:** the trail rows reuse [20]'s tints/labels/actor helpers; it does **not** mount `FileDiffViewer` (that's the Activity tab's job — the quickview is a *peek*, [12 §"Ticket quickview"]).
- **Mobile parity** ([12 §"Mobile (D63)"]): the quickview is **tap-to-open** on the segment list; the trail stacks full-width, same rows. No hover.

---

## 4. Invariants honored

| Invariant | How this addition honors it |
|---|---|
| **B-23 — Conductor is the only writer** | Read-only projection. The board **subscribes**, never appends ([20], [04b §6]). No client write path is introduced. |
| **FROZEN verbs** (02 §2: 7 worker + 6 assistant, all read/propose) | **Zero new verbs.** Reads existing `TicketEvent` the Conductor already appended from hooks/`emit_event`. ([04b §6/§8] "No new verbs.") |
| **`runInTenant` mandatory** ([04b §11c]) | No new server path. The existing `_api` snapshot fetch + `workspace-<wsId>` subscription that already feed the board are tenant-scoped; this addition adds none. |
| **PTY-billing** | No new session, no new turn, no LLM call — a pure client `useMemo` over already-synced events. Zero billing impact. |
| **No-drag / AI-driven move** ([12], [02 §6]) | Reinforces it — explains the Conductor-written move; never adds a drag handle or a client mutation. |
| **`seq` ordering** ([04b §6], B-21) | "Latest decision" keys on `seq`, never `createdAt`/`time` (clock-skew-unsafe across instances). |
| **LuckyStack conventions** | i18n via `useTranslator` (Rule 13); Tailwind tokens only from `index.css` `@theme` (Rule 14); extend `CardQuickview`/`KanbanCard`, don't fork (Rule 27); self-closing tags, backtick `className` (JSX micro-conventions). |
| **V1_SCOPE wins** | Light, frontend-only (Lane C), no schema, no built-in-forge/MR/CI dependency ([04b §18] DEFERRED set untouched). |

---

## 5. Open sub-decisions (DEFAULTs)

| # | Sub-decision | DEFAULT (proceed unless flagged) |
|---|---|---|
| 07.s1 | **What counts as "the" last decision** when several events share a `seq`-neighborhood (a `command` then a `status-change` then an `ai-message`). | Prefer the **`status-change`** as the spine (it's the actual move/flip); fold the nearest preceding `ai-message` in as the **rationale clause**. The `command` is context, shown only in the trail. |
| 07.s2 | **`busy` with no transition yet** (card hasn't moved; agent just working). | Show the **last meaningful event** ("working: editing Avatar.tsx") rather than blank, derived from the latest `command`/`ai-message`. If there is genuinely nothing, render `null` (no empty line). |
| 07.s3 | **Rationale length on the card.** | Single line, truncate with title-attr full text; the untruncated reason lives in the trail. No multi-line card growth (keeps the card scannable, [12 §mockup]). |
| 07.s4 | **`WorkspaceSignal` direct read** (e.g. surface a `dependency-hint` "blocked by DEV-1241"). | **OUT for V1** — the board reads only `TicketEvent` (already streamed). If a signal needs surfacing, the Conductor already mirrors it into a `TicketEvent`; do not add a second subscription. Revisit only if a class of blocks never produces a `TicketEvent`. |
| 07.s5 | **Caching the derivation.** | `useMemo` keyed on `(ticketId, lastSeqForTicket)` so the line recomputes only when a new event for that ticket arrives — mirrors `Board.tsx:188`'s `useMemo([stageOverrides])`. |
| 07.s6 | **Stale provenance after archive/teardown.** | Final-stage `done` keeps its last line ("→ Final · merged !88"); no special-casing. Archived tickets leave the board ([12]) so the line goes with them. |

---

## 6. Build checklist (per-lane + verification)

**Lane C (frontend) — the whole addition is Lane C.**

- [ ] **Derive `lastProvenance(events, ticketId)`** in `Board.tsx` (or a co-located `_functions` helper if reused by mobile + quickview — check `docs/AI_CAPABILITIES.md` first, Rule 12).
  - *Verify:* a unit/render test asserts a `status-change` to a new `stageId` yields `kind:'move'` + the right token tint; a `→ stuck` yields the warning tint; an `idle` ticket yields `null`.
- [ ] **Render the compact line** in `KanbanCard` between `Board.tsx:95` (title) and `:99` (footer), tokens-only + i18n.
  - *Verify:* line truncates single-line; click still opens the ticket (the dwell/selection guard `Board.tsx:65–70` is unbroken — regression test the click).
- [ ] **Extend `CardQuickview`** (the [12 §UI] new component) with the **"Why is this card here?"** trail: newest-first paginated rows reusing [20]'s `EVENT_TINT`/`EVENT_LABEL`/`actorName`/`ActorBadge`, plus a **"View full activity →"** `navigate({view:'ticket',ticketId,tab:'activity'})` deep-link.
  - *Verify:* the deep-link lands on the ticket's Activity tab (reuses D65, no new route); the trail paginates within the loaded window and the "view full" affordance is the only escape to older events.
- [ ] **Mobile:** the trail renders tap-to-open in the segment-list quickview, stacked, no hover ([12 §Mobile]).
  - *Verify:* on a mobile viewport the line + trail render; no `⋯`/hover dependency.
- [ ] **i18n keys** for every verb fragment added to the translator catalog (Rule 13); **zero inline user-facing literals.**
  - *Verify:* `npm run lint && npm run build` clean (Rule 11); a missing-key scan is clean.
- [ ] **No schema / verb / server change** — confirm the diff touches only `_screens/Board.tsx`, the `CardQuickview` component, and the translator catalog (+ optional `_functions` helper).
  - *Verify:* `git diff` shows no `_api/`, no `_sync/`, no Prisma, no `types.ts` persisted-field add (a ui-only `CardProvenance` type is fine).

**Cross-lane verification (read-only confirmations, no work owned here):**

- [ ] Confirm the board client already receives `status-change` `TicketEvent`s in its loaded window (it does — same `workspace-<wsId>` room as Activity, [01 §2]/[20]); if the board's snapshot is currently column-only, the **only** dependency is that the existing event subscription's window includes provenance events (it already must, for [20] to work).

---

## 7. Citations

- **[features/12_BOARD_AND_KANBAN.md]** — AI-driven no-drag moves + `layoutId` animation (§"AI-driven, NO-DRAG moves", §UI); `StatusPill` states; the `CardQuickview` "new (small)" component this extends (§UI); "no new persisted fields … renders existing data" (§Data); mobile read-only segments + tap-to-open quickview (§"Mobile (D63)").
- **[02_PROTOCOL_AND_FLOW.md]** — the stage/status state machine + the move/block transitions (§1); the FROZEN verb surface, all read/propose (§2, `emit_event`/`emit_signal`); hooks as the event source (§3, `Stop`/`Notification`/`PostToolUse`); `WorkspaceSignal` 5-value type + the `stopped`→`stuck`/`needs-input` path + Conductor-only-writer (§6); B-23 proposes-only boundary (§7).
- **[features/20_ACTIVITY_AND_EVENT_LOG.md]** — the `TicketEvent`/`ActivityEvent` feed the trail reuses; per-ticket feed + row anatomy (`EVENT_TINT`/`EVENT_LABEL`/`actorName`/`ActorBadge`); D65 `navigate({view,ticketId,tab})` deep-link; subscribe-first → snapshot → merge-on-`seq` (B-22) + D83 bounded-window pagination (§Resolved 20.q1); "the client never writes the log, it subscribes" (B-23).
- **[04b_DATA_MODEL_ADDENDA.md §6]** — `TicketEvent` model: `seq` monotonic merge/dedupe key (NOT `createdAt`), `type`/`actor`/`stageId`/`sessionKey`/`metadata`, append-only, Conductor-only writer, "No new verbs." **§8** — `WorkspaceSuggestion` (the propose path behind a move). **§11a/§11c** — append-only + `runInTenant`. **§18** — the DEFERRED built-in surface this addition does NOT touch.
- **Prototype** — `_screens/Board.tsx` (`KanbanCard` `Board.tsx:56`, click/dwell guard `:65–70`, card body `:82–109`, `buildColumns`/`useMemo` `:30`/`:188`, `Icon` import `:18`); `_data/types.ts:137` `ActivityEvent`, `:49` `Ticket` (`stageId`/`status`/`needsInput`/`carryOver`).
