# CONTROL_API — the formal definition of `[control-API]`

> The single, authoritative spec for the write mechanism cited as `[control-API]` across all 24 feature docs (13–24 plus 12). Owns `Q-ENG-CONTROL-API` (LOCKED 2026-06-04). Resolves hazard **(e)** from the 26-agent review ([REVIEW_AND_OPEN_QUESTIONS.md §TL;DR]): *"the most-reused WRITE mechanism across all 24 feature docs has no transport/auth/shape."*
>
> Companion to [01 §3.3] (the Conductor is the only writer of board/git/status) and [02 §1] (status is AI-owned; the user has exactly three levers). Cites codes via [REFERENCE_CODES.md]. Self-contained for an independent build lane.
>
> **No new verbs.** `[control-API]` is NOT a structured-channel verb and adds none. The frozen surface ([02 §2]: 7 worker + 6 assistant verbs, all `read|propose`, none write) is untouched. `[control-API]` is the *human/web-app* write path; the verbs are the *AI* read/propose path. They never overlap (§4).

---

## 1. One sentence

> **`[control-API]` is one authenticated LuckyStack `_api` route family the web-app calls; each route runs `preApiExecute` RBAC, then ENQUEUES a Conductor action onto the same serial signal-log the Conductor already drains — and returns. The handler NEVER mutates `Ticket.status`, git, the board, a container, or a route directly.**

Everything else in this doc elaborates that sentence: the transport, the auth/RBAC gate, the enqueue-not-write contract, how it differs from the AI-only Claude-hook verbs, the request/response + merge-on-`seq` semantics, and the catalogue of operations the feature docs need.

This realizes the [01 §3.3] invariant at the user boundary: the Conductor "is the only actor that writes `Ticket.status`, `TicketEvent`, `CarryOver`, promotions, notifications, config patches." A user lever cannot bypass that — it can only *request* a Conductor action. `[control-API]` is the request transport; the Conductor is still the writer.

---

## 2. Why it must exist (the gap it closes)

The feature docs use `[control-API]` ~60 times for every user-initiated write: pause/resume/kill, pause-all, bulk move/status/assign/sprint/archive, GitLab settings + force-resync, preview up/down, mark-read, raise-cap, role/member edits, sprint create/edit, skill toggles, quick-add. Before this doc each of those was an unbound token — parallel build lanes would each invent a different transport (some optimistic client writes, some socket events, some direct Prisma calls), violating [01 §3.3] in 24 different ways.

The fix (LOCKED, `Q-ENG-CONTROL-API` opt 1) is to define it **once** as a single mechanism every lane reuses. No per-feature transport decisions remain.

---

## 3. Transport — an authenticated LuckyStack `_api` route family

`[control-API]` is **plain LuckyStack file-based API** ([docs/ARCHITECTURE_API.md], [docs/ARCHITECTURE_ROUTING.md]) — nothing bespoke. The web-app calls it with the generated, typed `apiRequest({ name, version, data })` ([Type Generation contract]); there are no `as any` wrappers and no socket-event family (`Q-ENG-CONTROL-API` opt 2 rejected — socket events lack the `preApiExecute` RBAC seam and the request/response shape the optimistic-UI needs).

- **Location.** Routes live under one page namespace, e.g. `src/workspaces/_api/<name>_v1.ts`, producing endpoints `api/workspaces/<name>/v1`. The family is the set of these routes (catalogue §8).
- **Method / auth const.** Every route is `method:"POST"` with `auth:{ login:true }` ([API Pattern]). Anonymous control writes do not exist.
- **`rateLimit`.** Set per route (the auto-sweep contract-tests it, [ARCHITECTURE_TESTING.md]); bulk routes get a tighter limit than single-item ones.
- **Shape.** `ApiParams.data` is the typed request (§6); `main` returns the typed `ControlAck` (§6). The handler body is deterministic plumbing — RBAC check → enqueue → ack. **It contains no business mutation.** (Rule 7b: minimum code; the writing logic already lives in the Conductor, not here.)
- **The orchestrator boundary.** The web-app is horizontally scaled; the Conductor is single-instance ([01 §2]). The `_api` handler runs on a web-app instance, so "enqueue a Conductor action" = append a `WorkspaceSignal` to the Redis-backed serial signal-log the single-instance Conductor drains under its lease ([01 §3.3] serial signal-log consumption; [07 §A] lease). The handler does NOT call into orchestrator memory directly — it writes a durable signal and returns. This is what makes the control-API safe across the web-app ↔ orchestrator process split.

