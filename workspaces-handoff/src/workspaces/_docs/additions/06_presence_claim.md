# Addition 06 — Live presence + answer-claim

> **Tier:** V1 · **Lane:** C · **Status:** NEW (2026-06-11).
> **Pitch:** Show who's viewing a ticket/board, who's typing, and who's answering a `QuestionSet` — so two humans don't blindly race the same question; a soft "Sanne is answering" claim plus a server idempotency guard means the FIRST answer wins and the second sees "already answered."
> **Decision source:** [DECISIONS_LEDGER](./00_DECISIONS_LEDGER.md) #6 *(ledger not yet created — this is its first entry; create `additions/00_DECISIONS_LEDGER.md` and seed row #6 from this doc's §2).* 

> **No new verbs.** Presence is a lightweight ephemeral socket facet, not a structured-channel verb and not a `[control-API]` write. The answer path reuses the **existing** `[control-API]` answer op + `clientRequestId` idempotency ([CONTROL_API §6]). The FROZEN 7+6 verb surface ([02 §2]) and the Conductor-only-writer invariant ([01 §3.3], B-23) are untouched.

---

## 1. The gap this closes

[09_QUESTIONS_IN_TICKETS] renders a `QuestionSet` as tappable cards and resolves the blocking `request_input` ([02 §2]) by handing `answers` to the Conductor — but it answers **09.q4 (raised in [02 §5]: "the per-user chat panel is the free-text fallback… two humans could answer the same set")** only structurally: nothing tells a second human that someone is *already* on it, and nothing stops both from submitting. Concretely, three races are unhandled today:

1. **The answer race (the headline).** Two people open the same `needs-input` ticket from a phone push ([V1_SCOPE §3.6]). Both see the same open `QuestionSet`. Both tap Approve. Without a guard the agent could be resumed twice (`--resume` fired twice on one `sessionId`), or one person's answer silently overwrites the other's — a real correctness bug, not just UX noise.
2. **No "who's here".** [12_BOARD_AND_KANBAN] and [TicketDetail] render `Ticket.viewers` (already in the prototype — `types.ts:60`, *"ui-only: member ids currently viewing (presence)"*) but nothing **populates** it live; it's seed data. There's no signal that Tom is also looking at DEV-1240.
3. **No "who's typing".** When someone is composing a `free` answer (or an Assistant chat reply, [11_WORKSPACE_AI_PANEL]), nobody else knows — so two people draft the same answer in parallel.

