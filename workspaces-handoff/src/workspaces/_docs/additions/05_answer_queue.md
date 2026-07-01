# Addition 05 — Answer-queue triage stack

> **Tier:** V1 · **Lane:** C · **Status:** NEW (2026-06-11).
> **Pitch:** One cross-ticket, full-screen stack of *everything the AI is waiting on* — every open gate across every ticket, oldest-blocking-first, swipe-to-answer — so the product's core loop ("the AI keeps asking, the human keeps answering") is batched for a thumb.
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #5.

This is a pure **read + propose** surface. It introduces **no new verb, no new persisted model, no new write transport**. It composes three things that already exist: the open-`QuestionSet` data ([09]/[02 §5]), the one-question-per-screen card renderer ([09]), and the existing answer/approve write path (`ws-ai:reply` / `[control-API]`). The whole addition is *aggregation + a swipe shell* over surfaces docs 09, 11, 18 and CLIENT_AND_PUSH already built.

---

## 1. The gap this closes

Today the human-answers-AI loop is **per-ticket**: a `needs-input` ([02 §1]) is answered from *that ticket's* banner ([09 desktop]) or the ticket's mobile one-question-per-screen stepper ([09 mobile]); a promote gate is approved from *that ticket's* `done` banner ([09 promote-as-approve]) or the AIPanel `TicketControlBar` ([11 §6]). The bell + notification center ([18]) *lists* what's waiting, but tapping a row deep-links you **into one ticket** — you answer, then bounce back to the bell, tap the next, navigate in, answer, bounce back. For a 5-person team running a board of agents that block constantly (B-26), the dominant interaction of the entire product is *N round-trips through navigation chrome to clear N gates*.

The vision is "answer the AI from the beach" — and the realistic beach session is **draining a backlog of blocks in one sitting**, not opening one ticket. Nothing today gives you that single uninterrupted stack. CLIENT_AND_PUSH §6 nails the *single*-block lock-screen tap; [18] nails the *listing*; [09] nails the *per-item rendering* — but no surface stitches "every open gate, in order, swipe through them all" into one screen. That stitch is this addition.