**No new verbs.** This is a web-app→orchestrator request transport, entirely disjoint from the agent→orchestrator verb surface ([02 §2]).

---

## 4. How it differs from the AI-only Claude-hook verbs

This is the distinction the review demanded be made explicit. Two transports, never confused:

| Axis | `[control-API]` (this doc) | Structured-channel verbs ([02 §2]) |
|---|---|---|
| **Initiator** | a **human** via the web-app (or the Assistant *proposing* one for a human to accept) | a **running LLM session** (Stage-Agent / Assistant) |
| **Transport** | LuckyStack `_api` route → `apiRequest` | whitelisted CLI/HTTP helper or MCP tool the agent runs via Bash ([02 §2]) |
| **Auth** | `preApiExecute` + `login:true` + WorkspaceRole RBAC (§5) | the per-session structured-channel token bound to `SessionKey`, re-minted per spawn/resume (`Q-ENG-TOKEN-LIFECYCLE`); + `WS_HOOK_TOKEN` for hooks |
| **Grade** | a **write** request (the Conductor then writes) | strictly `read` or `propose` — **never write** (B-23; conformance-tested by `VERB_REGISTRY`, `Q-ENG-VERB-CONFORMANCE`) |
| **What actually writes** | the **Conductor** (after draining the enqueued signal) | the **Conductor** (after the user *accepts* a proposal) |
| **Examples** | pause, kill, bulk-archive, raise-cap, change-role, preview-up, mark-read, quick-add | `report_status`, `request_input`, `emit_carryover`, `propose_suggestion`, `get_ticket` |

The common floor: **only the Conductor writes** ([01 §3.3]). `[control-API]` and the verbs are the two read/request edges that feed the Conductor; neither is a writer. A control-API route that mutated state inline would break the invariant exactly as badly as a write verb would — both are forbidden.

**Where they meet (the proposal bridge, B-23).** When the Assistant `propose_suggestion`s a change (e.g. "remove Tom", "raise the cap to €300"), the suggestion surfaces as a `WorkspaceSuggestion`. The user's **Accept** is itself a `[control-API]` request — accepting routes through the *same* control-API path the Conductor executes ([16 §control-API], [19 §Assistant]). So the verb proposes; the control-API (on human accept) requests; the Conductor writes. No verb ever short-circuits to a write.

---

## 5. Auth & RBAC — `preApiExecute` + WorkspaceRole

Every control-API route enforces authorization in `preApiExecute` **before** the handler body runs (so an unauthorized request never enqueues anything). The check has three layers:

1. **Session.** `auth:{ login:true }` — a valid LuckyStack session ([ARCHITECTURE_AUTH], B-08). No session → 401, nothing enqueued.
2. **WorkspaceRole capability check.** The caller's `WorkspaceMember.role` (the `WorkspaceRole` tenant model — single-Owner, [04b §RBAC], B-28/D69) is checked against the route's required capability from the `RBAC_CAPABILITIES` matrix ([16 §RBAC]). Examples (LOCKED, D69):
   - ticket-scoped **pause/resume** → `"work on tickets"` (Owner/Admin/Member).
   - **kill** + workspace **pause-all** → **Admin+**.
   - **raise budget cap**, **GitLab settings**, **skill toggle**, **edit pipeline/stages** → the pipeline/config capability (D30).
   - **change-role / remove-member / transfer-ownership / delete-workspace** → Admin+ (transfer/delete = Owner).
   This reuses the existing B-28 tiers — **no matrix change** (D69).