[09 Resolved #4] already guarantees **one** `ws-ai:needs-input` so the chat card and board banner don't double-*render*; what's missing is the **human-vs-human** layer: presence + a claim hint + a first-writer-wins guard on submit. This addition is purely that layer. It introduces **no new persisted authoritative state** and **no new verb**.

---

## 2. Locked decision (soft claim + idempotency guard)

**Soft claim + server idempotency guard.** (Ledger #6.)

- **Soft, not hard.** The UI shows **"Sanne is answering…"** on an open `QuestionSet` and **viewer avatars** on the ticket/board card. This is an *advisory hint* — **anyone with RBAC may still submit**. There is no lock, no lease on the question, no "you can't answer this" state. A hard lock was rejected: it strands a `needs-input` ticket if the claimer drops off the beach mid-answer (the exact failure mode V1 is built to avoid), and it would need authoritative claim state in the seq log (it doesn't belong there — see §4).
- **First answer wins, server-side.** The *correctness* guarantee is **not** the claim — it's the **idempotency key on the answer op**. The first answer to a given `QuestionSet` resolves the blocking `request_input`, resumes the agent, and flips the set to `answered`. A second answer arriving for an **already-answered** set is a **no-op** at the Conductor; the late submitter gets a clean **"already answered by Sanne"** reconciliation over the realtime channel ([CONTROL_API §6.3] merge-on-`seq`). The race resolves to *correct*, never to *double-resume*.
- **Presence is ephemeral** (DEFAULT — flagged, see §5.A; **endorsed by [01 §3.3 / §sync]** which already says *"presence via an app Redis set"*): a **Redis-backed per-room presence set keyed by `(userId, socketId)`, TTL-refreshed**, broadcast as **lightweight presence events over the existing per-workspace room** (`workspace-<wsId>`, [12 §realtime], [01 §2]). Presence is **NOT** persisted as authoritative state and **NOT** written through the Conductor/seq log (the seq log is for authoritative writes only — §4). `Ticket.viewers` is the **read-projection** of that Redis set for the cards, computed live, never an authoritative DB column.
- **"Typing", "viewing", and "claiming" are three facets of ONE mechanism.** They are all `(userId, socketId)` membership in a scoped presence set with a small `facet` payload (`viewing` | `typing` | `answering:<questionSetId>`). One transport, one TTL, one teardown. "Sanne is answering" is just the `answering` facet scoped to a `questionSetId`.

> **Why this is the right shape (Rule 7b):** the cheap, durable correctness lever already exists — `clientRequestId` + the answer op's idempotency ([CONTROL_API §6]). Presence is the *human-coordination polish* layered on top; making it ephemeral keeps it off the authoritative path entirely, so it can never corrupt board/git/status and never needs a Conductor write.

---

## 3. Build-ready mechanics

### 3.1 Presence transport (ephemeral, Redis room presence — NOT the seq log; why that's allowed)

**Why it bypasses the Conductor/seq log.** The seq log ([04b §6] `TicketEvent.seq`, monotonic via Redis `INCR`) is the **append-only authoritative fact stream** — board moves, status changes, MR events — and the Conductor is its **only writer** ([01 §3.3], B-23). Presence has none of those properties: it is **derived, lossy-by-design, and self-healing** (a dropped socket simply ages out of the set). Persisting "Tom is viewing" as a `TicketEvent` would (a) flood the append-only log with transient noise the rewind-scrubber ([20]) must then filter, (b) demand a *second* write per heartbeat through the single-instance Conductor (a needless serialization bottleneck), and (c) require a *compensating* write on every disconnect. So presence rides a **separate, parallel ephemeral channel** — exactly the *"presence via an app Redis set"* the architecture already names ([01 §sync, line: "presence via an app Redis set"]). The invariant it must honor is narrow: **presence never asserts authoritative state** (it never moves a card, never sets `Ticket.status`, never resolves a `QuestionSet`). It honors it by construction — presence events carry only *who-is-where*, never a state mutation. See §4.

**The Redis structures** (proposed; key shapes go through `registerRedisKeyFormatter`, tenant-scoped per [04b §11], so every key is workspace-isolated and `runInTenant`-safe):

| Key | Type | Member / value | TTL | Purpose |
|---|---|---|---|---|
| `ws:{wsId}:presence:ticket:{ticketId}` | Sorted set (ZSET) | member = `{userId}:{socketId}`, score = `lastSeenMs` | entries pruned past `PRESENCE_TTL` (~15s) | who is viewing this ticket |
| `ws:{wsId}:presence:facet:{userId}:{socketId}` | String (JSON) | `{ facet: 'viewing'|'typing'|'answering', ticketId, questionSetId? }` | `PX PRESENCE_TTL` (~15s) | the user's current facet, auto-expiring |
| `ws:{wsId}:presence:board` | ZSET | member = `{userId}:{socketId}`, score = `lastSeenMs` | pruned past TTL | who is on the board (no ticket focused) |

- **Heartbeat / TTL refresh.** The client emits a presence heartbeat (`ws-ai:presence`, §3.4) every `~5s` while the ticket/board is in view; the server `ZADD`s with `score = now` and re-`SET`s the facet string with a fresh `PX`. A reader computes the live set as *"members with `score > now − PRESENCE_TTL`"* (lazy prune on read; a cheap periodic `ZREMRANGEBYSCORE` sweep keeps the ZSET bounded). **No explicit-delete dependency** — a phone that drops off the beach simply ages out within one TTL window.
- **Fan-out.** A presence change broadcasts a lightweight `ws-ai:presence` event to the **`workspace-<wsId>` room** via the existing **Redis socket adapter** ([12 §realtime], [01 §2]) — the *same* room/adapter the board already uses, so multi-instance fan-out is free and no new room is introduced. Presence events are **not** `seq`-ordered (they carry no `seq`); last-writer-wins on the client by `(userId, socketId)` + `lastSeenMs`, never merged into the authoritative `seq` stream.
- **Teardown.** On `disconnect` (and on explicit `ws-ai:detach`/route-leave) the server best-effort `ZREM`s the member and `DEL`s the facet; the TTL is the backstop if the disconnect handler never runs (crash, network partition). **Multi-tab:** keyed by `(userId, socketId)`, so a user with two tabs shows once after the client dedupes by `userId` for display (avatars are per-user, not per-socket).
- **`Ticket.viewers` is the projection.** The board/card `viewers` ([12 §Data], `types.ts:60`) is computed from `ws:{wsId}:presence:ticket:{ticketId}` at render/snapshot time — it stays **ui-only, never a persisted column** (consistent with its existing prototype comment). Snapshot-on-connect ([01 §2] subscribe-first→snapshot→merge) includes the current presence set so a reconnecting client sees who's here immediately.

### 3.2 Claim + idempotency on answer (cite [CONTROL_API §6])

The **claim** ("Sanne is answering") is **pure presence** — the `answering` facet (§3.1) scoped to `{ ticketId, questionSetId }`. It writes nothing authoritative and grants no exclusivity. It exists only so a second human sees *"Sanne is answering…"* on the open `QuestionSet` card before they also start.

The **correctness guard** is the existing answer write path — **no new op, no new verb**:

1. **Answer submit = the existing answer `[control-API]` op.** [09] resolves a set by handing `answers` to the Conductor; the web-app transport for that is a `[control-API]` request ([CONTROL_API §3], `apiRequest` typed call). It carries `clientRequestId` — the **idempotency key** ([CONTROL_API §6.1/§6.4]). **Proposed concrete op** (a catalogue row, [CONTROL_API §8]; *propose explicit delta — the catalogue lists pause/kill/bulk/etc. but not the answer op by name; add it*):

   | `op` | Target | RBAC | Conductor action | Owning doc |
   |---|---|---|---|---|
   | `answer-questionset` | `{ ticketId, questionSetId }` | work-on-tickets (D69) | stamp `answers` + `answeredBy` onto the `QuestionSet` (`status:'open'→'answered'`), resume the same Stage-Agent (`--resume <sessionId>`), → `busy` | [09], [02 §5] |

   This formalizes what [09] calls "the Conductor's existing answer-injection" — it was always a `[control-API]` write ([09 §Verbs]: *"pure UI + the Conductor's existing answer-injection"*); this doc just names the catalogue row so the idempotency key has a defined home. **It is NOT a verb** ([CONTROL_API §4]).

2. **Idempotency key = `(questionSetId)` , carried by `clientRequestId`.** Per [CONTROL_API §6.4] *"`clientRequestId` dedups re-sends — the orchestrator drops a duplicate signal."* We bind the dedupe to the **`questionSetId`**: the Conductor, draining the `answer-questionset` signal **serially** ([01 §3.3], [CONTROL_API §6.4]), checks the set's current `status`:
   - set is `open` → **first writer wins**: stamp answers + `answeredBy`, resume, emit the authoritative `ws-ai:needs-input`→resolved + `ws-ai:status busy` at the next `seq`.
   - set is already `answered`/`superseded` → **no-op** (the second submit): the Conductor enqueues nothing, emits no second resume, and returns a `conflict` reconciliation. This is exactly [CONTROL_API §6.3]'s *"if the enqueued action is no longer valid when the Conductor drains it… the Conductor emits a `ws-ai:*` correction at the next `seq`; the optimistic affordance is reconciled away by the same merge rule."* The `ControlAck.error.reason:'conflict'` ([CONTROL_API §6.2]) covers the case already detectable at enqueue.
3. **The second submitter sees "already answered by Sanne."** The losing client's optimistic *"submitting…"* ([09 §States] `submitting`) is reconciled by the merge-on-`seq` correction into a read-only *"answered by Sanne · <answers>"* — it drops the set into the [09] question **history** (`status:'answered'`) instead of resuming the agent a second time. **No double `--resume`, no overwrite** — the serial drain + status-check is the hard guarantee; the claim is only the *politeness* that usually prevents the race from happening at all.

**Net (the §2 split):** the **claim is advisory presence** (prevents most races socially), the **idempotency guard is authoritative** (resolves any race that still happens, correctly). Two layers; only the second is load-bearing.

### 3.3 Data model (`Question.answeredBy` provenance delta; cite [04b])

Presence adds **zero persisted fields** (it's all ephemeral Redis, §3.1). The **one** authoritative delta is answer provenance:

**Known gap ([02 §5], [04b §14]):** `Question.answer?: string` records *what* was answered but **not who answered it** — there is no `answeredBy`. Today you cannot tell, after the fact, which human resolved a `QuestionSet`. The idempotency guard makes this gap visible (the "already answered **by Sanne**" message needs a name to show), and the [04b §6] event log records actors for everything *except* the answer itself. **Proposed delta** (additive, V1; lands in [04b]'s field sweep §13 + the [09] data section):

| Field | Type | On / extends | Validation | Source |
|---|---|---|---|---|
| `QuestionSet.answeredBy` | `String? @db.ObjectId` | `QuestionSet` ([02 §5] / [04b §2]) | optional; set by the Conductor when it stamps `answers` (`status→'answered'`); the **first-writer**'s `userId`; immutable after (append-only spirit, [04b §11a] — a re-ask makes a NEW set, [09 Resolved #3]) | [02 §5], [04b §14] |
| *(optional)* `Question.answeredBy` | `String? @db.ObjectId` | `Question` | per-question provenance **only if** multi-question sets need per-answer attribution; **DEFAULT: set-level only** (§5.B) | — |

- **Who writes it:** the **Conductor**, in the same `answer-questionset` action that stamps `answers` (§3.2) — never an LLM verb, never the client (B-23, [04b §7]). It is part of the *one* authoritative write, not a second one.
- **`answeredBy` is set-level (DEFAULT, §5.B).** [09 Resolved #1] already mandates *"submit all answers at once… a single `{ answers }` payload"* — so one human resolves the whole set in one submit; set-level provenance matches that exactly. Per-question `answeredBy` is only meaningful if [09] later allows incremental multi-human answering (it doesn't in V1).
- **`types.ts` backfill:** add `answeredBy?: string` to the `QuestionSet` mirror in the [04b §15] backfill checklist (types-only, no behavior). The `Ticket.viewers: string[]` field stays **ui-only** (`types.ts:60`) — presence populates it live; it is **not** promoted to a persisted column.
- **Event-log echo (no new field):** the answer already produces a `TicketEvent` ([04b §6]); its `actor` is the `answeredBy` userId and `metadata` can carry `{ questionSetId }`. The activity feed ([20]) thus shows "Sanne answered Q-set" for free — `answeredBy` on the set is the *queryable* home, the event is the *audit* echo.

### 3.4 UI surface (avatars, "is answering", typing — cite prototype components)

All presence UI is **read-only render** of the §3.1 ephemeral set + the §3.3 `answeredBy` — pure Lane C, no new persistence.

**Reused real components:**
- **`AvatarStack` / `AvatarBubble`** (`_components/primitives.tsx:39,47`) — the **viewer avatars**. The board `KanbanCard`/`CardQuickview` ([12 §UI]) and [TicketDetail] already render an `AvatarStack` for creator/assignee; presence adds a **second, distinct** "viewers" stack (subtle ring, max ~3 + "+N", the existing `max`/`size` props) driven by the live `Ticket.viewers` projection. A faint **green presence dot** on a viewer avatar = currently active (score within TTL).
- **`currentUser: Member`** (`_shell/WorkspacesContext.tsx:35`) — to exclude self from "others viewing" and to author the local heartbeat.
- **`ChatBubble` / the [09] `QuestionCard`** (`_shell/Shell.tsx`, [09 §UI]) — the **"Sanne is answering…"** hint renders as a small inline strip on the open `QuestionSet` card (banner + chat bubble), an avatar + name from the `answering` facet. When the set resolves it becomes the **"answered by Sanne"** read-only footer (the [09] `answered` state).
- **`menuHandler` bottom-sheet** ([09] mobile stepper) — on mobile the "X is answering" hint sits at the top of the one-question-per-screen sheet, so a second human sees it **before** committing taps.
- **`Shell.tsx` typing indicators** — the Assistant chat composer ([11]) emits the `typing` facet; a *"Sanne is typing…"* line renders under the thread (same pattern as any chat app), reusing the existing chat footer slot.

**New (small, scoped) UI:**
- **`PresenceAvatars`** — a thin wrapper over `AvatarStack` that subscribes to the live `viewers` projection for a ticket/board card and de-dupes by `userId` (multi-tab) with the green-dot active state. Used on `KanbanCard`, `CardQuickview`, and [TicketDetail] header.
- **`AnsweringHint`** — the *"● Sanne is answering…"* / *"answered by Sanne"* strip on a `QuestionSet` card (reads the `answering` facet, falls back to `answeredBy` once resolved). Renders in the [09] banner stack, the mobile stepper header, and the [11] chat question bubble.

**Wire surface (the `ws-ai:*` contract, [05 P1] / [11 §Verbs] — extend, no new verb):**
- **client→server:** `ws-ai:presence { facet:'viewing'|'typing'|'answering', ticketId?, questionSetId? }` (the heartbeat; also the explicit leave when `facet` clears). *(Proposed addition to the `ws-ai:*` client message list — [11 §Verbs] lists `chat/attach/detach/reply/control`; add `presence`. It is a presence ping, not a `[control-API]` write and not a structured-channel verb.)*
- **server→client:** `ws-ai:presence { ticketId?, scope:'ticket'|'board', viewers:[{userId,facet,questionSetId?,lastSeenMs}] }` — the room broadcast the clients render. *(Proposed addition to the `ws-ai:*` server message list alongside `stream/status/event/needs-input/suggestion/notification/exit`.)*
- The **answer submit itself is unchanged**: it remains the [09] `reply {ticketId,answers}` → `answer-questionset` `[control-API]` op (§3.2), now carrying `clientRequestId` bound to `questionSetId`.

---

## 4. Invariants honored (esp. why ephemeral presence doesn't violate Conductor-only-writer)

| Invariant | How this addition honors it |
|---|---|
| **B-23 / Conductor-only-writer** ([01 §3.3], [CONTROL_API §7]) | Presence writes **no authoritative state** — it touches only ephemeral Redis presence keys (§3.1), never `Ticket.status`/board/git/`TicketEvent`/`QuestionSet`. The **only** authoritative write is `answer-questionset`, executed by the **Conductor** (§3.2). The client never mutates authoritative state. |
| **Why ephemeral presence is *allowed* to bypass the seq log** | The seq log is the contract for **authoritative, ordered, durable** facts ([04b §6]); presence is **derived, transient, self-healing** and asserts no state. Routing it through the Conductor would add a needless serial-write per heartbeat and pollute the append-only log. The architecture **already sanctions** this split: *"presence via an app Redis set"* ([01 §sync]). Presence honors the invariant by **construction** — it physically cannot move a card or resolve a set (its events carry no mutation, no `seq`). |
| **FROZEN 7+6 verb surface** ([02 §2]) | **No new verb.** `ws-ai:presence` is a socket presence facet (like a heartbeat), not a structured-channel verb; the answer path reuses the existing `[control-API]` write + `clientRequestId`. |
| **`[control-API]` write path** ([CONTROL_API §3–§7]) | The answer is a `login:true` + `preApiExecute` RBAC (work-on-tickets, D69) → **enqueue** a serial signal → Conductor drains → ack. The handler **enqueues, never mutates** (§7). `answer-questionset` is added as a catalogue row (§3.2), not a bypass. |
| **merge-on-`seq` / no client mutation of authoritative state** ([CONTROL_API §6.3], B-30) | The losing answer is reconciled by a Conductor `ws-ai:*` correction at the next `seq` (§3.2). Presence is **deliberately outside** the `seq` stream (it carries no `seq`); it never merges into or competes with authoritative state. |
| **Idempotency** ([CONTROL_API §6.4]) | `clientRequestId` bound to `questionSetId` makes a duplicate answer a **no-op** at serial drain — first-writer-wins is the hard correctness guarantee. |
| **`runInTenant` + tenant isolation** ([04b §11c]) | Every presence Redis key is `ws:{wsId}:…` via `registerRedisKeyFormatter` (tenant-scoped); every orchestrator-side presence path (the room broadcaster, the answer drain) runs under `runInTenant`. Presence in workspace A is unreachable from workspace B. |
| **PTY-billing** | Presence/typing/viewing spawn **no PTY and consume no tokens** — they are web-app↔Redis↔socket only; they never touch a Claude session. The only session-touching effect is the *first* answer's `--resume` (already billed by [09]); a *duplicate* answer is a no-op and bills nothing. |
| **LuckyStack conventions** | `answer-questionset` is a file-based `_api` route ([CONTROL_API §3]); presence rides the existing `ws-ai:*` socket surface + Redis adapter + key formatter. No bespoke transport. |
| **V1_SCOPE wins** ([V1_SCOPE §5]) | Presence + claim fall squarely in **Lane C real-time** ([V1_SCOPE §2 "Real-time multi-user sync" — IN]) and the [V1_SCOPE §3.6] phone approve loop. Nothing here reinstates a deferred surface. |

---

## 5. Open sub-decisions (DEFAULTs)

> Per Rule 3a/3b — stated defaults the build proceeds on unless overruled.

- **A. Presence storage = ephemeral Redis set, TTL-refreshed (DEFAULT — endorsed).** Keyed `(userId, socketId)`, ~15s TTL, ~5s heartbeat, broadcast over the existing `workspace-<wsId>` room. **Endorsed by [01 §sync]** ("presence via an app Redis set"). *Flag if wrong:* the only alternative considered (persist viewers as authoritative state) is rejected — it pollutes the seq log and needs compensating writes (§4). **Proceeding on the Redis default.**
- **B. `answeredBy` is set-level, not per-question (DEFAULT).** Matches [09 Resolved #1] (one all-at-once submit per set). Per-question `Question.answeredBy` only lands if incremental multi-human answering is later allowed (out of V1 scope). **Proceeding set-level.**
- **C. Presence heartbeat cadence ~5s / TTL ~15s (DEFAULT).** 3× TTL:heartbeat ratio tolerates one missed beat before a viewer disappears. Tunable constant (`PRESENCE_HEARTBEAT_MS` / `PRESENCE_TTL_MS`); cheap to change. **Proceeding ~5s/~15s.**
- **D. Self-excluded, per-user de-dupe for display (DEFAULT).** Avatars are per-`userId` (multi-tab collapses to one); `currentUser` is excluded from "others viewing." **Proceeding.**
- **E. Claim is advisory only — no soft-lock countdown / no "take over" (DEFAULT).** The hint never disables the other person's Submit; the idempotency guard is the sole arbiter. No "Sanne has 30s then you can answer" timer (adds state + complexity for no correctness gain). **Proceeding advisory-only.**
- **F. The `answer-questionset` `[control-API]` catalogue row is a delta to [CONTROL_API §8] (FLAGGED).** [CONTROL_API §8] enumerates ops but does not list the answer op by name (it's implicit in [09]'s "existing answer-injection"). **Proposed delta:** add the `answer-questionset` row (§3.2) so the idempotency key has a defined home. *Flag for the [CONTROL_API] owner to confirm the row vs. treating answer as a non-catalogued `reply` socket path — but either way it MUST carry `clientRequestId` bound to `questionSetId`.* **Proceeding with the catalogue row.**
- **G. `00_DECISIONS_LEDGER.md` does not yet exist (FLAGGED).** The template cites it as the decision source #6. **Proposed:** create `additions/00_DECISIONS_LEDGER.md` and seed row #6 ("Live presence + answer-claim — soft claim + server idempotency guard, ephemeral Redis presence") from §2. **Proceeding to create it as part of this addition's landing.**

---

## 6. Build checklist (per-lane + verification)

**Lane C — Frontend & realtime-client (primary owner):**
- [ ] `PresenceAvatars` (wraps `AvatarStack`, live `viewers` projection, per-`userId` de-dupe, green active-dot). **Verify:** open DEV-1240 in two browsers → each shows the other's avatar within one heartbeat; close one tab → it disappears within one TTL window.
- [ ] `AnsweringHint` strip on the [09] `QuestionCard` (banner + mobile stepper + [11] chat bubble). **Verify:** user A focuses an open `QuestionSet` → user B sees "● A is answering…" before B taps anything.
- [ ] Typing facet wired into the [11] Assistant composer + [09] `free` answer textarea. **Verify:** typing in the composer shows "A is typing…" to B; stops within TTL after blur.
- [ ] Client presence heartbeat (`ws-ai:presence` emit on route-enter / focus / typing; clear on leave). **Verify:** network panel shows a heartbeat ~every 5s while viewing, none after navigating away.
- [ ] Bind `clientRequestId` to `questionSetId` on the [09] answer submit. **Verify:** double-tap Approve from one client sends one logical answer (dedup); the second is a no-op ack.
- [ ] Losing-submit reconciliation UI: optimistic "submitting…" → "answered by Sanne" read-only (no second resume). **Verify (the headline test):** two clients submit different answers to the same set near-simultaneously → exactly one `--resume`; the loser sees "already answered by Sanne" and the set lands in history once.

**Lane B — Data/tenancy (small delta):**
- [ ] Add `QuestionSet.answeredBy String? @db.ObjectId` ([04b §2] / §13 field sweep) + `types.ts` backfill ([04b §15]). **Verify:** migration applies; `answeredBy` is null until answered, set to the first-writer's `userId` after.
- [ ] Register the presence Redis key formatters (`ws:{wsId}:presence:*`) tenant-scoped ([04b §11c]). **Verify:** a `runInTenant` presence read in workspace A returns nothing for workspace B's keys.
- [ ] Confirm `Ticket.viewers` stays **ui-only** (no Prisma column) — it's the live Redis projection. **Verify:** no `viewers` column in the schema; the board computes it from the presence set.

**Lane A — Engine/orchestrator + control-API (small delta):**
- [ ] Add `answer-questionset` to the `[control-API]` catalogue ([CONTROL_API §8]); handler = `preApiExecute` (work-on-tickets) → enqueue → ack (§7), **no inline mutation**. **Verify:** RBAC denial enqueues nothing; an authorized submit enqueues exactly one signal.
- [ ] Conductor `answer-questionset` drain: status-check `open`→stamp+`answeredBy`+`--resume`+`busy`; already-`answered`→no-op + `conflict` correction at next `seq`. **Verify (auto-sweep + per-route test, [TESTING_STRATEGY]):** the duplicate-answer case asserts a single resume and a single authoritative state transition.
- [ ] Presence room broadcaster (Redis-set CRUD + TTL prune + `ws-ai:presence` fan-out over `workspace-<wsId>` via the Redis adapter), under `runInTenant`. **Verify:** presence events carry **no `seq`** and never append a `TicketEvent`.

**Cross-cutting verification (the invariant tests):**
- [ ] **No double-resume** under concurrent answers (the race test) — the load-bearing assertion.
- [ ] **Presence never appears in the seq log** — grep the `TicketEvent` stream during a presence storm: zero presence rows.
- [ ] **PTY-billing untouched** — a duplicate answer spawns no PTY and accrues no `SpendRecord` ([04b §9]).
- [ ] **Tenant isolation** — presence in A invisible in B (`runInTenant`, [04b §11c]).
- [ ] Create `additions/00_DECISIONS_LEDGER.md` row #6 (§5.G).

---

## 7. Citations

- **[02_PROTOCOL_AND_FLOW]** §1 (status AI-owned, three levers, `--resume`), §2 (`request_input` blocking verb, `draft_questionset`, frozen 7+6 surface), §5 (`QuestionSet`/`Question`, *"the per-user chat panel is the free-text fallback"* — the two-humans-answer race origin), §6 (signals/notifications, serial Conductor consumption). — `02_PROTOCOL_AND_FLOW.md`
- **[09_QUESTIONS_IN_TICKETS]** — question-card rendering, `ChatMessage.questionSetId`, Resolved #1 (all-at-once submit), #3 (immutable-after-submit / re-ask = new set), #4 (one `ws-ai:needs-input`, no double-render); 09.q4 (the two-humans race this addition closes). — `features/09_QUESTIONS_IN_TICKETS.md`
- **[CONTROL_API]** §3 (the `_api` write transport), §4 (verb-vs-control-API distinction; the proposal bridge), §5 (`preApiExecute` RBAC, D69 work-on-tickets), **§6** (`clientRequestId` idempotency, `ControlAck`, optimistic-vs-merge-on-`seq`, §6.4 dedupe + serial drain), §7 (enqueue-not-write), §8 (op catalogue — `answer-questionset` proposed delta). — `CONTROL_API.md`
- **[04b_DATA_MODEL_ADDENDA]** §2/§14 (`QuestionSet`/`Question`; the **missing `answeredBy` provenance gap** — proposed field), §6 (`TicketEvent` append-only `seq` log — why presence stays off it), §7 (Conductor-only writer of authoritative rows), §11a/§11c (append-only, `runInTenant` tenant isolation), §13 (field sweep — where `answeredBy` lands), §15 (`types.ts` backfill). — `04b_DATA_MODEL_ADDENDA.md`
- **[11_WORKSPACE_AI_PANEL]** — the `ws-ai:*` client/server message list (`chat/attach/detach/reply/control` ↔ `stream/status/event/needs-input/suggestion/notification/exit`) this addition extends with `presence`; the chat composer (typing facet); inline question-card rendering. — `features/11_WORKSPACE_AI_PANEL.md`
- **[12_BOARD_AND_KANBAN]** — `Ticket.viewers` render, subscribe-first→snapshot→merge-on-`seq`, Redis socket-adapter fan-out to `workspace-<wsId>`; `AvatarStack`/`CardQuickview`/`KanbanCard`. — `features/12_BOARD_AND_KANBAN.md`
- **[01_ARCHITECTURE]** §2 (web-app horizontal + Redis adapter; single-instance orchestrator), §3.3 (Conductor only-writer), §sync (*"presence via an app Redis set"* — the explicit endorsement of §3.1). — `01_ARCHITECTURE.md`
- **[V1_SCOPE]** §2 (Real-time multi-user sync — IN; Lane C), §3.5 (per-workspace room + `ws-ai:*`), §3.6 (phone approve loop), §5 (V1_SCOPE wins), §6 (Lane C ownership). — `V1_SCOPE.md`
- **Prototype:** `_components/primitives.tsx` (`AvatarStack`/`AvatarBubble`), `_shell/WorkspacesContext.tsx` (`currentUser: Member`), `_shell/Shell.tsx` (`ChatBubble`, AIPanel composer), `_data/types.ts:60` (`Ticket.viewers: string[]` — ui-only presence projection).
