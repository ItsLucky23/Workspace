# 12 — Board & Kanban

> The scrum board: kanban columns derived from the live pipeline, **AI-driven (no-drag) moves**, status pills, WIP warnings, card context-menu + quickview, the cost chip + terminal/preview badges, the sprint picker, the full filter popover, quick-add, and live merge-on-seq fan-out. Extends `[02 §1]` (the stage/status state machine), `[02 §6]` (the AI-driven, no-drag move model), `features/05` (the cost chip), `features/11` (the Assistant that proposes a move). Realtime per `[01 §2]` (subscribe-first → snapshot → merge-on-seq, B-22; Redis socket-adapter fan-out to the workspace room).

---

## Scope

**In**

- **Columns from the pipeline.** One kanban column per `PipelineStage` (in `order`), exactly the `STAGES` set the editor produces — the board never hard-codes the 7 stages; a workspace on the `simple` preset (`features/02`, 3 stages) renders 3 columns.
- **AI-driven, NO-DRAG moves** (`[02 §6]`). A card moving columns **reflects a Conductor write** — never a client mutation. There is no drag handle. The shared `motion` `layoutId` animates the card to its new column when a move lands over the realtime channel.
- **`StatusPill` states** for every `TicketStatus` (`idle` → "no AI", `needs-input`, `busy`, `done`, `paused`, `stuck`) on each card.
- **WIP-limit warning** per column from `PipelineStage.wipLimit`.
- **Card context-menu** (the `⋯` `PopMenu`): open ticket, open terminal, add reference, pause/resume, copy id, archive.
- **Ticket quickview** — a lightweight peek (status, labels, assignees, cost, the `needs-input` question if any) without leaving the board.
- **Cost chip** (`features/05`) + **terminal badge** (`Ticket.hasTerminal`) + **preview badge** (a `PreviewDeployment` exists for the ticket — owned by the Preview feature doc).
- **Sprint picker** in the header (scopes the board to a sprint; "Manage sprints…" routes to backlog).
- **FULL filter popover** (D61): labels + assignee + status + sprint + has-running-terminal + needs-input.
- **Quick-add** ticket (D62): a title-only sheet with an in-UI **expand / more options** toggle revealing description + labels + assignee + sprint in the same sheet; the submit is a **proposal** the Conductor turns into a ticket (B-23).
- **Live merge-on-seq** updates + **mobile** read-only stage-segments + bottom-sheet filters (D63).

**Out**

- The per-ticket detail surface (tabs, diff, terminal) — `[TicketDetail]` + `features/07`/`features/08`.
- How a move is *decided* (the Assistant proposing it / the user promoting) — `features/11` + the promote lever; this doc only renders the resulting board state.
- Backlog list, sprint manager, bulk ops — `features/13`.
- The cost-estimate model itself — `features/05` (this doc only places the chip).

**Deferred**

- **Drag-to-reorder within a column** — not a thing: order is pipeline/AI-owned, never user-sorted on the board.
- **Saved filter views / per-user board presets** — later (the popover state is session-only in v1).
- **Swimlanes** (group rows by assignee/label) — later.

---

## User flow

**Desktop.**

1. **Open the board.** Columns render left-to-right from `STAGES` (pipeline order). Each column shows its name, a count chip, an AI-driven `robot` marker when `aiEnabled`, and turns amber with a `triangle-exclamation` when `tickets.length > wipLimit`.
2. **Scan a card.** `KanbanCard` shows the `DEV-####` id, title, label chips, the creator+assignee `AvatarStack`, the **cost chip**, and a **terminal badge** (pulsing dot) when `hasTerminal`; a **preview badge** when a live `PreviewDeployment` exists. The `StatusPill` (or "no AI" for `idle`) sits top-right with the `⋯` menu (visible on hover).
3. **Quickview.** Hovering the card surface (not the menu) after a short dwell opens a small **quickview** popover: status, full label set, assignees, cost breakdown entry-point, and — if `status === 'needs-input'` — the `needsInput` question with an "Answer" affordance that deep-links into the ticket's question card (`features/09`). A plain click still opens the ticket (existing dwell/selection guard kept).
4. **Context-menu.** The `⋯` `PopMenu`: **Open ticket**, **Open terminal**, **Add reference…**, **Pause/Resume agent** (ticket-scoped, RBAC-gated per D69), **Copy DEV-ID**, **Archive** (`menuHandler.confirm`). Pause/Resume and Archive are **control-API requests the Conductor executes** — not client mutations, not verbs.
5. **A move happens.** The Assistant proposes "move DEV-1240 to Review" (`features/11`), the user accepts, the Conductor writes the new stage, and the board receives the update over the realtime channel → the card animates to the Review column via its `layoutId`. The user never drags.
6. **Filter.** The header **Filter** button opens the **full popover** (D61): a labels multi-select, an assignee picker, a status multi-select, a sprint picker, and two toggles — **has running terminal** and **needs input**. Active filters show a count badge on the button; clearing resets to all.
7. **Sprint picker.** The header `Dropdown` scopes the board to a sprint (or all); "⚙ Manage sprints…" routes to `features/13`'s sprint manager.
8. **Quick-add.** The header **+** (and a Cmd-K "New ticket" action, D65/D66) opens a **quick-add sheet**: a single title input + Create. An **"+ more options"** toggle expands the same sheet to reveal description, labels, assignee, and sprint. Create submits the draft as a **proposal**; the Conductor materialises the ticket and it appears in the first stage on the next merge-on-seq tick.