3. **Single-Owner guard.** Owner-affecting routes (transfer-ownership, role-demotion of the last Owner, delete-workspace) enforce the **single-Owner invariant in `preApiExecute`**, not via DB row-locks ([04b §RBAC], Security LOCKED-decision: "single-Owner enforced in preApiExecute, not row-locks"). A request that would orphan a workspace of its Owner is rejected at the gate.

RBAC failure → the route returns `status:"error"` (a denied `ControlAck`, §6) and enqueues **nothing**. The boundary is `preApiExecute` — the same place the B-28 matrix is enforced for everything else ([24 §RBAC], [16 §enforcement]). The Conductor trusts that any signal it drains was already authorized; it does not re-check RBAC.

**No new verbs.** RBAC is an `_api`/`preApiExecute` concern, never a structured-channel verb ([04b §RBAC]).

---

## 6. Request / response contract + optimistic-vs-merge-on-`seq`

### 6.1 Request

```ts
// Conceptual shape (the real types are generated; no `as any`).
interface ControlRequest<P> {
  workspaceId: string;        // tenant scope; runInTenant on the orchestrator side
  op: ControlOp;              // the operation id (§8 catalogue), e.g. 'pause' | 'bulk-archive'
  target: ControlTarget;      // { ticketId } | { ticketIds: string[] } | { memberId } | { sprintId } | …
  payload: P;                 // op-specific (newCap, role, status, sprintDates, …)
  clientRequestId: string;    // idempotency key (dedup re-sends; §6.4)
}
```

### 6.2 Response — `ControlAck` (acknowledgement, NOT the result)

A control-API call returns an **acknowledgement that the action was enqueued**, never the mutated entity. The actual state change arrives later over the realtime channel (`ws-ai:*`) once the Conductor has drained the signal and written.

```ts
type ControlAck =
  | { status: 'success'; result: { accepted: true; signalSeq: number } }   // enqueued at this seq
  | { status: 'error';   result: { accepted: false; reason: 'rbac' | 'rate-limit' | 'invalid' | 'conflict' } };
```

`signalSeq` is the position the action took in the serial signal-log — the client uses it to reconcile the optimistic UI against the eventual realtime confirmation (§6.3). This split (ack now, result-over-`ws-ai` later) is what keeps the [01 §3.3] "only the Conductor writes" invariant honest even though the call appears synchronous to the browser.

### 6.3 Optimistic-vs-merge-on-`seq`

Because status is AI-owned ([02 §1]) and writes are asynchronous, the client does **not** locally mutate authoritative state. The contract per [12 §Bulk]/[13 §B-30]/INDEX D-bulk:

- **Optimistic affordance only.** On send, the UI may show a transient "requested…" affordance (e.g. the bulk bar shows "requested…", a card shows a pause spinner) — a *pending* visual, not an authoritative state edit.
- **Merge on `seq`.** Each `TicketEvent`/state row carries a monotonic **`seq`** ([04b §TicketEvent], `Q-DATA-DATAMODEL-SECTIONS`). The realtime `ws-ai:*` update the Conductor emits after writing carries the authoritative new state at a `seq`. The client **merges by `seq`** — applying the realtime state and discarding the optimistic pending once the confirming event arrives (or on a higher `seq`). A stale optimistic edit can never win over a Conductor write.
- **Clear-on-confirm.** The bulk bar clears on the Conductor's confirmation, not on local send ([13 §control-API]: "the bar dispatches the batched control-API request and clears on the Conductor's confirmation").
- **Conflict.** If the enqueued action is no longer valid when the Conductor drains it (e.g. the ticket was already killed), the Conductor emits a `ws-ai:*` correction at the next `seq`; the optimistic affordance is reconciled away by the same merge rule. The `ControlAck.error.reason:'conflict'` path covers conflicts detectable at enqueue time.

**Net:** the user *requests*; the optimistic UI is a hint; the `seq`-ordered realtime stream is the single source of truth. No optimistic client mutation is ever authoritative (B-30, [02 §1]).

### 6.4 Idempotency & ordering

