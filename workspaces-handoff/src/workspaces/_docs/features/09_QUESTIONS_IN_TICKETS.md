# 09 — Questions in tickets

> The phone-from-the-beach question/approval UI. Render a `QuestionSet` ([02 §5]) as inline, tappable cards — in the ticket banner and in chat — so a blocked agent can be answered with one tap from a phone. Extends [02 §5] (QuestionSet/Question), [02 §2] (`request_input`, `draft_questionset`), and [02 §6] (the needs-input/Notification path). Voice ([06]) feeds the free-text answer path here; the Assistant panel ([11]) renders these same cards in chat.

---

## Scope

**In**
- Render a `QuestionSet` as **inline question cards**, one card per `Question`, covering all three kinds:
  - **`free`** — short text input.
  - **`choice`** — one-tap buttons from `choices[]` (no typing on mobile).
  - **`approve`** — an **Approve / Reject gate** (two buttons).
- **Multi-question** sets: a set may hold several `Question`s; the set resolves only when every question is answered.
- **Mobile = one-question-per-screen**, tap-not-type wherever possible (`choice`/`approve` need zero keyboard).
- A **thread / history** of answered + superseded sets on the ticket, so you can see what was asked and how it was answered.
- Submitting answers **resolves the blocking `request_input` call** and **resumes the same Stage-Agent** via `--resume`.
- **`approve` on a `done` stage == promote** — the approve card *is* the promote gate ([02 §5]).

**Out**
- Any new verb. This is pure UI + the Conductor's existing answer-injection ([02 §1]).
- Drafting/normalizing raw questions into tappable form — that's the Assistant's `draft_questionset` ([02 §2]), upstream of this rendering.
- The Notification fan-out (in-app/email/push) — owned by [02 §6] / B-34; this doc only renders the deep-link target.
- Multi-select answers, conditional/branching questions, rich-media answers.

**Deferred**
- Inline answer of `choice`/`approve` **by voice** (voice handles `free` only — see [06]). One-tap stays touch-only in v1.

---

## User flow

### Desktop (ticket detail + chat)

1. A Stage-Agent calls `request_input` ([02 §2]); the Conductor sets the ticket to `needs-input`, persists the `QuestionSet`, and fires a Notification ([02 §6]) deep-linking to the ticket.
2. In **TicketDetail**, the existing needs-input banner is upgraded: instead of a single free-text `<input>`, it renders the `QuestionSet` as a stack of **question cards** (the thin `Ticket.needsInput` one-liner stays the denormalized banner title — [02 §5]).
3. The user answers each card in place — type a `free` answer, tap a `choice`, or hit Approve/Reject on an `approve` card. A set with multiple questions shows a small **"2 of 3 answered"** progress hint; **Submit** enables once all are answered.
4. On Submit → the Conductor stamps the answers onto the `QuestionSet` (`status:'answered'`, `answeredAt`), **resumes the same agent** (`--resume <sessionId>`), and flips the ticket to `busy`. The answered set drops into the ticket's **question history**.
5. If the same questions also surfaced as a chat bubble (the bubble carries `ChatMessage.questionSetId`), answering in either place resolves the one set; the other rendering reflects `answered`.

### Promote-as-approve

When a stage is `done`, the promote gate is itself an `approve` `QuestionSet` ([02 §5]). The existing "Promote to <next>" banner action and the `approve` card are **the same gate** in two skins: tapping **Approve** is the promote (Conductor carries A→B and spawns the next stage); **Reject** **re-opens the stage** — the reject note becomes the `--resume` prompt for the **same** Stage-Agent session and the stage flips back to `busy` (this overrides the earlier "hold at `done`" framing, and is consistent with the Reject semantics in 07). On desktop this can stay the button; on mobile it's the Approve/Reject card.

### Mobile (one-question-per-screen)

