# 21 — Search & command palette (one global search)

> Wires the **top search bar** (currently a dead button in `TopBar`) and the **⌘K palette** (`SearchPalette.tsx`) into **one** global search over **both tickets AND Sources/docs**, plus quick-actions, recent, and quick-create. Extends `[01 §3.2]` (the Assistant's read verbs back results), `[02 §2]` (`get_ticket`/`list_tickets`/`query_context` — no new verbs), and `[03 §4]` (the seeded `InfoDoc` set is searchable). Navigation is the in-app deep-link (D65); fuzzy id/title/name is v1 (D66); **semantic search is documented now but BUILD-DEFERRED**, reusing the RAG seam in [07 §D]. The chat-driven counterpart (ask the Assistant "find X") lives in feature 11; this doc is the keyboard/typeahead surface.

---

## Scope

**In**
- **One search, two entry points**: the `TopBar` **search bar** (today's `onCmdK` button, NOT yet wired to results) and the **⌘K palette** (`SearchPalette.tsx`) open the *same* search UI.
- **Unified index over tickets + Sources/docs**: typing `summary` matches the `project-summary` `InfoDoc`; Enter **navigates** there (the `Sources` screen, doc preview) via deep-link (D65). Tickets match on `id` + `title`; docs/skills on `name` + `summary`.
- **Quick-actions** (go-to Board/Backlog/Terminals/Pipeline/Sources/Usage, toggle Workspace-AI), **recent** (recently opened tickets), and **quick-create** ("New ticket" → the quick-add sheet, feature 12 / D62).
- **Keyboard nav**: arrow up/down to move the highlight, **Enter** to activate the highlighted row, Esc to close (D66 arrow+Enter).
- **Mobile**: a full-screen search **sheet** (the palette is desktop-shaped today; mobile gets the sheet variant).

**Out**
- The semantic ranking itself — **documented here, build-deferred** (reuses the [07 §D] RAG seam; see Deferred).
- Authoring/uploading Sources — that is the build phase (feature 03) and the `Sources` screen; search only *finds + navigates*.
- The Assistant's conversational "find" — feature 11 (chat); the palette is the non-chat typeahead path.

**Deferred (documented, not built v1)**
- **Semantic search** across the board + Sources. v1 is **fuzzy** id/title/name (client-side over `TICKETS` + `DOCS`). Semantic ranking reuses the **frozen-per-commit RAG store** ([07 §D]): a `query_context`-backed slice-query (`$vectorSearch` filtered on the active project's snapshot `commitHash`, [07 §D]) returns ranked doc chunks; the same input box upgrades to "results ranked by meaning" with no new verb and no new entry point. The existing footer in `SearchPalette.tsx` ("Semantic search across the whole board — coming soon") is exactly this seam.
- Search across *other* workspaces (v1 is scoped to the active workspace's RBAC read scope).

---

## User flow

1. **Open.** ⌘K from anywhere, or click the `TopBar` search bar (both call the same open handler). The palette drops in (desktop) / slides up as a sheet (mobile); the input autofocuses.
2. **Empty state.** Shows **Quick actions** (a 2-col grid of go-to-view actions) + **Recent** (recently opened tickets from `ctx.recent`) + **New ticket** quick-create at the top.
3. **Type a query.** Results update live, grouped:
   - **Tickets** — fuzzy over `id` + `title` (e.g. `1241`, `secret`, `DEV-1245`).
   - **Sources** — fuzzy over `InfoDoc.name` + `summary` (e.g. `summary` → `project-summary`; `conventions`; `db-schema`). Skills (`SkillEntry`) match on `name` + `description`.
   - **Actions** — matching quick-actions stay listed.
4. **Navigate (D65).** Arrow to a row, **Enter**:
   - a ticket → `openTicket(id)` (opens the ticket tab) → maps to the future `navigate({view:'ticket', ticketId})` URL route.
   - a Source/doc → `navigate('sources')` + open that doc's preview Sheet → future `navigate({view:'sources', docId})`.
   - an action → run it (go-to-view / `toggleAi` / quick-create).
   The palette closes on activate.
5. **Quick-create.** "New ticket" (top of empty state, or typed) → opens the **quick-add** title-only sheet (feature 12 / D62). Per B-23 the typed title becomes a **proposal** the Conductor turns into a ticket — the palette never writes a ticket directly.
6. **Semantic upgrade (deferred).** When [07 §D] is live, the same query additionally pulls ranked doc chunks via `query_context`; results re-rank by meaning. No UI re-entry — the box and Enter-to-navigate are identical.

### Desktop + mobile + mockup

- **Desktop:** the existing `SearchPalette` `motion.div` (centered, `max-w-xl`, `max-h-[70vh]`), arrow/Enter keyboard nav, Esc badge. The `TopBar` search bar opens the same component.
- **Mobile:** a full-screen `Sheet` variant; results are full-width tap rows; the soft keyboard pushes the list. Heavy "find + reason" still falls to the Assistant chat (feature 11) — the phone-from-the-beach path.

```
🔍 Search tickets, sources, actions…           [Esc]
─ Tickets ──────────────────────────────────
 DEV-1241  Wire MS OAuth secret          needs-input
 DEV-1245  dnd-kit board columns          busy
─ Sources ──────────────────────────────────
 📄 project-summary   High-level orientation…
 📄 db-schema         Prisma models, small…
─ Actions ───────────────────────────────────
 ＋ New ticket      ⌨ Go to Board
──────────────────────────────────────────────
 ✨ Semantic search across the whole board — coming soon
```

---

## Data

No new persisted models. Search reads existing projections client-side in the prototype:

| Source | Type | Note |
|---|---|---|
| `TICKETS` | `Ticket[]` (`id`, `title`, `status`) | fuzzy match on `id` + `title`; renders `StatusPill`. |
| `DOCS` | `InfoDoc[]` (`name`, `summary`) | fuzzy match on `name` + `summary`; Enter → `Sources` + preview. |
| `SkillEntry[]` | `name`, `description` | matched alongside docs in the Sources group. |
| `ctx.recent` | `string[]` | recently opened ticket ids (already in context) for the empty-state Recent list. |

Semantic results (deferred) are **not persisted** — they are a live `query_context` slice over the frozen RAG store ([07 §D]), returned ranked at query time. No new field.

**INDEX delta:** (none)

---

## Verbs / Events / Hooks

**No new verbs.**

- **Read verbs (`[02 §2]`)**: in the real build the typeahead is backed by the Assistant's **`list_tickets`** (ticket index) and, for the deferred semantic tier, **`query_context`** (the slice-query over the frozen RAG store, [07 §D]); `get_ticket` hydrates a selected ticket. v1 prototype filters the in-memory `TICKETS`/`DOCS` client-side.
- **Quick-create** → a **control-API** request (the Conductor turns the proposed title into a `Ticket`, B-23) — a proposal, not a verb and not a direct client write. (The quick-add sheet itself is feature 12.)
- **Navigation** is pure client-side deep-link (D65) via `navigate`/`openTicket`/`toggleAi`.
- **No `WorkspaceTrigger`/hook** — search is a read surface; nothing fires on a query.

---

## UI

**Reused (real components)**
- `SearchPalette` (`_components/SearchPalette.tsx`) — the home of this feature; today it already filters `TICKETS` + `DOCS`, lists quick-actions + recent, and Enter-opens the first ticket. This doc **wires the `TopBar` search bar to open it** (so both entry points share one component) and adds full arrow-key highlight nav (D66).
- `TopBar` search button (`_shell/Shell.tsx`) — currently calls `onCmdK`; that handler opens the same palette (one search, two entry points).
- `Section`, `TicketRow` (already inside `SearchPalette`); `StatusPill`, `Icon` (`_components/primitives`); `SPRING_POP` (`_components/motion`).
- `useWorkspaces` — `navigate`, `openTicket`, `recent`, `toggleAi`.

**New (small, scoped)**
- A `useArrowNav` hook (or inline reducer) for the highlight index + Enter-activate over the flattened result list (D66).
- A mobile `Sheet` wrapper variant of the palette body (reuses the desktop result list verbatim).
- A `SemanticHint`/upgraded footer state (the existing footer becomes the live "ranked by meaning" indicator once [07 §D] ships) — no new component, a state flip.

**Mobile parity:** full-screen `Sheet`, full-width tap rows, same grouped results. Arrow-nav degrades to tap; the keyboard's "Go/Search" key activates the highlighted row.

---

## Extends

- "[01 §3.2] Assistant (per-user, read/propose only)" — search results are backed by the Assistant's read verbs; quick-create is a proposal the Conductor executes (B-23), never a direct write.
- "[02 §2] frozen verb surface" — `list_tickets` (index), `get_ticket` (hydrate), `query_context` (the deferred semantic slice); no new verb.
- "[03 §4] seeded `InfoDoc` set" — the GENERATE/LINK docs from the build phase are exactly the Sources this search spans; Enter navigates to them.
- "[07 §D] RAG delta-indexer + vector store" — the **deferred** semantic tier reuses the frozen-per-commit `$vectorSearch` slice (filtered on the active project's snapshot `commitHash`); the input box upgrades in place, no new entry point.
- "feature 03 (build phase)" — produces/links the docs that become searchable Sources.
- "feature 12 (quick-add ticket)" — the quick-create target; the palette's "New ticket" opens that sheet (D62).
- "D65 — deep-link `navigate({view, ticketId?, tab?, terminalId?})`" — every result activation is a deep-link; documented as the future URL route (`/ws/:id/ticket/:tid`, etc.).
- "D66 — one global search over tickets + Sources/docs; fuzzy v1; semantic build-deferred; arrow+Enter" — the locked decision this doc realizes.

---

## Resolved (final micro-decisions sweep, 2026-06-04 — INDEX D84)

1. **21.q1 — result cap + ordering → D84:** **keep the v1 caps (tickets 8, docs 5) and the group order Tickets → Sources → Actions, even after the semantic upgrade.** Semantic mode re-ranks *within* groups; it does not collapse the groups into one interleaved list.