- `clientRequestId` dedups re-sends (network retry, double-tap) — the orchestrator drops a duplicate signal.
- Ordering is the serial signal-log's: the Conductor drains **serially** ([01 §3.3]). Bulk operations are a **single batched signal the Conductor runs serially over its members** (B-30) — not N concurrent signals — so a "Move 8 tickets" request is one enqueue, processed in order, emitting one confirming stream.

---

## 7. The enqueue-not-write contract (the load-bearing rule)

The handler body is, in full:

1. `preApiExecute` already passed (§5) → the caller is authorized.
2. Validate `payload` against the op's schema (reject `invalid` early).
3. **Append one `WorkspaceSignal`** describing the action to the serial signal-log (Redis-backed, drained by the single-instance Conductor under its lease).
4. Return `ControlAck{ accepted:true, signalSeq }`.

It does **not**, under any circumstance: write `Ticket.status`, append a `TicketEvent`/`CarryOver`/`Handoff`, call git/GitLab, `docker run`/teardown, mutate a Caddy route, flip a `PreviewDeployment.status`, or change a `WorkspaceMember` row. Those are **all** Conductor actions ([01 §3.3]). The control-API's only write is the signal append itself.

This is the same proposes/executes boundary as every other lever ([14 §control-API]: "the browser *requests*; it never chooses the binary/args/cwd"). For container/preview ops specifically: the browser requests `preview-up`/`kill`; it never chooses the container or binary ([01 §8], [23 §control-API], [24 §kill]).

**A background worker is still a control-API caller, not a bypass.** Automations ([03] `WorkspaceTrigger`, e.g. "on budget cap → pause all", B-35) consume an event and request the **same** `pause`/`notify` control-API action ([24 §triggers]) — they do not write directly either. And every such orchestrator-side path runs under `runInTenant` (mandatory for sync-handlers AND every background worker — Security LOCKED-decision).

---

## 8. Catalogue — the control-API operations the 24 feature docs need

> Every `op` below is one route in the family. Each is `login:true` + `preApiExecute` RBAC (§5) → enqueue a Conductor action (§7) → `ControlAck` (§6). **None is a verb.** Grouped by owning feature doc; the cited Q-* / D / B codes are the locked decisions behind them.

| `op` | Target | RBAC (§5) | Conductor action | Owning doc |
|---|---|---|---|---|
| `pause` | `{ ticketId }` | work-on-tickets (D69) | park session, keep container for `--resume` | [24], [12] |
| `resume` | `{ ticketId }` | work-on-tickets (D69) | re-attach parked session (`--resume`), → `busy` | [24] |
| `kill` | `{ ticketId }` | **Admin+** (D69) | teardown container ([07 §A]); branch + `TicketEvent` retained | [24] |
| `pause-all` | `{ workspaceId }` | **Admin+** (D69) | **serially** pause every running session (batched, B-30) | [24], [19] |
| `resume-all` | `{ workspaceId }` | **Admin+** (D69) | serially resume paused sessions | [19] |
| `bulk-move` / `bulk-status` / `bulk-assign` / `bulk-sprint` / `bulk-archive` | `{ ticketIds[] }` | work-on-tickets / config per-field | **one batched signal**, run serially (B-30); merge-on-`seq` | [13], [12] |
| `archive` | `{ ticketId }` | work-on-tickets | archive (`Ticket.archived`, [04b]) | [12] |
| `quick-add` (user) | `{ title, … }` | work-on-tickets | **direct creation** — Conductor materializes the `Ticket` (§9) | [12], [21] |
| `sprint-create` / `sprint-edit` | `{ sprintId?, name, startAt, endAt, active }` | config (D30) | persist `Sprint` rows (dates in `Workspace.timezone`, D55) | [13] |
| `change-role` / `remove-member` / `invite` / `revoke-invite` / `transfer-ownership` / `delete-workspace` | `{ memberId } / { inviteId } / { workspaceId }` | Admin+ (+ single-Owner guard, §5) | membership/RBAC writes | [16], [17] |
| `accept-invite` | `{ inviteToken }` | login (token-scoped) | consume `Invite` → `WorkspaceMember` | [17] |
| `mark-read` | `{ notificationId } / { all:true }` | login (own notifications) | set read state (status is AI-owned, [01 §3.3]) | [18] |
| `raise-cap` / `edit-budget` | `{ newCap, periodWindow? }` | config (D30) | update `WorkspaceBudget` (multi-cap v1, D81/D82, [04b]) | [19] |
| `resume-spend` (this period) | `{ workspaceId }` | config (D30) | clear the period auto-pause | [19] |
| `skill-toggle` | `{ stageCfgId, skill, on }` | edit-pipeline (D30) | flip skill on `PipelineStageCfg`/workspace | [15] |
| `gitlab-settings` / `gitlab-verify` / `gitlab-resync` | `{ token?, baseUrl? }` | **Admin+** | persist GitLab config; Verify = read; resync = kick a sync | [22] |
| `preview-up` / `preview-down` | `{ ticketId }` | work-on-tickets | build+run / teardown preview container + Caddy route ([07 §B], [23 §status]) | [23] |
| `accept-suggestion` | `{ suggestionId }` | per the suggestion's required cap | the B-23 bridge (§4): execute the proposed change | [16], [19], [04b §Suggestion] |