1. The Notification deep-links to the ticket; the needs-input banner is the first thing in view.
2. Tap into the set → a **full-screen, one-question-per-screen** flow (a `menuHandler` bottom-sheet stepper). Each screen is a single big card:
   - `choice` → large stacked option buttons, **one tap advances**.
   - `approve` → two big buttons (Approve / Reject).
   - `free` → a single textarea with the keyboard up (the only typing case; also the voice target — [06]).
3. A progress dots row at the top; **back** revisits a prior answer. The last screen's action is **Submit** (or it auto-submits after the final single-question tap).

```
Mobile: one question per screen          Desktop: cards inline in the banner
┌───────────────────────────┐           ┌─ Agent needs your input ──────────────┐
│  ● ○ ○        DEV-1241     │           │ Q1  Which auth provider first?         │
│                            │           │     [ Microsoft ] [ Google ] [ Okta ]  │  ← choice
│  Which auth provider       │           │ Q2  Approve the migration plan?        │
│  should we wire first?     │           │     [ ✓ Approve ]   [ ✗ Reject ]        │  ← approve
│                            │           │ Q3  Any constraint I should know?      │
│  ┌──────────────────────┐ │           │     [ short text…              ]       │  ← free
│  │      Microsoft       │ │           │                    2 of 3 · [ Submit ] │
│  ├──────────────────────┤ │           └────────────────────────────────────────┘
│  │       Google         │ │
│  ├──────────────────────┤ │           History (answered/superseded sets)
│  │        Okta          │ │           collapses below the banner.
│  └──────────────────────┘ │
└───────────────────────────┘
```

### States

- **open** — cards interactive; Submit gated on all-answered.
- **submitting** — disabled, inline spinner; the agent is being resumed.
- **answered** — collapses into history with the chosen answers shown read-only.
- **superseded** — if the agent re-asks (new set), the old set renders greyed in history as `superseded` ([02 §5] status).
- **no QuestionSet but `needs-input`** — deterministic-banner fallback ([02 §5]: "if nobody's online, a deterministic banner suffices"): show the `Ticket.needsInput` one-liner with a single free-text reply, exactly today's behavior.

---

## Data

No new model — `QuestionSet` and `Question` already live in 04 ([02 §5]). One additive field links a chat bubble to a set:

| Field | Type | On / extends | Validation |
|---|---|---|---|
| `ChatMessage.questionSetId` | `string` | `ChatMessage` | optional; when present the bubble renders the referenced `QuestionSet` as a question card instead of plain text; must reference a `QuestionSet` in the same workspace/ticket. |

Reused fields (already in 04 / [02 §5], **not** re-introduced here):
- `QuestionSet`: `status:'open'|'answered'|'superseded'`, `sessionId` (the `--resume` target), `questions: Question[]`, `createdAt`, `answeredAt?`.
- `Question`: `kind:'free'|'choice'|'approve'`, `choices?: string[]`, `answer?: string`.
- `Ticket.needsInput` — the denormalized one-liner (first open question) for the board banner.

**INDEX delta:** ChatMessage.questionSetId

---

## Verbs / Events / Hooks

**No new verbs.** Everything routes through the existing surface:

- **`request_input`** ([02 §2]) — the **blocking** verb the Stage-Agent calls. The Conductor "sets `needs-input`, fires `ws-ai:needs-input` + `Notification`, holds the call open until the user answers; returns `{ answers }`." This UI is the human side of that hold: the cards collect `answers`, the Conductor returns them to the still-open call, and the **same agent resumes** (`--resume`, [02 §1]).
- **`draft_questionset`** ([02 §2]) — upstream: the Assistant normalizes raw agent questions into mobile-friendly `Question[]` (one-tap `choice`s, `approve` gates). This doc renders whatever `Question[]` the persisted set holds; it does not draft.
- **[02 §6] needs-input/Notification path** — the set is persisted, `needs-input` is set, and a `Notification` (in-app + email + push, B-34) deep-links here. This doc owns the deep-link target rendering, not the fan-out.
- **`approve` == promote** — an `approve` set on a `done` stage is the promote gate ([02 §5]); Approve is the same user lever as "promote" in [02 §1], executed by the Conductor (carry A→B, spawn next). No separate mechanism.

