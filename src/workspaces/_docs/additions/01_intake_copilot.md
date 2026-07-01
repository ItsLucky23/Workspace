# Addition 01 — Intake co-pilot

> **Tier:** V1 · **Lane:** C + Assistant · **Status:** NEW (2026-06-11).
> **Pitch:** AI-assisted ticket *authoring before the pipeline* — a conversational Assistant interviews the user into a well-formed ticket (scope, acceptance criteria, duplicate + epic detection), then the human's "Create" is the ordinary `quick-add` [control-API] op the Conductor executes.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #1 (this folder's ledger; addition 01 is its first entry — create the ledger row when this lands).

---

## 1. The gap this closes

Today ticket creation is a **dummy title-only box**. The prototype `Board.tsx` has no real quick-add (the only "quick" reference is the click-vs-drag guard at `Board.tsx:62`); the planned `QuickAddSheet` in [features/12 §Quick-add] (D62) is "a single title input + Create" with a `+ more options` expander, and the write is "a **proposal** the Conductor materialises" — except [CONTROL_API §9] (`Q-PROD-TICKET-CREATE`, LOCKED) reconciles that to a **direct** `quick-add` [control-API] write for *human-initiated* creation (no propose→accept loop). So V1's create path produces tickets whose quality depends entirely on what the user happened to type.

Downstream, the pipeline's **Refine** stage ([04b §12] `StageKind:'refine'`, "intake/grooming") then spends a *worker* PTY turn (subscription-billed, in a container) re-deriving scope the author already had in their head. Every under-specified ticket is paid for twice: once by a vague human, once by a Refine-stage Stage-Agent that has to ask `request_input` ([02 §2]) just to learn the basics — and that question round-trips through the [features/09] phone loop, blocking the ticket at `needs-input`.

The gap: **there is no authoring-time assist**. Acceptance criteria, scope boundaries, "is this a duplicate of DEV-1187?", and "this is really an epic, not a ticket" are all knowable *at creation*, by the user's **own Assistant** ([README] role table: "1 per active user, per workspace … read/propose only"), which is already a live PTY the moment they're on the site. Addition 01 moves that intelligence to the front door so the ticket that enters the board is already well-formed — cutting a Refine round-trip and a phone-loop block per ticket.

---

## 2. Locked decision (+ the offline fallback DEFAULT)

**LOCKED — Full AI co-pilot.** Opening ticket creation opens a **conversational Assistant** that interviews the user into a well-formed ticket *every time*: it scopes the request, drafts acceptance criteria, flags likely duplicates, and detects when the ask is really an epic. This is the per-user **Assistant** ([README]; [02 §2] assistant verbs) — propose-only, billed to the Max subscription as one interactive PTY turn per authoring session ([V1_SCOPE §1] "interactive `claude` in a node-pty PTY only").