This catalogue is the union of every `[control-API]` citation found across docs 12–24 + INDEX (the review's enumeration: "bulk ops, pause/kill, GitLab writes, preview up/down, mark-read, budget/role edits, archive, quick-add"). New feature docs add rows here, never new verbs.

---

## 9. User-initiated ticket creation is a direct control-API write (NOT a proposal)

`Q-PROD-TICKET-CREATE` (LOCKED) resolves the docs-06-vs-12 disagreement:

- **User-initiated creation = a direct, RBAC-gated `[control-API]` write.** When a human uses quick-add / the create sheet ([12 §Quick-add], [21 §Quick-create]), the `quick-add` op enqueues a Conductor action that **materializes the `Ticket` directly** — it is NOT routed through the propose→accept loop. It is still the Conductor that writes (the control-API enqueues; §7), but there is no `WorkspaceSuggestion` and no second human accept step. The RBAC gate (work-on-tickets) at `preApiExecute` is the only authorization needed.
- **AI-drafted creation = a proposal.** Only when the **Assistant drafts** a ticket (e.g. from a Cmd-K/voice prompt, or "create an epic for…") does it go through `propose_suggestion` → `WorkspaceSuggestion` → human **Accept** (itself an `accept-suggestion` control-API call, §4 bridge) → Conductor materializes. The write is still the Conductor's; the difference is the *proposal* gate the AI path adds (B-23).

So: a human creating a ticket does NOT wait on a proposal; an AI creating one does. Both writes are the Conductor's; both transports are `[control-API]`. Docs 06 and 12 are reconciled to this.

**No new verbs.** Direct creation is a `[control-API]` write; AI-drafted creation reuses the existing `propose_suggestion` verb ([02 §2]) + the accept-suggestion control-API bridge.

---

## 10. Self-check (review invariants)

- **No new verbs** introduced anywhere in this doc. The frozen `[02 §2]` surface (7+6, all `read|propose`) is untouched; `VERB_REGISTRY` conformance (`Q-ENG-VERB-CONFORMANCE`) is unaffected.
- **No write verb granted to any LLM session.** Every write is a Conductor action behind `[control-API]` (B-23, [01 §3.3]).
- **The control-API handler never mutates directly** — it enqueues a serial-log signal and acks (§7). The Conductor remains the only writer.
- **RBAC + single-Owner guard live in `preApiExecute`** (§5), not in row-locks, matching the locked Security decision.
- **Optimistic UI is a hint; merge-on-`seq` is authoritative** (§6.3, B-30) — no optimistic client mutation wins over a Conductor write.
- **User-direct creation vs AI-drafted-proposal** is the locked `Q-PROD-TICKET-CREATE` split (§9).
- This doc **edits no existing file** — it formalizes a token the other docs already cite; docs 12–24 + INDEX continue to cite `[control-API]` and now resolve to this definition.
