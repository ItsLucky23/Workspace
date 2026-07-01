# 13 — Backlog & Sprints

> The backlog list (search + quick-filter + person filter), collapsible sprint sections, select-mode + the bulk action bar, and the sprint manager (create/edit with date pickers, workspace-tz). Extends `[02 §1]` (the stage/status state machine the rows render), reuses the shared card/row + filter machinery from `features/12`, and runs bulk ops as **batched control-API the Conductor executes serially** (B-30). Realtime per `[01 §2]` (subscribe-first → snapshot → merge-on-seq, B-22; Redis socket-adapter fan-out to the workspace room).

---

## Scope

**In**

- **Backlog list** — every ticket as a compact row (id, title, labels, stage, status, creator+assignee avatars, last-activity), grouped under collapsible sprint sections.
- **Search + quick-filter + person filter** — the existing top search box (id/title contains), the `Segmented` quick-filter (All / Unrefined / Needs input / Done), and the per-person `Dropdown` (creator OR assignee). One shared predicate with `features/12`'s `BoardFilter` machinery.
- **Collapsible sprint sections** — one section per `Sprint`, showing date-range, days-left, an **active** badge, and a row count; open/closed state per section.
- **Select-mode + bulk action bar** — a toggle reveals row checkboxes; selecting ≥1 ticket floats a bar: **Move · Status · Assign · Sprint · Archive**. Each is a **batched control-API request the Conductor runs serially** (B-30) — never an optimistic client mutation.
- **Sprint manager** — create/edit a sprint: name, **start/end date pickers**, active flag; dates anchored to the **workspace timezone** (D55/`features/10`). Reached from the board's "⚙ Manage sprints…" and a backlog header action.
- **Column sort** — sort the list (e.g. by id, last-activity, status, stage).
- **Mobile single-column select-mode** (D63).

**Out**

- The kanban board itself + AI-driven moves — `features/12`.
- How a single ticket's stage/status is *decided* — `[02 §1]` + the Conductor; bulk ops here are user levers the Conductor executes.
- The cost model / estimate chip — `features/05`.
- Archive's downstream effect (teardown) — orchestrator (`[07 §A]` teardown retains branch + events); this doc only issues the request.

**Deferred**

- **Saved backlog views / per-user filter presets** — later (filter + sort state is session-only in v1).
- **Drag-to-reorder / manual backlog ranking** — order is pipeline/AI-owned + sort-derived, never hand-ranked.
- **Optimistic bulk mutation** — explicitly out (D-default): the bar shows "requested…" and reflects the Conductor's serial result over the realtime channel.

---

## User flow

**Desktop.**