**Mobile (D63).** The board is **read-only stage-segments**: a horizontal scroll of stage pills (name + count), tap a segment to show that column's cards in a single scroll list, tap a card to open it. No `⋯` hover menu — the card opens the ticket; ticket-level actions live in the detail sheet. **Filter** opens as a **bottom-sheet** with the same full filter set. Quick-add opens as a bottom sheet (title-first, same expand toggle). Moves are still AI-driven and animate the same way.

**Mockup hint (desktop column + card):**

```
┌ Implementatie  (3) 🤖 ───────────────┐     Filter ▾ (2)   ⊞ Sprint 24 · 5d ▾   ⏸  + Ticket
│ ┌──────────────────────────────────┐ │
│ │ DEV-1240            [● busy]  ⋯   │ │   ── quickview (hover) ───────────────
│ │ Fix avatar fallback flicker       │ │   ● busy · bug, frontend
│ │ [bug][frontend]                   │ │   👤 Sanne · Tom
│ │ (avatars)   📊 €1.18+~€0.90 ● term │ │   📊 €1.18 + ~€0.90 · ~12m
│ └──────────────────────────────────┘ │   ──────────────────────────────────
└───────────────────────────────────────┘   ⚠ over WIP limit (col header amber)
```

---

## Data

No new persisted fields are introduced by the board itself — it renders existing `Ticket` / `PipelineStage` data plus deltas owned elsewhere.

- **Renders existing:** `Ticket.stageId`, `Ticket.status`, `Ticket.labels`, `Ticket.costLabel`, `Ticket.hasTerminal`, `Ticket.sprintId`, `Ticket.needsInput`, `Ticket.viewers`/`creatorId`/`assigneeId` (via `ticketLinkedMembers`); `PipelineStage.{id,name,order,aiEnabled,wipLimit}`; `Sprint`.
- **Reuses (owned by other docs):** the **cost chip** range from `features/05`'s derived `CostEstimate`; the **preview badge** from the Preview feature's `PreviewDeployment` (status `'building'|'live'|'down'`) — neither is introduced here.
- **`BoardFilter`** — ui-only, session-only filter state for the popover (D61). Not persisted.
  ```ts
  interface BoardFilter {              // ui-only, not persisted
    labels: string[];                  // match any
    assigneeId: string | null;         // creator OR assignee match (reuse ticketAssignee/ticketCreator)
    statuses: TicketStatus[];          // match any
    sprintId: string | null;           // null = all sprints
    hasRunningTerminal: boolean;       // Ticket.hasTerminal === true
    needsInput: boolean;               // status === 'needs-input'
  }
  ```
  Validation: every field optional/empty = "no constraint"; an empty `BoardFilter` shows everything. Pure client predicate over `TICKETS`, mirroring `Backlog.tsx`'s existing `filtered` memo.

**INDEX delta:** `BoardFilter` (ui-only, not persisted; the cost chip + preview badge are owned by `features/05` + the Preview doc and not re-introduced here)

---

## Verbs / Events / Hooks

**No new verbs.** Everything rides the frozen surface + the realtime channel + control-API.