**The cost, stated plainly:** every co-pilot creation **spends a subscription turn** and **needs a live Assistant** (the user's per-workspace PTY must be up and not suspended/over-budget). That is the deliberate trade for a well-formed ticket.

**DEFAULT — offline / no-turn fallback (flag if wrong).** When the Assistant turn is unavailable, creation MUST degrade to the **existing plain text-box quick-add** ([features/12 §Quick-add] `QuickAddSheet`, title-first + `+ more options`) and still succeed. The fallback fires when **any** of:

- the user is **offline** (phone quick-add with no connectivity — the [features/09]/[CLIENT_AND_PUSH] "from the beach" path);
- the user's Assistant session is **suspended** ([README]: "suspended when they disconnect") or not yet spawned;
- the Assistant is **budget-suspended** — the workspace's `WorkspaceBudget` with `enforcement:'pauseNew'` has fired ([04b §9], D81), so no new turn may start;
- the user **opts out** ("just let me type it") — a one-tap skip on the co-pilot sheet.

In the fallback the ticket is created with exactly what the user typed (the direct `quick-add` write, §3.2), and is **optionally enriched later**: the ticket carries `Ticket.intakeStatus:'unrefined'` (§3.1 delta) so that, the next time a turn is available, the Assistant can offer "enrich DEV-#### now?" — re-running the co-pilot against the existing ticket and proposing the criteria/duplicate/epic findings as a `WorkspaceSuggestion` ([02 §6]; [04b §8]). Enrichment never blocks; it's an offer, not a gate.

**Mechanism boundary (the load-bearing invariant).** The co-pilot **proposes only**; it never writes. The two write moments are both the **Conductor's**, via [control-API]:

| Authoring path | Who drafts | The write | Gate |
|---|---|---|---|
| Co-pilot (online) | Assistant interviews → produces a draft ticket *in the chat UI* | the **user taps Create** → `quick-add` [control-API] op → Conductor materializes the `Ticket` | **instruction = consent** for an ordinary create ([V1_SCOPE §3.3]; [CONTROL_API §9] human-direct creation, NOT propose→accept) |
| Fallback (offline/no-turn) | the user types it raw | same `quick-add` op (queued offline, flushed on reconnect) | same `work-on-tickets` RBAC |
| Later enrichment | Assistant re-reads an existing ticket | `propose_suggestion` → `WorkspaceSuggestion` → user **Accept** = `accept-suggestion` [control-API] op | the B-23 bridge ([CONTROL_API §4]) — a *proposal*, because the AI initiated it |

So: the co-pilot is the **per-user Assistant**; the create is **instruction=consent** (a human tapped Create — [V1_SCOPE §3.3]: "instruction = consent → maps to a [control-API] action that EXECUTES directly, EXCEPT important/destructive actions"; ordinary create is NOT important/destructive, so no extra confirm); **duplicate detection is deterministic** (client-side filter / embedding check, §3.4), *not* necessarily an LLM call.

---

## 3. Build-ready mechanics

### 3.1 Data model (cite 04/04b — real fields or explicit deltas)

The co-pilot writes **no new persisted model**. The materialized ticket is the existing `Ticket` ([04 §1]; prototype `types.ts` `Ticket`). It enters at the pipeline's first stage `idle` ([02 §1]: "user creates ticket → (firstStage, idle)"), keyed by the existing `Ticket.stageId` (free-string id; the typed role is `StageKind` per [04b §12]) and `Ticket.status` ([04b §7] mapping note: status is the AI-owned `TicketStatus`). The fields the co-pilot fills already exist on `Ticket` and are written by the Conductor on `quick-add`: `title`, `description`/`labels`/`assigneeId`/`sprintId` (the [features/12 §Quick-add] `+ more options` set), with `creatorId`/`assigneeId`/`issueUrl`/`mrUrl` as GitLab-derived caches ([04b §13], `Q-DATA-ASSIGNMENT`, B-29 GitLab=SoT).

**Acceptance criteria** are the one shape with no exact home. **Model delta (proposed — must be added):**

| Field / model | Type | On | Why / validation | Status |
|---|---|---|---|---|
| `Ticket.acceptanceCriteria` | `string[]` | `Ticket` | the co-pilot-drafted, user-confirmed criteria list; injected into the Refine/Plan `promptTemplate` so the pipeline inherits them. Each entry non-empty; `[]` allowed (fallback path). | **NEW field delta** — add to `04`'s field-extension table ([04 §3]) + the `types.ts` backfill ([04b §15]). NOT in the current INDEX 14. |
| `Ticket.intakeStatus` | `'unrefined' \| 'copilot'` | `Ticket` | provenance of how the ticket was authored. `'copilot'` = went through the online co-pilot; `'unrefined'` = fallback raw quick-add, eligible for later enrichment (§2). Default `'unrefined'`. | **NEW field delta** — same placement. Drives the "enrich DEV-#### now?" offer. |

> **Why a field, not free-text in `description`:** the Refine/Plan stages bind their `promptTemplate` to typed carry-vars ([02 §4] `{{summary}} {{changedFiles}} {{openQuestions}} {{commitHash}}`); acceptance criteria want the same structured injection (a future `{{acceptanceCriteria}}` carry-var), and the board/quickview ([features/12 §Quickview]) wants to render them as a checklist. Burying them in prose loses both. This is additive and append-safe (no immutability concern — `Ticket` is mutable, not in the [04b §11a] append-only set).

The **draft-in-progress** (the half-formed ticket while the interview is ongoing) is **NOT persisted** — it lives in the Assistant chat / client UI only, exactly like the dummy `chat`/`sendChat` state in `WorkspacesContext.tsx` today. Nothing hits the DB until the user taps **Create** (the `quick-add` write). This keeps the co-pilot side-effect-free until consent, honoring B-23.

Reused (no re-introduction): `QuestionSet`/`Question` ([04 §2]; [02 §5]) for any clarifying questions rendered as cards (§3.4); `ChatMessage.questionSetId` ([features/09 §Data]) when an interview question surfaces as a card in the chat bubble; `WorkspaceSuggestion` ([04b §8], 5-value `type` incl. `create-epic`) for the epic-detection + later-enrichment proposals.

**INDEX delta:** `Ticket.acceptanceCriteria` (NEW), `Ticket.intakeStatus` (NEW). No new model; no new ui-only type beyond the client-side draft state.

### 3.2 Control-API / write path (cite CONTROL_API — real ops or explicit new ops)

**No new verb. No new write transport.** Every write is the existing path: [control-API] `_api` route → `preApiExecute` RBAC → enqueue a `WorkspaceSignal` → Conductor drains and writes ([CONTROL_API §1, §7]).

1. **The create itself is the existing `quick-add` op** ([CONTROL_API §8] catalogue row: `quick-add (user)` · target `{ title, … }` · RBAC `work-on-tickets` · Conductor action "**direct creation** — Conductor materializes the `Ticket`"). The co-pilot does not get its own op — the Assistant fills the sheet, the **user taps Create**, and the *same* `quick-add` request the plain fallback uses fires. The only difference is the `payload` is richer (description, labels, `acceptanceCriteria`, `intakeStatus:'copilot'`).

   **Payload delta on `quick-add` (proposed — must be added to the op's typed payload):** the `quick-add` `payload` gains `acceptanceCriteria?: string[]` and `intakeStatus?: 'unrefined' | 'copilot'`, mirroring the §3.1 fields. This is a payload-shape addition to an existing op, **not a new op** ([CONTROL_API §8]: "New feature docs add rows here, never new verbs" — and here, not even a new row). Validate per [CONTROL_API §7 step 2] (reject `invalid` early): `title` non-empty; `acceptanceCriteria` entries non-empty; `intakeStatus` enum.

2. **`ControlAck` + merge-on-`seq`** ([CONTROL_API §6]) unchanged: the call returns `{ accepted:true, signalSeq }` (an enqueue ack, *not* the ticket); the materialized ticket arrives over `ws-ai:*` and the board merges it on `seq` ([features/12 §Verbs]: "the Conductor materialises the ticket and it appears in the first stage on the next merge-on-seq tick"). The co-pilot sheet shows an optimistic "creating…" affordance ([CONTROL_API §6.3] optimistic-affordance-only) and clears on the Conductor's confirmation.

3. **Offline fallback queues the same op** ([CLIENT_AND_PUSH] PWA + `clientRequestId` idempotency, [CONTROL_API §6.4]): a quick-add typed offline is a `quick-add` request held by the service worker and flushed on reconnect; `clientRequestId` dedups a double-flush. No co-pilot involvement, `intakeStatus:'unrefined'`.

4. **Epic detection + later enrichment use the propose bridge, not a direct write** ([CONTROL_API §4 "the proposal bridge", §9 "AI-drafted creation = a proposal"]). When the Assistant concludes "this is an epic" or re-reads an existing ticket to enrich it, it calls the existing assistant verb **`propose_suggestion`** ([02 §2]) → a `WorkspaceSuggestion(type:'create-epic' | …, status:'open')` ([04b §8]); the user's **Accept** is itself an `accept-suggestion` [control-API] op ([CONTROL_API §8] catalogue) → the Conductor executes. The AI never short-circuits to a write (B-23).

> **Why the create is direct but the epic-split is a proposal:** [CONTROL_API §9] (`Q-PROD-TICKET-CREATE`, LOCKED) — *human-initiated* creation is a direct RBAC-gated write (the human tapping Create IS the authorization; instruction=consent, [V1_SCOPE §3.3]); *AI-initiated* structural change (split into an epic + children) adds the propose→accept gate because the AI is the initiator. The co-pilot interview is assist; the Create tap is the human's instruction.

`runInTenant(workspaceId, …)` wraps every orchestrator-side step — the signal-consumer that drains the `quick-add` signal and the Conductor's materialize-ticket write are both background/non-`/api` paths ([04b §11c]; [CONTROL_API §7] "every such orchestrator-side path runs under `runInTenant`"). Never host/system/out-of-workspace.

### 3.3 UI surface (cite features/01/12 + prototype screens)

**Entry points (reuse the existing creation affordances — do not add a parallel one):** the [features/12 §Quick-add] header **+** button, the Cmd-K "New ticket" action (D65/D66, via `_components/SearchPalette.tsx`), and the mobile bottom-sheet quick-add. Each opens the **co-pilot sheet** when a turn is available, and the **plain `QuickAddSheet`** ([features/12]) when not (§2 fallback conditions).

**The co-pilot sheet** is a thin new surface built from existing primitives (`_components/primitives.tsx`): it is the `QuickAddSheet` shell ([features/12 §New] `QuickAddSheet`) with a conversational pane on top. It reuses the **`AIPanel` chat machinery already in `_shell/Shell.tsx`** (`ChatBubble` at `Shell.tsx:252`, the `chat`/`sendChat` flow at `:272–:331`, currently dummy in `WorkspacesContext.tsx`'s `sendChat`/`chat`) — the interview is just that chat scoped to "author one ticket". Clarifying questions render as **`QuestionCard`s** ([features/09 §UI], `kind:'choice'` one-tap / `kind:'free'` short text) inside the bubble via `ChatMessage.questionSetId` — so the *same* tap-not-type, "from the beach" ergonomics ([features/09 §Mobile]) apply at authoring time.

**The draft preview** (the right/bottom half of the sheet) shows the forming ticket: `title`, `description`, `LabelChip` set, assignee `AvatarStack`, `sprintId` (the [features/12] `+ more options` fields), and the **acceptance-criteria checklist** (the §3.1 delta) — every field user-editable (the co-pilot proposes; the human edits and confirms; B-23). A **duplicate banner** (§3.4) and an **epic banner** ("This looks like 3 tickets — split into an epic?") sit above the preview.

**The two terminal buttons:** **Create** (fires the `quick-add` write, §3.2 — the human's instruction=consent moment) and **Just type it** (one-tap skip → collapses to the plain `QuickAddSheet`, fallback path, opt-out).

**Setup tie-in** ([features/01 §First-index]): a fresh workspace is **usable while indexing** ("skills light up as they finish"). The co-pilot's duplicate/embedding check (§3.4) depends on the RAG/embedding skill; until that source's per-source chip ([features/01]) reaches `done`, the co-pilot runs **without** duplicate detection (the deterministic title/label filter still works; the embedding tier is skipped with a quiet "duplicate check warming up" note). Authoring is never blocked on indexing — same posture as the board.

**Mobile parity (B-37, the headline):** the co-pilot is a bottom-sheet; the interview is one-question-per-screen via the [features/09 §Mobile] stepper for any `QuestionCard`; the draft preview stacks; **Create** and **Just type it** are big tap targets. Offline → the sheet opens directly in plain `QuickAddSheet` mode (no spinner waiting on a turn that can't come).

**Components reused:** `QuickAddSheet`, `LabelChip`, `AvatarStack`, `Dropdown` (assignee/sprint), `WsButton`/`IconButton`, `Segmented`, `EmptyState` ([features/12 §UI]); `ChatBubble`/`AIPanel` (`Shell.tsx`); `QuestionCard` ([features/09]); `SearchPalette` (Cmd-K entry). **New (small):** `IntakeCopilotSheet` (the chat+draft container) and `DuplicateBanner` / `EpicBanner` (pure render of the §3.4 results). i18n via `useTranslator` for every user-facing string (root `CLAUDE.md` Rule 13); Tailwind tokens only (Rule 14).

### 3.4 Assistant flow (cite 02/README — ws-ai:* + QuestionSet)

The co-pilot is the **per-user Assistant** ([README] role table; [02 §2] assistant verb surface — `get_ticket`, `list_tickets`, `read_pipeline`, `propose_suggestion`, `draft_questionset`, `refresh_docs`; all `read|propose`, **never write**). The interview rides the existing **`ws-ai:*` per-user socket channel** ([README] diagram; [02 §1]); no new event kind.

**Interview loop (online):**

1. The user opens create → the client opens (or resumes) the user's Assistant PTY and seeds it with the authoring task + the workspace's pipeline/role context (`read_pipeline`, [02 §2]) so it knows what "well-formed" means for *this* pipeline (e.g. a `professional` preset wants tighter criteria than `simple`).
2. The Assistant interviews conversationally over `ws-ai:*`. When it needs a structured answer (e.g. "which area: frontend / backend / infra?"), it **normalizes the question into a tappable card via `draft_questionset`** ([02 §2]: "normalize/prettify raw questions into mobile-friendly `Question[]`") — the same `Question{kind:'choice'|'free'|'approve'}` shape [features/09] renders. These authoring questions are *transient UI* (no persisted blocking `QuestionSet` row, no ticket exists yet) — they reuse the **card component** without the [02 §2] `request_input` blocking-call machinery (which is a *Stage-Agent* verb for an existing ticket).
3. The Assistant proposes `title` + `description` + `acceptanceCriteria` + suggested `labels` into the draft preview (§3.3). The user edits freely. **Nothing is written** until Create.

**Duplicate detection — deterministic, not necessarily an LLM** (the locked decision): the client runs a **two-tier check**, mirroring the pure-predicate `filtered`/`BoardFilter` pattern already in `Backlog.tsx`/[features/12 §Data]:

- **Tier 1 (always-on, no turn):** a client-side filter over the loaded `TICKETS` — title/label token overlap against open + recent tickets. Pure predicate, zero cost, works offline. Surfaces in `DuplicateBanner` ("Looks like DEV-1187 · 'Fix avatar flicker'").
- **Tier 2 (when the embedding skill is `done`, [features/01]):** an **embedding/RAG similarity** query against the workspace's `RagEntry`/ticket-embedding index ([04 §1] `RagEntry`; [07 §D] RAG delta-indexer) — a deterministic vector lookup, **not an LLM judgement call**. If the index is still indexing (setup §3.3), Tier 2 is skipped.

The LLM (Assistant) is used for *scoping + criteria + epic-detection*, where judgement is the point; **duplicate detection stays deterministic** so it's cheap, offline-capable, and not a subscription turn per keystroke.

**Epic detection** is the one place the Assistant produces a *structural proposal*: if the interview reveals the ask is multiple deliverables, the Assistant calls **`propose_suggestion({type:'create-epic', …})`** ([02 §2]; [04b §8] 5-value enum) → `WorkspaceSuggestion` → `ws-ai:suggestion` → the `EpicBanner` + the [features/11] AI panel. Accept = `accept-suggestion` [control-API] op → Conductor splits it (§3.2). This is propose→accept (AI-initiated), distinct from the ordinary direct create.

**RBAC:** the Assistant acts only as *its own user* ([02 §2] scoping: "an Assistant acts only as its user"; [02 §7] "an Assistant's proposals are additionally gated by its own user's role"). The `quick-add` write it helped author is still gated by `work-on-tickets` at `preApiExecute` ([CONTROL_API §5]) — a user without ticket-write capability can't create even with a perfect draft.

**No write verb anywhere in this flow** ([02 §7] hard rule): the Assistant proposes; the human's Create (instruction=consent) or Accept (proposal bridge) is the [control-API] request; the Conductor is the only writer.

---

## 4. Invariants honored

- **B-23 — AI proposes / instruction=consent; Conductor is the only writer; no LLM has a write verb.** The co-pilot (Assistant) only `read|propose`s ([02 §2, §7]). The two writes (`quick-add` create, `accept-suggestion` epic-split) are **Conductor** actions behind [control-API]. The draft is unpersisted until the human taps Create. ✔
- **FROZEN verb surface — no new structured-channel verb.** Reuses `draft_questionset` + `propose_suggestion` (assistant verbs) only. Every user write is `quick-add` / `accept-suggestion` [control-API] → `preApiExecute` RBAC → enqueue → Conductor. The only schema-surface change is a **payload-field addition** to the existing `quick-add` op (`acceptanceCriteria?`, `intakeStatus?`) — not a new op, not a verb. ✔
- **`runInTenant` on every orchestrator-side path** (tenant = Workspace). The signal-consumer + the Conductor's materialize/epic-split writes run under `runInTenant(workspaceId, …)` ([04b §11c]; [CONTROL_API §7]). Never host/system/out-of-workspace. ✔
- **PTY-billing.** The co-pilot is the interactive `claude` Assistant PTY ([V1_SCOPE §1]; [README]) — never `claude -p`/Agent SDK. Structured questions come via `draft_questionset` + the [02 §3] hooks/structured channel, not TUI scraping. The subscription-turn cost is stated and gated by the budget fallback (§2). ✔
- **LuckyStack conventions.** File-based `_api` route reuse (`quick-add`, `accept-suggestion`) — no new route family; function-injection + strict typing (the `quick-add` payload is a generated typed shape, no `as any`/`as unknown` — root `CLAUDE.md` Rule 21); i18n (`useTranslator`) on all co-pilot strings (Rule 13); Tailwind tokens only (Rule 14). ✔
- **V1_SCOPE wins on scope.** This is the [V1_SCOPE §3.3] Assistant model ("instruction = consent → [control-API] EXECUTES directly, EXCEPT important/destructive") applied to ticket authoring; ordinary create is not destructive → no extra confirm. Nothing here adds out-of-scope surface (no multi-provider, no built-in MR). ✔

---

## 5. Open sub-decisions (DEFAULTs)

| # | Sub-decision | DEFAULT (flag if wrong) |
|---|---|---|
| 5a | Does the co-pilot interview spend **one** turn (single seeded prompt + the user's replies in one session) or one per question round? | **One Assistant session per authoring** — the interview is a single PTY session resumed across replies (`--resume`, [02 §1]), not a turn per question. Caps the subscription cost at ~one session/ticket. |
| 5b | Where do **acceptance criteria** get injected downstream? | Into the **Refine + Plan** `promptTemplate` via a new `{{acceptanceCriteria}}` carry-var ([02 §4] carry-var pattern), alongside the existing `CARRY_VARS`. Renders as a checklist in [features/12 §Quickview]. (Carry-var addition is a `seed.ts`/template change, not a verb.) |
| 5c | Is **later enrichment** auto-offered or user-pulled? | **Offered, never auto-run.** A ticket with `intakeStatus:'unrefined'` shows a quiet "enrich with AI?" affordance when a turn is available; running it is a `propose_suggestion` round the user accepts. Never spends a turn unprompted (respects the away-time / budget posture). |
| 5d | Does duplicate-detection Tier 2 (embeddings) **block** Create on a strong match? | **No — advisory only.** The `DuplicateBanner` warns + deep-links the candidate; Create is never gated on it (the user may legitimately file a near-dup). Matches the [CONTROL_API §6.3] optimistic, non-blocking posture. |
| 5e | On **epic-split**, does the Conductor create children immediately or stage them? | **Immediate on Accept** — the `accept-suggestion`→Conductor creates the epic + child tickets at first-stage `idle` ([02 §1]), same as any `quick-add`. (Epic/sprint RBAC per [02 §7] / [CONTROL_API §5] applies.) |
| 5f | Should the **fallback** path still run Tier-1 duplicate detection? | **Yes** — Tier 1 is a pure client predicate (no turn, offline-safe), so the plain `QuickAddSheet` shows the `DuplicateBanner` too. Only Tier 2 (embeddings) and the LLM interview are turn-gated. |

---

## 6. Build checklist (per-lane tasks + a verification line each)

**Lane C (frontend):**

- [ ] `IntakeCopilotSheet` — chat pane (reuse `AIPanel`/`ChatBubble` from `Shell.tsx`) + editable draft preview (reuse `QuickAddSheet` fields). → *Verify:* opening create with a live Assistant shows the conversational sheet; the draft preview reflects Assistant proposals and is fully user-editable before Create.
- [ ] Fallback gating — detect offline / suspended / budget-paused / opt-out (§2) and render the plain `QuickAddSheet` instead. → *Verify:* with the socket down, create opens the plain sheet immediately (no spinner) and a typed ticket is created with `intakeStatus:'unrefined'`.
- [ ] `DuplicateBanner` + Tier-1 client predicate over `TICKETS` (mirror `Backlog.tsx` `filtered`). → *Verify:* typing a title overlapping an existing open ticket surfaces the banner with a working deep-link; Create is NOT blocked (5d).
- [ ] `EpicBanner` rendering a `create-epic` `WorkspaceSuggestion` + Accept wired to `accept-suggestion`. → *Verify:* an epic-split proposal renders the banner; Accept fires the [control-API] op (mocked) and the optimistic affordance clears on confirm.
- [ ] Entry-point wiring — header **+**, Cmd-K (`SearchPalette`), mobile bottom-sheet all route through the co-pilot/fallback selector. → *Verify:* all three entry points open the correct mode; mobile is one-question-per-screen + big tap targets (B-37).
- [ ] i18n + Tailwind-token pass. → *Verify:* `npm run lint && npm run build` clean; no literal strings, no arbitrary hex.

**Assistant lane (orchestrator-side):**

- [ ] Seed an authoring Assistant session with pipeline/role context (`read_pipeline`) + the authoring task prompt. → *Verify:* the seeded Assistant asks pipeline-appropriate questions (tighter for `professional` than `simple`).
- [ ] Interview-question normalization via `draft_questionset` → transient `QuestionCard`s in chat. → *Verify:* a raw "which area?" comes back as a one-tap `choice` card; answering advances the interview without persisting a blocking `QuestionSet`.
- [ ] Tier-2 embedding duplicate query against `RagEntry`/ticket index ([07 §D]); skip when the embedding source is still indexing ([features/01]). → *Verify:* with the index `done`, a semantically-similar (different-wording) ticket is flagged; with it indexing, Tier 2 is silently skipped and Tier 1 still works.
- [ ] Epic detection → `propose_suggestion({type:'create-epic'})`. → *Verify:* a multi-deliverable ask produces exactly one `WorkspaceSuggestion(create-epic, status:'open')`; the Assistant writes nothing else (B-23 conformance).

**Backend / data lane (Conductor + control-API):**

- [ ] `quick-add` payload delta — add `acceptanceCriteria?: string[]` + `intakeStatus?` to the existing op's typed payload + `preApiExecute` validation ([CONTROL_API §5, §7]). → *Verify:* a `quick-add` with criteria materializes a `Ticket` carrying them at first-stage `idle`; an unauthorized caller (no `work-on-tickets`) is denied at the gate with `reason:'rbac'` and nothing enqueues.
- [ ] `Ticket.acceptanceCriteria` + `Ticket.intakeStatus` schema + `types.ts` backfill ([04 §3]; [04b §15]). → *Verify:* Prisma migration applies; the prototype `types.ts` carries both fields; `npm run build` clean.
- [ ] `{{acceptanceCriteria}}` carry-var injection into Refine/Plan `promptTemplate` (5b). → *Verify:* a promoted ticket's Refine prompt contains the rendered criteria (golden-fixture diff, cf. [GOLDEN_PLAN_STAGE]).
- [ ] Offline `quick-add` idempotency on reconnect flush (`clientRequestId`, [CONTROL_API §6.4]). → *Verify:* a double-flushed offline create yields exactly one ticket.
- [ ] `runInTenant` wrap on the signal-consumer + materialize write ([04b §11c]). → *Verify:* the materialize path throws on a missing tenant rather than cross-tenant writing (the [04b §11c] hard-crash failure mode).

---

## 7. Citations

- **[features/01_WORKSPACE_SETUP.md]** — "usable while indexing / skills light up as they finish"; per-source `indexing`/`done` chips (the §3.3 duplicate-check-warming posture); `Project.linkedFiles` GENERATE-vs-LINK; the `menuHandler` slide-in/bottom-sheet shell.
- **[features/09_QUESTIONS_IN_TICKETS.md]** — `QuestionCard` (`free`/`choice`/`approve`), one-question-per-screen mobile stepper, `ChatMessage.questionSetId`, tap-not-type ergonomics (reused for authoring questions, §3.3/§3.4).
- **[02_PROTOCOL_AND_FLOW.md]** — §1 ticket lifecycle (`firstStage, idle`; the three user levers); §2 assistant verbs (`draft_questionset`, `propose_suggestion`, `read_pipeline`; scoping "acts only as its user"); §4 carry-over `promptTemplate`/`CARRY_VARS` (the `{{acceptanceCriteria}}` injection, 5b); §5 `QuestionSet`/`Question`; §6 `WorkspaceSuggestion`/`ws-ai:suggestion`; §7 the proposes-only B-23 boundary + "no Assistant session has any write verb".
- **[CONTROL_API.md]** — §1/§7 enqueue-not-write; §4 the proposal bridge + AI-vs-human axis; §5 `preApiExecute` RBAC (`work-on-tickets`); §6 `ControlAck` + merge-on-`seq` + idempotency; §8 the `quick-add` + `accept-suggestion` catalogue rows; §9 `Q-PROD-TICKET-CREATE` (human-direct create vs AI-drafted proposal).
- **[04_DATA_MODEL.md]** — §1 `Ticket`/`RagEntry`; §2 `QuestionSet`/`Question`; §3 field-extension table (placement of the `acceptanceCriteria`/`intakeStatus` deltas).
- **[04b_DATA_MODEL_ADDENDA.md]** — §7 `AgentSession` status mapping (`needs-input` is a ticket state); §8 5-value `WorkspaceSuggestion` (`create-epic`) + `patch`; §11c `runInTenant`; §12 `StageKind` (`refine`); §13 field sweep + GitLab-derived caches (`Q-DATA-ASSIGNMENT`); §15 `types.ts` backfill (where the new fields land).
- **[README.md]** — the Assistant role ("1 per active user, per workspace … read/propose only", suspended on disconnect); the three-role model; the subscription-PTY constraint.
- **[features/12_BOARD_AND_KANBAN.md]** — §Quick-add `QuickAddSheet` (title-first + `+ more options`; D62), the create-as-write path, merge-on-seq materialization, `BoardFilter` pure-predicate pattern (the Tier-1 duplicate filter); §Quickview (criteria checklist render).
- **[V1_SCOPE.md]** — §1 interactive-PTY-only / GitLab-only; §3.3 the Assistant "instruction = consent → [control-API] EXECUTES directly, EXCEPT important/destructive"; the invariants block (B-23, frozen verb surface, single-writer Conductor, `runInTenant`).
- **Prototype** — `_shell/Shell.tsx` (`AIPanel`/`ChatBubble`/`chat`/`sendChat`, lines 252–331); `_shell/WorkspacesContext.tsx` (`sendChat`/`moveTicket` dummies); `_screens/Board.tsx` (no real quick-add yet — the co-pilot/`QuickAddSheet` is net-new); `_components/SearchPalette.tsx` (Cmd-K entry); `_components/primitives.tsx` (`LabelChip`/`AvatarStack`/`Dropdown`/`WsButton`/`Segmented`/`EmptyState`).