1. **Open the backlog.** All tickets render as rows grouped into **collapsible sprint sections** (default open). Each section header: a collapse chevron, the sprint name, the date-range (`start–end`), an **active** badge when `sprint.active`, and a right-aligned row count.
2. **Filter + search.** The search box filters by `id`/`title` contains; the `Segmented` quick-filter narrows to Unrefined / Needs input / Done; the person `Dropdown` narrows to a creator-or-assignee. Empty result → `EmptyState`. (Same predicate shape as `features/12`'s `BoardFilter`, so a filter set carries the same meaning across board and backlog.)
3. **Sort.** A **column sort** control (header `Dropdown`) orders the visible rows — by id, last-activity, status, or stage; sort applies within each sprint section.
4. **Open a ticket.** Clicking a row opens the ticket (deep-link `navigate({ view, ticketId })`, D65). Last-activity shows on the right.
5. **Select-mode + bulk.** The **Select** toggle reveals row checkboxes (`Backlog.tsx` already does this). Checking ≥1 row floats the **bulk action bar**: **Move** (to a stage), **Status** (set a status), **Assign** (to a member), **Sprint** (move into a sprint), **Archive**. Choosing an action issues a **single batched control-API request** for the selected ids; the Conductor applies them **serially** (B-30), and the rows update over merge-on-seq. The bar shows a transient "requested…" state and clears on confirmation (mirrors `features/11` D60's ~10s control-request timeout).
6. **Sprint manager.** "⚙ Manage sprints…" (from the board picker) or a backlog header action opens the **sprint manager**: a list of sprints with create/edit. Editing a sprint exposes name, **start/end date pickers**, and the active flag; dates are interpreted in the **workspace timezone**. Saving is a control-API write (the Conductor persists). `Sprint` already exists in the model — no new entity.

**Mobile (D63).** The backlog is a **single column**; sprint sections stack and collapse the same way. **Select-mode** works: tapping **Select** reveals checkboxes and the bulk bar docks to the bottom as a sheet-style bar with the same five actions. Search/quick-filter/person collapse into a compact filter row (the person filter and sort behind a small "Filters" affordance). Sprint manager is a full-screen sheet with native date pickers.

**Mockup hint (desktop section + bulk bar):**

```
Backlog                                        9 of 12   [Select]   Sort: Last activity ▾
[🔍 Search tickets…]  [All|Unrefined|Needs input|Done]  [All people ▾]

▾ Sprint 24   May 27–Jun 9   ●active                                              (9)
  ☑ DEV-1240  Fix avatar fallback flicker   [bug][frontend]  Implementatie ● busy  👤👤  2m
  ☐ DEV-1241  Add SSO via Microsoft         [feature][auth]  Plan  ◐ needs-input   👤    14m
▸ Sprint 23   May 13–May 26                                                       (11)
▸ Backlog                                                                          (3)

        ┌ 2 selected │ ⤴ Move  ✓ Status  👥 Assign  📅 Sprint  🗄 Archive  ✕ ┐  ← floats; "requested…"
```

---

## Data

No new persisted entities. `Sprint` already exists (`_data/types.ts`: `{ id, name, start, end, active, ticketCount, daysLeft }`) and the sprint manager edits those fields; `Ticket.sprintId` is the existing link.

- **Renders existing:** `Ticket.{id,title,labels,stageId,status,sprintId}` + `ticketCreator`/`ticketAssignee`/`ticketLinkedMembers`; `Sprint.{name,start,end,active,ticketCount,daysLeft}`; `Member`.
- **Reuses (owned by `features/12`):** the **`BoardFilter`** ui-only shape for the shared search/person/quick-filter predicate — not re-introduced here.
- **`TicketSort`** — ui-only, session-only sort state for the column-sort control. Not persisted.
  ```ts
  type TicketSortKey = 'id' | 'updated' | 'status' | 'stage';
  interface TicketSort {               // ui-only, not persisted
    key: TicketSortKey;
    dir: 'asc' | 'desc';
  }
  ```
  Validation: defaults to `{ key: 'updated', dir: 'desc' }`; pure client comparator over the filtered rows, applied within each sprint group.
- **Sprint-manager edits** are validation-checked client-side: non-empty `name`; if both set, `start <= end`; dates entered/displayed in the **workspace timezone** (stored on `Workspace`, D55 — owned by `features/10`, not added here).
- **Bulk-op selection** is transient component state (`Set<string>` of ticket ids), already in `Backlog.tsx`. Not persisted.

**INDEX delta:** `TicketSort` (ui-only, not persisted; `Sprint` already exists in `04`/`types.ts` and is edited, not introduced; `BoardFilter` is owned by `features/12`)

---

## Verbs / Events / Hooks

**No new verbs.** Backlog read + bulk levers ride the frozen surface + control-API + realtime channel.

- **The backlog is read-only render** of pushed state. Search/filter/sort are pure client predicates over `TICKETS` — no server round-trip, no verb.
- **Bulk ops** (Move / Status / Assign / Sprint / Archive) are **batched control-API requests the Conductor runs serially** (B-30, B-23: user proposes → Conductor executes). One request carries the selected ids + the action; the Conductor applies each as its own board/git/status write (it is the only writer, `[01 §3.3]`). **No optimistic mutation** — rows reflect the merge-on-seq result. RBAC: Move/Status/Assign/Sprint need "Use terminals + work on tickets"; teardown-adjacent Archive uses the "Manage sprints + labels, teardown" tier (reuses the existing RBAC matrix, no change).
- **Sprint create/edit** is a control-API write (the Conductor persists the `Sprint` rows). Cron-anchored timezone reuses `Workspace` tz (D55) — config, not a verb.
- **Live updates** ride the standard contract (`[01 §2]`, B-22): the backlog **subscribes first → snapshot → merges by seq**; bulk-op results and single-ticket changes fan out via the **Redis socket adapter to the workspace room**. No backlog-specific event kind is added.
- The prototype's `Backlog.tsx` bulk bar (`menuHandler.confirm` on Archive, local `Set` selection) is the dummy stand-in; in the real app the bar dispatches the batched control-API request and clears on the Conductor's confirmation.

---

## UI

**Reused (real components from `_screens/Backlog.tsx` + `_components/primitives`):**

- **`Backlog` rows** (`Row`) — the existing compact row (id, title, labels, stage, status, avatars, last-activity); shared shape with `features/12`'s card data.
- **`StatusPill`**, **`LabelChip`**, **`AvatarStack`**, **`Icon`** — row chrome (already present).
- **The collapsible sprint section** — the existing `AnimatePresence` + chevron section with the active badge + count (already present).
- **Search input + `Segmented` quick-filter + person `Dropdown`** — the existing filter row (already present).
- **`Segmented`** — the bulk-bar "Done/Select" toggle (already wired via `WsButton`) + the quick-filter.
- **Bulk action bar** (`BarBtn`) — the existing floating bar with **Move / Status / Assign / Sprint / Archive** (already present); wired to the batched control-API.
- **`menuHandler.confirm`** — Archive confirmation (already present).
- **`Dropdown`** — the new **column-sort** picker (reuse the same `size="sm"` dropdown as the person filter) + the per-action target pickers (Move→stage, Status, Assign→member, Sprint).
- **`WsButton`** / **`EmptyState`** — header actions + the no-match empty state (already present).

**New (small):**

- **`SprintManager`** — a create/edit surface for sprints: a list + an edit form (name, **start/end date pickers**, active flag, workspace-tz hint). Reuses `SectionCard`, `WsButton`, `Toggle`, and a date-picker primitive. Reached from the board sprint picker + a backlog header action.
- **`SortControl`** — the column-sort `Dropdown` (`TicketSort`), session-only.
- **Bulk-action target pickers** — small popovers/sheets behind Move/Status/Assign/Sprint (each a `Dropdown` of the valid targets) before the batched request fires.

**Mobile parity (D63):** **single-column** list, stacked collapsible sprint sections, **select-mode** with a bottom-docked bulk bar (same five actions), filters/sort behind a compact affordance, and the sprint manager as a full-screen sheet with native date pickers.

---

## Extends

- `[02 §1]` — the **two-level stage/status state machine**; backlog rows render `stageId` + `status`, and bulk Move/Status set them via the Conductor.
- `features/12` — the **shared card/row + `BoardFilter`** predicate and the cost/status chrome; this doc reuses them and adds list-only sort + bulk.
- `[01 §2]` — **subscribe-first → snapshot → merge-on-seq** (B-22) + Redis socket-adapter fan-out to the **workspace room** — the live-backlog + bulk-result path.
- `[01 §3.3]` — the **Conductor is the only writer**; bulk ops are levers it executes serially.
- B-30 — **batched control-API, run serially by the Conductor** (no optimistic mutation).
- B-23 — propose/lever → Conductor executes; B-28/RBAC tiers — bulk + sprint-manage scopes (no matrix change).
- `features/10` / D55 — sprint dates anchored to the **workspace timezone** (stored on `Workspace`).
- D63 (mobile single-column select-mode), D65 (row-open deep-link), D66 (Cmd-K/search navigates into a ticket).

---

## Open questions

All backlog/sprint open questions are resolved by the batch-2 decision set (B-30 batched serial bulk, D55 workspace-tz sprints, D63 mobile single-column select-mode). (none)