The user is pulling exactly the [02 §1] levers — **answer a QuestionSet** and **approve/promote** — both of which the Conductor (the only writer) executes. B-23 holds: the cards propose nothing and write nothing; they hand `answers` to the Conductor.

---

## UI

**Reused (real components):**
- The **needs-input `Banner`** in `_screens/TicketDetail.tsx` — currently a single `<input>` + Send; upgraded to host the question-card stack. The `done` `Banner` + "Promote to <next>" `WsButton` is the desktop skin of the `approve` gate.
- `ChatBubble` (`_shell/Shell.tsx`) — when a message has `questionSetId`, it renders a question card inline instead of plain text (the `AIPanel` chat is the [11] home for these).
- `Segmented` / option buttons, `WsButton`, `EmptyState` (`_components/primitives`) — `choice` options, Approve/Reject, Submit, and the deterministic-banner fallback.
- `MenuHandler` / `menuHandler` — the mobile one-question-per-screen stepper is a bottom-sheet; `menuHandler.confirm` already backs the desktop promote preview.
- `StatusPill` — reflects `needs-input` → `busy` on submit.

**New components:**
- **`QuestionCard`** — renders one `Question` by `kind` (`free` textarea / `choice` one-tap buttons / `approve` two-button gate), emits its `answer`. Used both in the banner stack (desktop) and as the body of each mobile stepper screen and each chat bubble.
- **`QuestionSetThread`** — the answered/superseded **history** list on the ticket (read-only past sets with their answers).

**Mobile parity (this is the headline surface):** mobile is **one-question-per-screen**, tap-not-type — `choice`/`approve` need no keyboard, only `free` raises it. Big tap-targets (≥ 44px), progress dots, swipe-dismiss, `prefers-reduced-motion`-safe transitions. This is the literal "manage tickets / answer the AI from the beach" requirement.

---

## Extends

- **[02 §5] QuestionSet** — the whole feature is the UI for "the banner renders the QuestionSet as cards — choice = one tap, approve = Approve/Reject, free = short text," including "`ChatMessage` gains optional `questionSetId` so a chat bubble can render a question card inline" and "**Approve == Promote**."
- **[02 §2] `request_input`** — "**blocking** — Conductor sets `needs-input` … holds the call open until the user answers; returns `{ answers }`. The man-in-the-middle pivot." Submitting the cards is what unblocks it.
- **[02 §2] `draft_questionset`** — the upstream normalizer that produces the tappable `Question[]` this doc renders.
- **[02 §1] resume + levers** — "`needs-input→busy` resumes the **same** agent session via `--resume`"; answering a set and approving/promoting are two of the user's three levers.
- **[02 §6]** — the needs-input → Notification path that deep-links the user here; the deterministic-banner fallback when no Assistant is online.

---

## Resolved

1. **Partial submit** — submit **all answers at once**: Submit enables only once every question is answered, returning a single `{ answers }` payload. No per-answer streaming.
2. **Reject semantics on `approve`** — Reject on a `done`-stage promote gate **re-opens the stage**: the reject note becomes the `--resume` prompt for the same agent and the stage flips to `busy` (overrides the earlier "hold at `done`"; consistent with 07.q3).
3. **Edit-after-submit** — answers are **immutable after submit**; a follow-up creates a **new `QuestionSet`** (the prior set stays read-only in history).
4. **Chat vs. banner as canonical** — the Conductor pushes **one** `ws-ai:needs-input`; both the chat card and the board banner subscribe to it, so there is no double-resolve.
5. **`choice` overflow** — cap at **~6 choices visible** before a scroll/"More" affordance on mobile.