**What it is NOT:** not a new question kind, not a new gate type, not a new way to *answer* (it reuses [09]'s `QuestionCard` verbatim and the existing `ws-ai:reply`/`[control-API]` write). It is an **ordered, cross-ticket queue view** whose items are rendered by, and answered through, machinery that already ships.

---

## 2. Locked decision (all gates, oldest-blocking-first, swipe)

**LOCKED (DECISIONS_LEDGER #5):**

1. **Composition — all gates.** The queue contains **both** gate classes across **all** tickets the user can read (RBAC scope, [02 §7]):
   - **blocking needs-input** — every `QuestionSet` with `status:'open'` (`free`/`choice`/`approve` questions, [02 §5]) on a ticket in `needs-input`;
   - **promote/approve gates** — every `done`-stage promote gate, which is itself an `approve` `QuestionSet` ([09 promote-as-approve]: "Approve == Promote").
   Because a promote gate *is* an `approve` `QuestionSet`, **one data source covers both**: open `QuestionSet`s (§3.1). No separate "promote" entity to merge in.
2. **Ordering — oldest-blocking-first.** Sorted ascending by `QuestionSet.createdAt` (the moment the agent blocked). The thing that has been waiting longest is on top. Promote gates and needs-input interleave purely by age — they are not segregated, because to the human they are the same act: *the AI is waiting, clear it*.
3. **Advance-on-answer.** Answering or approving the top item resolves it and **advances to the next**; the stack shrinks by one. Empty stack → a "nothing's waiting" rest state.
4. **Rendering — reuse [09] cards.** Each item renders with the **existing one-question-per-screen card model from [09]** (`QuestionCard` by `kind`: `free` textarea / `choice` one-tap buttons / `approve` two-button gate). A multi-question `QuestionSet` keeps [09]'s in-set stepper (progress dots, "2 of 3 answered", Submit-when-complete); the *outer* swipe advances between **sets**, the *inner* stepper between **questions in a set**.
5. **Semantics — "Approve == Promote" stays.** ([09]/[02 §5]) Approve on a `done`-stage gate is the promote (Conductor carries A→B, spawns next); Reject re-opens the stage with the note as the `--resume` prompt. The queue changes *where* you tap it, never *what it means*.
6. **Write path — no new verb.** Answering routes through the **existing** reply path: `ws-ai:reply {ticketId, answers}` ([09 §user-flow], [11 §6], [05 P1]) — equivalently a `[control-API]` request (CLIENT_AND_PUSH §6, §3.3 below). The cards **propose** `answers`; the **Conductor** writes (B-23, [01 §3.3]). No queue-specific verb, no inline mutation.
7. **Reachability.** From the **TopBar** as a count badge of *blocking* items, and as a **deep-link target from a push notification** (CLIENT_AND_PUSH §6 → into the queue, not just one ticket). **Mobile = full-screen**; **desktop = a focused panel** (a `Sheet`).

**DEFAULTS in the brief — confirmed correct, with one flag:**

| Brief default | Verdict | Note |
|---|---|---|
| Reuse [09]'s one-question-per-screen card model per item | ✅ keep | [09] already specifies the exact `QuestionCard`/stepper; the queue is the *outer* container around it. |
| "Approve == Promote" semantics | ✅ keep | Locked in [09]/[02 §5]; unchanged. |
| Answer via existing control-API / ws-ai reply path, no new verb | ✅ keep | Matches [05 P1] `reply {ticketId,answers}` + CLIENT_AND_PUSH §6. **FLAG (§3.3):** docs 09/11 name the socket `ws-ai:reply`; CLIENT_AND_PUSH §6 names a `[control-API]` route *or* `ws-ai:reply`. That seam is unresolved framework-wide and this addition does **not** resolve it — it calls the existing context method whatever it ends up being. Reported, not papered over. |
| TopBar count badge of **blocking** items | ⚠️ keep, but **define "blocking"** (§3.1 sub-decision AQ-2): badge counts **open needs-input + open promote gates** — i.e. the queue length. The [18] bell badge stays *all unread notifications*; the queue badge is a **distinct, smaller** count (gates only). Two badges, two meanings — flagged so they aren't conflated. |
| Deep-link target from push | ✅ keep | New nav target `answer-queue` (§3.4); push `deepLink.view:'answer-queue'`. |
| Mobile full-screen, desktop focused panel | ✅ keep | `Sheet` (`_components/motion`) full-screen on mobile, right/center focused on desktop — same component [18]'s center + `Sources.tsx` use. |

---

## 3. Build-ready mechanics

### 3.1 Queue composition + ordering (data source: open QuestionSets + promote gates across tickets)

**Single source: open `QuestionSet`s.** Both gate classes are `QuestionSet`s ([02 §5]) — a `needs-input` set carries `free`/`choice`/`approve` questions; a promote gate is an `approve` set on a `done` stage ([09 promote-as-approve]). So the queue is:

```
queue = allReadableTickets
  .flatMap(t => openQuestionSetsFor(t))      // status:'open' only
  .sortBy(qs => qs.createdAt)                 // ascending = oldest-blocking-first
```

- **Filter:** `QuestionSet.status === 'open'` ([02 §5] enum `open|answered|superseded`). `answered`/`superseded` sets never appear (they live in [09]'s `QuestionSetThread` history, not here).
- **RBAC scope:** only tickets the user can read ([02 §7] read scope) — identical to [11]'s "scoped to the user's visible tickets" and [18]'s notification scope. A Member sees only gates on tickets in their scope.
- **Order:** ascending `QuestionSet.createdAt`. **Proposed delta — flag if missing:** [02 §5]'s `QuestionSet` lists `createdAt` (present). No new field needed. If a future tie-break is wanted (two sets same ms), secondary sort by `ticketId` then `id` — deterministic, no schema change.
- **Cross-ticket, not per-ticket:** this is the *only* place in the docs that aggregates `QuestionSet`s across tickets. It needs a **read projection** — see the proposed `AnswerQueueItem` projection below.
- **Live updates:** the queue is fed by the same `ws-ai:needs-input {questionSet}` stream the AIPanel + board banner already subscribe to ([09 §Resolved 4]: "the Conductor pushes **one** `ws-ai:needs-input`; both the chat card and the board banner subscribe to it"). The queue is a **third subscriber** to that same one event — answering in the queue, the banner, or the AIPanel all resolve the one set; no double-resolve ([09 §Resolved 4]). On `ws-ai:status` flipping a ticket out of `needs-input` (answered elsewhere), the queue drops that item live.

**Proposed read projection (no persisted model — a UI/types.ts projection, like `NotificationItem`):**

| `AnswerQueueItem` field | Type | Source |
|---|---|---|
| `questionSetId` | `string` | `QuestionSet.id` ([02 §5]) |
| `ticketId` | `string` | `QuestionSet.ticketId` |
| `ticketRef` | `string` | denormalized ticket code (e.g. `DEV-1241`) for the card header |
| `kindSummary` | `'needs-input' \| 'promote'` | derived: `promote` if the set is an `approve` gate on a `done` stage, else `needs-input` — drives the glyph/tint only |
| `createdAt` | `string` | `QuestionSet.createdAt` — the sort key |
| `questions` | `Question[]` | `QuestionSet.questions` ([02 §5]) — handed straight to [09]'s `QuestionCard` |

**INDEX delta (proposed):** add `AnswerQueueItem` to `types.ts` (a read-projection of `QuestionSet`, mirroring how `NotificationItem` projects `Notification`). **No Prisma/DATAMODEL change** — `QuestionSet` already holds every field; this is a derived view.

### 3.2 UI surface (reuse features/09 cards; TopBar badge; mobile full-screen; cite prototype components)

**Reachability + chrome:**

- **TopBar badge (desktop).** In `TopBar` (`_shell/Shell.tsx`, the function at L92 with `onNotifications`): add a second affordance next to the existing `bell` (L141–143) — an `Icon name="layer-group"` (or `inbox`) button whose badge is the **queue length** (open gates in scope), styled like the existing unread badge (L143 pattern, `bg-wrong`/`bg-primary` token — Rule 14, no arbitrary hex). It is **distinct** from the bell's all-notifications `unread` count (sub-decision AQ-2). Clicking opens the queue panel.
- **Mobile entry.** `MobileChrome.tsx` (`MobileHeader`, L15): add a matching badge button in the header right cluster; the queue opens **full-screen**. The mobile bottom bar (the unread-dot mirror [18] adds) carries the same gate-count dot.
- **Panel shell — reuse `Sheet`.** Use `Sheet` (`_components/motion.tsx`, L62) — the same component [18]'s mobile center and `Sources.tsx` use. **Mobile:** `side`-agnostic full-screen sheet. **Desktop:** a focused right/center sheet (`SPRING_SHEET` from `motion.tsx` L17). The backdrop is the existing `Backdrop` (`motion.tsx` L43).
- **Item rendering — reuse [09] verbatim.** Each queue item is [09]'s **one-question-per-screen** body: the **`QuestionCard`** ([09 §UI, "New components"]) rendered by `kind` (`free` textarea / `choice` big stacked one-tap buttons ≥44px / `approve` two-button Approve/Reject gate). A multi-question set reuses [09]'s in-set stepper (progress dots, "2 of 3 answered", Submit-when-all-answered, [09 §Resolved 1] all-at-once submit). The queue adds only the **outer swipe shell** around `QuestionCard` — it does **not** fork or reimplement the card.
- **Outer swipe + header.** Top of the card: the `ticketRef` chip + a `StatusPill` (`_components/primitives.tsx` L86) reflecting `needs-input` (or `done` for a promote gate), a `kindSummary` glyph/tint (mirror the `NOTIF_TINT`/`EVENT_TINT` map pattern from [18]/`TicketDetail.tsx`), and an **"N waiting"** counter. Swipe-left / swipe-right (or Skip/Next) advances **between sets**; the in-set stepper's dots advance **between questions**. `prefers-reduced-motion`-safe transitions (reuse the `SPRING_*` transitions in `motion.tsx`); a tap "Open ticket" escape hatch (`openTicket(ticketId)` from context) for anyone who wants full context before answering.
- **Empty / rest state.** When the queue is empty, render `EmptyState` (`primitives.tsx` L210) — "All caught up — the AI isn't waiting on anything." This is the *good* terminal state of the core loop.
- **Reused primitives:** `Sheet`/`Backdrop`/`Popover` (`motion.tsx`), `WsButton`/`IconButton`/`StatusPill`/`EmptyState`/`Segmented` (`primitives.tsx`), `Icon` (`Icon.tsx`), `useWorkspaces` (`WorkspacesContext.tsx` — `navigate`/`openTicket`/RBAC scope). **New (small):** `AnswerQueueSheet` (the swipe shell hosting `QuestionCard`) + a `useAnswerQueue()` selector (builds the ordered `AnswerQueueItem[]` from the live `QuestionSet` state). That is the entire new surface — everything else is reuse.

```
Mobile: full-screen swipe stack            Desktop: focused Sheet panel
┌───────────────────────────┐             ┌─ Waiting on you · 4 ──────────────[✕]┐
│  ◀  Waiting on you · 4  ▶  │             │ ❓ DEV-1241  ·  needs-input  · 6m    │
│  DEV-1241 · needs-input·6m │             │   Which auth provider first?         │
│                            │             │   [ Microsoft ] [ Google ] [ Okta ]  │  ← [09] choice
│  Which auth provider       │             │                       ● ○ ○ ○        │  (4 sets queued)
│  should we wire first?     │             ├──────────────────────────────────────┤
│  ┌──────────────────────┐  │             │ next ▸ DEV-1244 · promote · 14m       │
│  │      Microsoft       │  │             └──────────────────────────────────────┘
│  ├──────────────────────┤  │
│  │       Google         │  │             TopBar:  🔔3   ▦4   (bell=all unread,
│  └──────────────────────┘  │                              ▦=gates waiting)
│   ● ○ ○ ○   (4 queued)     │
└───────────────────────────┘
```

### 3.3 Answer/approve path (control-API / ws-ai reply — no new verb)

Answering a queue item is **byte-for-byte the [09]/[11] submit** — the queue is just the surface the user tapped from:

- **Answer (`free`/`choice`/`approve`):** on the in-set Submit (all questions answered, [09 §Resolved 1]), emit the **existing** `ws-ai:reply {ticketId, answers}` ([09 §user-flow], [11 §6 socket events], [05 P1]). The Conductor stamps `answers` onto the `QuestionSet` (`status:'answered'`, `answeredAt`), **resumes the same agent** via `--resume <sessionId>` ([02 §1], [09]), and flips the ticket `needs-input → busy`. The set leaves the queue (its `status` is no longer `open`).
- **Approve == Promote:** Approve on a `done`-stage gate is the same lever — the Conductor carries A→B and spawns the next stage ([09 promote-as-approve], [02 §1]). Reject re-opens the stage with the note as the `--resume` prompt and flips back to `busy` ([09 §Resolved 2]). Identical to tapping it in [09]'s banner or [11]'s `TicketControlBar` — only the entry point differs.
- **Propose-not-write (B-23).** The cards hand `answers`/the approve to the Conductor; they write **nothing** ([01 §3.3], [02 §7]). Optimistic UI: the item shows "submitting…" ([09] `submitting` state) then drops from the queue when `ws-ai:status`/`ws-ai:needs-input` confirms; a ~10s timeout reverts ([11 §Resolved 5] pattern) if the Conductor never confirms (e.g. workspace `stopped`).
- **Immutability + supersede:** answers are immutable post-submit ([09 §Resolved 3]); a re-ask is a **new** `QuestionSet` that simply appears as a fresh queue item (the prior set goes `answered`/`superseded` and leaves). No queue-specific edit path.

**FLAG — the reply-transport seam (reported, not resolved here).** [09]/[11]/[05 P1] name the write `ws-ai:reply {ticketId,answers}` (a **socket** event). CLIENT_AND_PUSH §6 calls the same thing "a `[control-API]`/`ws-ai:reply` path." CONTROL_API §8's catalogue has `mark-read`, `accept-suggestion`, `pause`/`promote`-via-`control`, **but no `answer-questionset`/`reply` row** — the QuestionSet-answer write is the one user lever the [control-API] catalogue doesn't enumerate, because [09]/[11] route it over the `ws-ai:*` socket instead. **This addition does not pick a winner** — it calls whatever the context exposes as "submit answers for this ticket" (today the `ws-ai:reply`-backed method [11] wires). **Recommended (for the framework owner, out of this addition's scope):** if the team standardizes all user writes onto `[control-API]` (per CONTROL_API's stated goal of *one* write mechanism), add an `answer-questionset {ticketId, questionSetId, answers}` row to §8 and have the AIPanel + queue + banner all call it; until then, `ws-ai:reply` stays the path and this surface follows it. Either way **no new verb** and **the Conductor is the only writer** — the seam is purely *which existing transport*, not *whether a new one*.

### 3.4 Push deep-link integration (cite CLIENT_AND_PUSH, features/18)

The queue is a **first-class push deep-link target**, extending CLIENT_AND_PUSH §5.5/§6 and [18 §5]'s D65 `navigate(...)`:

- **New nav target.** Add `'answer-queue'` to the `navigate({view,…})` shape ([18 §5] D65 / `WorkspacesContext` `WsView`). A push payload may carry `deepLink:{ view:'answer-queue' }` (open the whole stack) **or** the existing `deepLink:{ view:'ticket', ticketId, tab:'overview' }` (open one ticket's banner). **Proposed default:** a `needs-input` push deep-links to **`answer-queue`** (the stack, oldest-first — the batched core loop) rather than a single ticket; the single-ticket deep-link stays available for the [18] notification-center row tap. This is the one behavioral change from [18]: *the push opens the stack, the bell row opens the ticket.* (Sub-decision AQ-1 — flag if the owner prefers single-ticket on push.)
- **Redaction unchanged (D80, B-34, CLIENT_AND_PUSH §5.4).** The push payload stays **redacted** (title + "open to view"); the queue's question bodies (which routinely quote secrets, rule 19) are fetched **in-app behind auth** when the PWA focuses ([18 §Resolved 1], CLIENT_AND_PUSH §5.5/§11). The SW's `notificationclick` posts `open-notification` (CLIENT_AND_PUSH §5.5) with `deepLink.view:'answer-queue'`; the in-app handler opens `AnswerQueueSheet` and the cards render the fetched, authed `questions`. The OS never sees a question body.
- **Lock-screen fast path (CLIENT_AND_PUSH §6).** The `[Approve] [Open]` notification actions stay [09]'s promote gate: per `Q-CLIENT-NOTIF-ACTIONS` (recommended) `[Approve]` **deep-links into the queue with the top item's full body shown and Approve pre-armed** (not a blind background write) — one more tap confirms, because the body was redacted on the lock screen. From the stack the user keeps swiping the rest. This makes the queue the natural landing for "phone-from-the-beach": one push, then drain the whole backlog.
- **Badge ↔ push coherence.** The TopBar/mobile gate badge (§3.2) counts the same open gates the `needs-input` pushes announce; `Q-CLIENT-BATCH` coalescing ([18]/CLIENT_AND_PUSH §8) still applies to the *push* (N blocks → one "3 waiting" push), while the in-app queue always shows all N rows (no coalescing in-app — fidelity preserved, exactly [18]'s posture).

---

## 4. Invariants honored

- **B-23 / Conductor-only-writer ([01 §3.3]).** The queue is read + propose. Every answer/approve hands `answers` to the Conductor (via the existing `ws-ai:reply`/`[control-API]` path); the cards write nothing. Status is AI-owned; the user pulls exactly the [02 §1] levers (answer a QuestionSet, approve/promote) — both Conductor-executed.
- **FROZEN verbs ([02 §2]).** Zero new structured-channel verbs. The write rides the existing reply path → `preApiExecute`/RBAC (if [control-API]) or the per-session token (if `ws-ai:reply`) → enqueue → Conductor. No queue verb, no inline mutation.
- **runInTenant.** The queue is a per-workspace read (RBAC scope = [02 §7]); the Conductor side of any answer runs under its existing `runInTenant`/`lease:orchestrator` posture (unchanged — the queue adds no server action of its own beyond the existing reply).
- **PTY-billing.** Untouched. Answering resumes the **same** agent via `--resume` ([02 §1]) — the identical session/billing path [09] already uses; the queue spawns no session and changes no token accounting.
- **LuckyStack conventions.** i18n via `useTranslator` for all queue strings (Rule 13); Tailwind tokens only — `bg-wrong`/`bg-primary`/`StatusPill` tints from `index.css` `@theme` (Rule 14, no arbitrary hex); file-based routing untouched (the queue is a `Sheet` over the existing SPA, not a new route); reuses `Sheet`/`QuestionCard`/`EmptyState`/`StatusPill` (Rule 12, no parallel implementations).
- **No new persistence.** `AnswerQueueItem` is a `types.ts` read-projection of `QuestionSet` (like `NotificationItem` projects `Notification`); DATAMODEL/Prisma unchanged.
- **V1_SCOPE wins.** This is a Tier-V1, Lane-C frontend addition that reuses V1 surfaces ([09], [18], CLIENT_AND_PUSH, [11]); it adds no infrastructure, no provider, no engine path. If anything here conflicts with `V1_SCOPE.md`, V1_SCOPE wins.

---

## 5. Open sub-decisions (DEFAULTs — incl. interaction with #6 presence/claim)

| id | Question | DEFAULT (flag to override) | Why |
|---|---|---|---|
| **AQ-1** | Does a `needs-input` push deep-link to the **whole stack** or the **single ticket**? | **Stack (`view:'answer-queue'`)** for the push; single-ticket stays for the [18] bell-row tap. | The push is the "drain the backlog" entry (core loop, batched); the bell row is the "I want *this* one" entry. Two intents, two targets. |
| **AQ-2** | Is the TopBar **gate** badge the same as the [18] **bell** badge? | **No — distinct.** Bell = all unread `Notification`s; the new badge = open gates in scope (queue length). | Conflating them would hide "you have 4 things to *answer*" inside "you have 9 *notifications*". The actionable count must stand alone. |
| **AQ-3** | Ordering tie-break when two sets share `createdAt`? | Secondary sort `ticketId` then `questionSetId` (deterministic). | No schema change; stable order across reloads. |
| **AQ-4** | Does swiping **skip** an item (defer) or only **answer** advance? | **Both:** answer/approve advances *and removes*; a Skip/swipe defers to the **end** of the stack (it stays `open`, just re-queued last) — never resolves anything. | Lets a user punt a hard question and keep draining; the gate stays open until truly answered (B-23 — skipping writes nothing). |
| **AQ-5 (↔ Addition #6 presence/claim)** | When two teammates open the queue at once, can both answer the same gate? | **Optimistic + last-write-loses-gracefully:** both may open; on submit, the Conductor resolves the **first** `ws-ai:reply` and the set goes `answered`; the second client's item is already gone (live drop via the shared `ws-ai:needs-input`/`status` stream, [09 §Resolved 4]). **If Addition #6 lands a claim/presence lock**, the queue should **honor a `claimedBy` marker** — show a "Alice is answering" badge on a claimed item and soft-disable its submit — *deferred to #6*; until #6 ships, the optimistic path above is the v1 behavior. | [09 §Resolved 4] already guarantees no double-*resolve* (one `ws-ai:needs-input`, all surfaces subscribe); the only gap is two people *typing* the same answer — a UX wrinkle #6 (presence/claim) is the right place to close, not this addition. **Flagged so #6's design accounts for the cross-ticket queue as a claim surface, not just the per-ticket banner.** |
| **AQ-6** | Multi-question set inside the stack — does the outer swipe jump sets mid-set? | **No:** the outer swipe is disabled until the current set is submitted or explicitly Skipped (AQ-4); within a set, [09]'s dots/back navigate questions. | Prevents losing half-entered answers ([09 §Resolved 3] immutability is post-submit; pre-submit a stray swipe must not discard typing). |

---

## 6. Build checklist (per-lane + verification)

**Lane C (frontend / phone) — the whole addition lives here.**

| # | Task | Verify |
|---|---|---|
| 1 | Add `AnswerQueueItem` projection to `_data/types.ts` (read-view of `QuestionSet`). | `npm run build` types clean; no Prisma/DATAMODEL diff. |
| 2 | `useAnswerQueue()` selector in `WorkspacesContext.tsx`: flat-map open `QuestionSet`s across RBAC-scoped tickets, sort `createdAt` asc (tie-break AQ-3), subscribe to the live `ws-ai:needs-input`/`ws-ai:status` stream so items add/drop live. | Open two tickets into `needs-input`; both appear oldest-first; answering one (elsewhere) drops it from the queue live (no reload). |
| 3 | `AnswerQueueSheet` component: `Sheet` shell (full-screen mobile / focused desktop), header (`ticketRef` + `StatusPill` + `kindSummary` tint + "N waiting"), hosting [09]'s `QuestionCard` + in-set stepper; outer swipe/Skip between sets (AQ-4, AQ-6); `EmptyState` rest state. Reuse only — no `QuestionCard` fork. | `choice`/`approve` need zero keyboard (≥44px targets); `free` raises it; `prefers-reduced-motion` honored; empty stack shows the rest state. |
| 4 | TopBar gate badge (`_shell/Shell.tsx` `TopBar`, distinct from bell — AQ-2) + mobile header/bottom-bar badge (`MobileChrome.tsx`), opening `AnswerQueueSheet`. | Badge = open-gate count in scope; updates live; click/tap opens the stack; distinct from the bell's unread count. |
| 5 | Submit wiring: call the existing reply path (`ws-ai:reply {ticketId,answers}` via context; §3.3 seam) for answers; existing approve/promote for `approve` gates; optimistic "submitting…" + ~10s timeout revert ([11 §Resolved 5]). **No new verb, no direct write.** | Answer a `free`+`choice`+`approve` set → Conductor resumes (`--resume`), ticket `needs-input→busy`, item leaves queue; Approve a `done` gate → promote A→B; Reject re-opens to `busy`. |
| 6 | Nav target `'answer-queue'` in `WsView`/`navigate` (D65); push `deepLink.view:'answer-queue'` handling in the SW `open-notification` handler (CLIENT_AND_PUSH §5.5) → opens the stack, fetches bodies in-app behind auth (redaction preserved, AQ-1). | Backgrounded PWA → redacted `needs-input` push (title only) → tap → stack opens, top item's full body fetched authed and rendered; `[Approve]` action pre-arms approve on the top item. |
| 7 | i18n all strings (Rule 13); tokens only (Rule 14). | `npm run lint && npm run build` zero warnings/errors; no arbitrary hex; all user-facing text via `useTranslator`. |

**Cross-lane / report-only (NOT built here):**
- The **reply-transport seam** (§3.3 FLAG) — framework owner decides `ws-ai:reply` vs a new `[control-API] answer-questionset` row in CONTROL_API §8. Reported, not resolved.
- **Addition #6 (presence/claim)** must treat the cross-ticket queue as a claim surface (AQ-5), not just the per-ticket banner. Hand to #6's design.

**Server side:** none new. The queue reuses the existing `QuestionSet` reads, the `ws-ai:needs-input`/`ws-ai:status` streams, and the existing reply/approve write the Conductor already executes.

---

## 7. Citations

- **[09] `features/09_QUESTIONS_IN_TICKETS.md`** — one-question-per-screen stepper (§User flow / Mobile); `QuestionCard` + `QuestionSetThread` (§UI New components); kinds `free`/`choice`/`approve` (§Scope); **Approve == Promote** + Reject re-opens (§Promote-as-approve, §Resolved 2); all-at-once submit (§Resolved 1); immutability/supersede (§Resolved 3); one `ws-ai:needs-input`, all surfaces subscribe, no double-resolve (§Resolved 4); `ws-ai:reply` submit + `--resume` (§Verbs/Hooks).
- **[18] `features/18_NOTIFICATIONS.md`** — bell + unread badge in `TopBar` (§UI), four `NotificationItem` types incl. `needs-input` (§Data), D65 `navigate({view,ticketId,tab})` deep-link (§User flow 5), `Notification.link`, redaction D80 (§Resolved 1), `mark-read` control-API op.
- **`CLIENT_AND_PUSH.md`** — push→deep-link→answer pipeline (§5–6); redacted-by-default payload + in-app authed body fetch (§5.4–5.5, D80/B-34); `notificationclick` → `open-notification` (§5.5); `[Approve] [Open]` actions + pre-armed approve `Q-CLIENT-NOTIF-ACTIONS` (§6); `Q-CLIENT-BATCH` coalescing (§8); every client write is propose→Conductor (§11).
- **[02] `02_PROTOCOL_AND_FLOW.md`** — status machine + `needs-input` (§1); three user levers, status AI-owned (§1); `ws-ai:needs-input`, `request_input` blocking (§2); `QuestionSet`/`Question` schema, `status:open|answered|superseded`, `sessionId`, Approve==Promote (§5); RBAC read scope / B-23 (§7).
- **[11] `features/11_WORKSPACE_AI_PANEL.md`** — inline question-card rendering of a `questionSetId` bubble (§Scope, §User flow 2); `reply {ticketId,answers}` + `control` socket events (§Verbs); scoped-to-visible-tickets (§Resolved 1/3); optimistic + ~10s timeout (§Resolved 5); `TicketControlBar` (§UI New components).
- **[CONTROL_API] `CONTROL_API.md`** — the write transport contract (§1, §3), control-API ↔ verbs distinction (§4), op catalogue §8 (no `answer-questionset` row today — the §3.3 seam).
- **[REFERENCE_CODES] `REFERENCE_CODES.md`** — B-22 (catch-up/merge-on-`seq`), B-23 (no-write-verb / propose+accept), B-34 (notifications + redacted push), D80 (push redaction reversal), DH5 (autonomy-scope).
- **Prototype components** — `_components/motion.tsx` (`Sheet` L62, `Backdrop` L43, `Popover` L23, `SPRING_*`), `_components/primitives.tsx` (`StatusPill` L86, `WsButton` L115, `IconButton` L129, `EmptyState` L210, `Segmented` L176), `_components/Icon.tsx`; `_shell/Shell.tsx` (`TopBar` L92, bell + unread badge L141–143), `_shell/MobileChrome.tsx` (`MobileHeader` L15), `_shell/WorkspacesContext.tsx` (`navigate`/`openTicket`/`toggleAi`/`unreadNotifications`/RBAC scope). `QuestionCard` is [09]'s new component (to be built per [09], reused here).

---

> **Self-check:** No new verb (§3.3, §4). Conductor-only-writer honored — cards propose, Conductor writes (B-23). No new persisted model (`AnswerQueueItem` is a `QuestionSet` read-projection). Reuses [09]'s `QuestionCard`/stepper verbatim and the existing `ws-ai:reply`/`[control-API]` path. Every genuine fork is a flagged sub-decision (§5: AQ-1…AQ-6) with a default. The one framework-level ambiguity (reply transport, §3.3) is reported, not silently resolved. V1_SCOPE wins.