- **A move is a Conductor write, never a client mutation** (`[02 §6]`). The Assistant may **`propose_suggestion`** a move (`features/11`); the user accepts; the Conductor executes and the board re-renders from the pushed state. The prototype's `moveTicket`/`stageOverrides` (in `WorkspacesContext`) is the dummy stand-in for "a move arrived from the server" — in the real app the override comes from the realtime snapshot, not a local setter.
- **Quick-add** submits a **draft proposal** — the Conductor materialises the `Ticket` (B-23: AI/user proposes → Conductor executes). It is a **control-API request**, not a verb. (When the Assistant drafts the ticket from a Cmd-K/voice prompt it uses the existing assistant flow; the *write* is still the Conductor's.)
- **Pause/Resume** (ticket-scoped, D69) and **Archive** are **control-API requests the Conductor executes** — user levers, not verbs. RBAC: ticket-scoped pause/resume for anyone with "Use terminals + work on tickets"; the workspace-level "Pause all agents" is Admin+ (reuses the B-28/RBAC tiers, no matrix change).
- **Live updates** ride the standard realtime contract (`[01 §2]`, B-22): the board **subscribes first → fetches a snapshot → merges by seq**, and column/card changes fan out via the **Redis socket adapter to the workspace room**. No board-specific event kind is added.
- **WIP-over** is a render-time predicate (`tickets.length > wipLimit`); an optional `WorkspaceTrigger` (`stage.on_enter → notify` when over WIP) is config over the existing engine (`[03 §1]`) — not part of this doc's mandate, mentioned only as the trigger seam.

---

## UI

**Reused (real components from `_screens/Board.tsx` + `_components/primitives`):**

- **`KanbanColumn`** / **`KanbanCard`** — the existing board cards; extended (not replaced) with the preview badge + quickview-on-dwell. The `LayoutGroup` + `motion` `layoutId` already in place is what animates an AI-driven move.
- **`StatusPill`** — every status; the `idle` → "no AI" branch already exists.
- **`PopMenu`** (`cardMenuItems`) — the card `⋯` menu; pause/resume + archive wired to control-API calls.
- **`AvatarStack`**, **`LabelChip`**, **`Icon`** — card chrome (avatars, labels, the WIP/robot/terminal markers).
- **`Dropdown`** — the header sprint picker (already present).
- **`WsButton`** / **`IconButton`** — header **Filter**, **+ Ticket**, **Pause all agents** (already present).
- **`EmptyState`** — empty columns / empty mobile segment.
- **`Segmented`** — inside the quick-add sheet's expand toggle / mobile segment styling parity.
- **`menuHandler.confirm`** — Archive + "Pause all agents" confirmations (already present).
- **`InfoDot`** — the cost-chip breakdown popover hook (`features/05`'s `CostBreakdown`).

**New (small):**

- **`BoardFilterPopover`** — the full D61 filter popover (a labels `MultiSelect`-style group + assignee `Dropdown` + status chips + sprint `Dropdown` + two toggles). Reuses `Toggle`, `Dropdown`, `LabelChip`, `Segmented`. On mobile it renders as a bottom sheet (same fields).
- **`QuickAddSheet`** — title-first create sheet with an **"+ more options"** expander revealing description/labels/assignee/sprint (D62). Reuses `WsButton` + the existing input styling; opened from the header **+** and the Cmd-K "New ticket" action.
- **`CardQuickview`** — the hover/tap peek popover body (status, labels, assignees, cost entry-point, needs-input question + Answer deep-link). Pure render of a `Ticket`.

**Mobile parity (D63):** read-only stage-segments (the existing `BoardMobile`), tap-to-open, **bottom-sheet** filters and quick-add; no drag, no hover menu. `CardQuickview` becomes tap-to-open on the segment list.

---

## Extends

- `[02 §1]` — the **two-level stage/status state machine** (column = `StageId`, pill = `TicketStatus`); the board is a pure view on it.
- `[02 §6]` — **AI-driven, no-drag moves**: "a card move REFLECTS a Conductor write, never a client mutation." This doc renders that contract (the `layoutId` animation on a pushed move).
- `[01 §2]` — **subscribe-first → snapshot → merge-on-seq** (B-22) + Redis socket-adapter fan-out to the **workspace room** — the live-board update path.
- `features/05` — the **cost chip** (`CostEstimate` range + `CostBreakdown`) placed on the card and in the quickview.
- `features/11` — the **Assistant proposes a move** (`propose_suggestion`); the board re-renders the Conductor-executed result. No write here.
- `features/09` — the quickview's needs-input **Answer** deep-links into the ticket's question card.
- `features/02` — **columns follow the preset** (3/5/7), so the board is preset-agnostic.
- B-23 (propose → accept → Conductor executes), B-28/RBAC tiers (D69 pause/kill scope), D61/D62/D63/D65/D66 (filter / quick-add / mobile / deep-link / search).

---

## Open questions

All board open questions are resolved by the batch-2 decision set (D61 full filter, D62 quick-add + expand, D63 mobile read-only segments, D69 pause RBAC). (none)
