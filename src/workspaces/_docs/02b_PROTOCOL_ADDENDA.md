# 02b — Protocol & flow addenda (PTY-engine machine contract)

> Build-grade addendum to [`02_PROTOCOL_AND_FLOW.md`](./02_PROTOCOL_AND_FLOW.md). **Does not edit 02.** Where 02 froze the verb surface and described the lifecycle in prose, this doc supplies the *deterministic machine contract* the interactive-Claude-CLI-PTY engine needs: the Stop-hook forced-reconciliation loop that backstops a free-running PTY, the per-session structured-channel token lifecycle, the executable `VERB_REGISTRY` + conformance test + drift script that make 02 §2's "no write verb" guarantee enforceable, the fenced-block summary-parsing contract, the `emit_output → emit_carryover` collapse, and the offline `Question[]` self-structuring rule. Prereq: [02](./02_PROTOCOL_AND_FLOW.md), [06](./06_TOKEN_OPTIMIZATION.md), [03](./03_AUTOMATION_AND_PLUGINS.md). Persisted shapes: [`04b §6–§7`](./04b_DATA_MODEL_ADDENDA.md). Codes: [REFERENCE_CODES](./REFERENCE_CODES.md).
>
> **Authority:** every section traces to a LOCKED `Q-*` answer in [`REVIEW_AND_OPEN_QUESTIONS.md`](./REVIEW_AND_OPEN_QUESTIONS.md) (all 2026-06-04): `Q-ENG-CARRYOVER-ENFORCE`, `Q-ENG-TURNEND`, `Q-ENG-TOKEN-LIFECYCLE`, `Q-ENG-VERB-CONFORMANCE`, `Q-ENG-VERB-EMITOUTPUT`, `Q-ENG-OFFLINE-NORMALIZE`, `Q-ENG-TOKENFEED`, `Q-DATA-CARRYOVER-HANDOFF`. The `→` markers carry the originating `Q-*` id inline.
>
> **Why this exists (the lost machine contract, REVIEW TL;DR hazard (b)):** the PTY pivot ([01 §1], load-bearing — interactive CLI on the Max subscription only, no headless `-p`/Agent SDK) traded headless `--json-schema`'s guaranteed structured-exit + token stream for prompt-discipline. 02 froze the *verbs* but left the *deterministic backstop* unwritten. This doc is that backstop. Everything here is gated behind the **P0.5 CLI behaviour spike** (`Q-ENG-SPIKE`): if `type:http` hook delivery in interactive mode, subscription billing of the PTY, the per-turn usage feed, or `--resume`-after-crash fail the spike → **escalate, do NOT route to headless** ([REFERENCE_CODES → B-38] supersession; metered burst stays P4-only).
>
> **No new verbs.** Nothing here adds, renames, or relaxes a structured-channel verb. The frozen surface (02 §2: 7 worker + 6 assistant verbs, all read|propose, none write) is the spine; this doc makes its invariants *executable* and *deterministically driven*, never wider.

---

## §A. The verb-surface invariant this doc operates under

02 §2 froze the surface; 02 §7 asserted the no-write property as a *structural* guarantee. This doc treats that surface as immutable and adds only **enforcement + lifecycle**, never a verb. For convenience the frozen set (the source of truth `VERB_REGISTRY` in [§D](#d-verb_registry--the-executable-no-write-guarantee-q-eng-verb-conformance) is generated to match it):

| Worker verbs (7) | tag | Assistant verbs (6) | tag |
|---|---|---|---|
| `report_status` | read | `get_ticket` | read |
| `emit_event` | propose | `list_tickets` | read |
| `request_input` | propose | `read_pipeline` | read |
| `emit_carryover` | propose | `propose_suggestion` | propose |
| `emit_signal` | propose | `draft_questionset` | propose |
| `emit_handoff` | propose | `refresh_docs` | propose |
| `query_context` | read | | |

**Every verb is `read` or `propose`. None is `write`.** A `propose`-tagged verb produces a durable artifact (a `TicketEvent`, a `WorkspaceSignal`, a `CarryOver`, a `Handoff`, a `WorkspaceSuggestion`, an open `QuestionSet`) that the **Conductor** — the only writer ([01 §3.3], 02 §7) — later acts on behind `[control-API]`. The `propose` tag does NOT mean "mutates global state"; it means "submits a record the Conductor may execute on." This distinction is the whole of B-23 ([REFERENCE_CODES → B-23]). **No new verbs.**

> The `emit_output` token used in [03 §3.4]/[03 §7] is **NOT in the registry** — it collapses into `emit_carryover` ([§F](#f-emit_output--emit_carryover-collapse-q-eng-verb-emitoutput)).

---

## §B. Stop-hook forced-reconciliation loop — the deterministic carry-over backstop (`Q-ENG-CARRYOVER-ENFORCE`, `Q-ENG-TURNEND`)

A headless `claude -p --json-schema` guarantees a schema-valid structured exit. An **interactive PTY does not** — a free-running Stage-Agent can finish a turn having narrated its work in prose and *never called* `emit_carryover`. 02 §3 lists the `Stop` hook and 02 §1's state diagram shows `emit_carryover + Stop hook → done`, but the *enforcement* when the agent skips the verb was unwritten. This is it.

### B.1 Stop = turn-end = the single reconciliation trigger

The Claude `type:http` **`Stop` hook** ([02 §3], origin-exempt, `X-WS-Hook-Token`-gated via [REFERENCE_CODES → G6/G7]) is the authoritative **turn-end signal** for two coupled purposes:

1. **Concurrency-slot release (`Q-ENG-TURNEND`).** There is no headless stream to read deltas from; the FIFO that caps concurrent active turns ([01 §6], ~4) releases the session's slot **on `Stop`** (the session's `AgentSession.status` goes `busy → ready`/`stopped`, [04b §7]). This is the same signal — one hook, two consumers.
2. **Carry-over reconciliation (`Q-ENG-CARRYOVER-ENFORCE`).** On `Stop` the Conductor checks whether this turn produced a schema-valid `emit_carryover` (the [02 §4] envelope). If yes → mark the stage `done`, offer promote. If **no** → enter the forced-reconciliation loop below.

> Turn-end detection precedence (restating [02 §3] for completeness, unchanged): primary = an explicit `emit_carryover`; secondary = the `Stop` hook; tertiary = PTY `onExit`; backstop = the watchdog idle timer. The reconciliation loop hangs off the **`Stop`** rung — `onExit`/watchdog feed the same loop when `Stop` never fires (a hard crash).

### B.2 The loop (Conductor-owned, deterministic — no LLM judgement)

```
on Stop(sessionKey)  /  or onExit / watchdog-idle when Stop never arrives:
  release the concurrency slot                      // Q-ENG-TURNEND — unconditional
  out = latest emit_carryover for this stage since turn start
  if out is schema-valid (validated vs the stage outputSchema, 02 §4 + 03 §3.2):
      → persist CarryOver; mark stage `done`; offer promote.  DONE.
  else:                                              // free-running agent skipped/mis-shaped the verb
      attempts += 1
      if attempts <= N (default N=2, per-stage configurable):
          --resume <claudeSessionId>  with a HARD TEMPLATED DEMAND:
            "Your turn ended without a valid carry-over. Call `emit_carryover`
             with EXACTLY { summary, changedFiles[], openQuestions[], commitHash }.
             Do nothing else."                       // same session — keeps context, no /clear
          (this re-enters busy; the next Stop re-triggers this loop)
      else:                                          // N failures → stop retrying, escalate
          Conductor authors a SYSTEM Question (kind:'free'), persists a QuestionSet,
          sets the TICKET to `needs-input`, fires a Notification (B-34).
          The session row stays `busy` + open QuestionSet (04b §7 status mapping);
          status note: "stuck — could not self-reconcile carry-over".
```

Two distinct failure shapes both feed this loop:

- **Schema-reject → retry.** The agent *did* call `emit_carryover` but the payload failed validation (missing `commitHash`, wrong types). The verb handler returns a `{ ok:false, reason:'schema', errors:[…] }` synchronously to the agent AND the Conductor counts it as a failed attempt — the `--resume` demand quotes the validation errors so the next attempt is corrective. (Schema-reject is cheaper than a silent skip: the agent is still alive and told exactly what to fix.)
- **Silent skip → retry.** No `emit_carryover` at all by `Stop` — the demand is the generic templated one above.

Both share one counter (`attempts`) and one escalation. After `N` failures of *either* kind the ticket lands in `needs-input` with a **system-authored** question (the Conductor writes it; the agent is no longer trusted to self-phrase — distinct from [§G](#g-offline-question-self-structuring-q-eng-offline-normalize) where the *agent* self-phrases while still healthy). This is the [02 §1] `stuck → needs-input` "update: stopped, reason: …" path made deterministic: the agent never reaching a valid output IS a stuck verdict.

### B.3 Why `--resume` the same session (not a fresh spawn)

`--resume <claudeSessionId>` ([04b §7]) keeps the agent's full working context — it already did the work; it just failed to *report* it. A fresh spawn would re-do the turn (burning a subscription turn + risking a different result). The demand is a *reporting* prompt, not a *re-work* prompt. (`claudeSessionId` is re-captured if `/clear` rotated it mid-turn — `Q-ENG-CLEAR`, [04b §7].) The loop NEVER falls back to headless `-p` to force a structured exit — that meters a separate credit pool the whole architecture exists to avoid (`Q-ENG-CARRYOVER-ENFORCE` opt 3 rejected; escalate instead).

### B.4 Same loop generalizes to `emit_handoff`

The within-session self-handoff ([06 §2]) uses the identical machinery: when the Conductor sends the editable HANDOFF INSTRUCTION as the next prompt and the agent must answer with `emit_handoff`, a `Stop` with no valid `emit_handoff` re-enters the same retry-then-escalate loop (handoff is a [02 §4] superset of the envelope, [04b §14]). One reconciliation engine, two verbs.

**No new verbs.** The loop only ever demands `emit_carryover`/`emit_handoff` (existing worker verbs) and writes `QuestionSet`/`Notification` rows Conductor-side via `[control-API]`.

---

## §C. Per-session structured-channel token lifecycle (`Q-ENG-TOKEN-LIFECYCLE`)

02 §2 scopes a "per-session token (maps token→ticket/stage/ws/user…)"; 02 §3 names an `X-WS-Hook-Token` on the hook endpoint. Their **issue/scope/TTL/refresh/revoke lifecycle across spawn → suspend → `--resume` → crash-resume** was unwritten. This pins it. Two distinct tokens, same lifecycle, never conflated.

### C.1 Two tokens per session

| Token | Carries | Used on | Stored as (04b §7) |
|---|---|---|---|
| **structured-channel token** | the verb calls (the CLI/HTTP helper or MCP transport, 02 §2) | the verb endpoint | `AgentSession.channelTokenId` (the **id**, not the secret) |
| **`WS_HOOK_TOKEN`** | the Claude `type:http` lifecycle hooks (02 §3) | the `registerCustomRoute` hook endpoint | `AgentSession.hookTokenId` |

They are **separate secrets** because they gate different surfaces with different blast radius: the channel token authorizes *the agent's own verb calls* (and binds them to one `SessionKey` so a worker can't spoof another ticket and an Assistant acts only as its user — 02 §2 scoping); the hook token authorizes *Claude's process* to POST lifecycle facts. Compromise of one must not grant the other.

### C.2 Lifecycle

```
spawn (SessionManager.spawnWorker/spawnAssistant/spawnReasoner, 01 §4, behind the
       single-spawn wrapper Q-MP-SEAM):
  mint channelToken  bound to SessionKey { kind, ticketId?, stageId?, ws, userId? }
  mint WS_HOOK_TOKEN bound to the same SessionKey
  store channelTokenId + hookTokenId (NOT the secrets) on the AgentSession row
  inject both secrets into the container at boot via the env-file path (tmpfs,
    denyRead from Bash, Q-SEC-CREDLIFETIME) — never --env, never baked into an image

suspend / pause:                      tokens REMAIN valid (the session is parked, not gone)

--resume (manual, or via the carry-over loop §B):     tokens REMAIN valid; same SessionKey

resumeAll() after orchestrator crash (01 §4, Q-CT-RESUME, 04b §7):
  for each surviving AgentSession row (re-attached by containerId/worktreePath):
    RE-MINT channelToken + WS_HOOK_TOKEN  (a crash may have leaked/aged the old secrets)
    update channelTokenId + hookTokenId on the row
    re-inject the fresh secrets into the live container's env-file
    --resume on claudeSessionId

kill / teardown:                      REVOKE both tokens (delete the server-side binding);
                                      the ids on the row become dangling (audit only)
```

**Re-mint, not reuse, on every spawn AND every `resumeAll`** — a fresh secret per process incarnation bounds the exposure window. Only the **id** lives on the durable row; the secret lives only in the orchestrator's binding table + the container's tmpfs env-file. The binding is `SessionKey`-scoped, so the verb endpoint resolves `token → SessionKey → {ws, ticket, stage, user}` and rejects any verb whose target doesn't match (the 02 §2 anti-spoof guarantee, now with a concrete lifecycle). With MCP transport, `--strict-mcp-config` (02 §2) plus this token together bound a session to *only* its declared servers + its own SessionKey.

**No new verbs.** Token minting/revocation is a Conductor/SessionManager concern; no LLM verb touches it.

---

## §D. `VERB_REGISTRY` — the executable no-write guarantee (`Q-ENG-VERB-CONFORMANCE`)

02 §7's "no Assistant or future reasoner session has any write verb … B-23 is guaranteed by the architecture, not by prompt discipline" was a **prose** assertion. A prose freeze drifts. This makes it executable: one registry the transport helper is generated *from*, plus a conformance test and a drift script. This is a P1 lane-C deliverable.

### D.1 The single source-of-truth registry

```ts
// VERB_REGISTRY — the ONE frozen verb surface (02 §2). The CLI/HTTP helper AND the
// optional MCP server are GENERATED from this; never hand-maintained in parallel.
type VerbTag = 'read' | 'propose';          // NOTE: no 'write' member EXISTS in the union.
interface VerbDef { name: string; surface: 'worker' | 'assistant'; tag: VerbTag; payloadSchema: JsonSchema; }

export const VERB_REGISTRY: readonly VerbDef[] = [
  // worker (7)
  { name:'report_status', surface:'worker', tag:'read',    payloadSchema: … },
  { name:'emit_event',    surface:'worker', tag:'propose', payloadSchema: … },
  { name:'request_input', surface:'worker', tag:'propose', payloadSchema: … },
  { name:'emit_carryover',surface:'worker', tag:'propose', payloadSchema: … },
  { name:'emit_signal',   surface:'worker', tag:'propose', payloadSchema: … },
  { name:'emit_handoff',  surface:'worker', tag:'propose', payloadSchema: … },
  { name:'query_context', surface:'worker', tag:'read',    payloadSchema: … },
  // assistant (6)
  { name:'get_ticket',         surface:'assistant', tag:'read',    payloadSchema: … },
  { name:'list_tickets',       surface:'assistant', tag:'read',    payloadSchema: … },
  { name:'read_pipeline',      surface:'assistant', tag:'read',    payloadSchema: … },
  { name:'propose_suggestion', surface:'assistant', tag:'propose', payloadSchema: … },
  { name:'draft_questionset',  surface:'assistant', tag:'propose', payloadSchema: … },
  { name:'refresh_docs',       surface:'assistant', tag:'propose', payloadSchema: … },
] as const;
```

The `VerbTag` union **has no `write` member** — a write verb is not merely absent, it is *unrepresentable*. Adding one is a type-level change a reviewer cannot miss.

### D.2 The conformance test (CI gate)

```
test "no write verb exists":
  assert every VERB_REGISTRY[i].tag ∈ {'read','propose'}      // trivially true by the union, but pinned
  assert VERB_REGISTRY has EXACTLY 13 entries (7 worker + 6 assistant)  // freezes the count

test "every AgentRole's tool set ⊆ VERB_REGISTRY":
  for each registered AgentRole (03 §3) and its per-stage permissions.allow:
    assert the role's exposed structured-channel tools ⊆ { v.name | v ∈ VERB_REGISTRY }
    assert no role grants a verb tagged outside {'read','propose'}   // (vacuous, by construction — the point is it CANNOT regress)

test "the generated helper matches the registry":
  regenerate the CLI/HTTP helper (+ MCP server, if built) FROM VERB_REGISTRY;
  assert the committed artifact is byte-identical (drift = fail)
```

This makes B-23 a CI invariant: a future feature lane cannot quietly add a write verb (the union forbids it) nor expose an out-of-registry tool to a role (the subset test fails). It also pins the **adapter-conformance** constraint (`Q-MP-SEAM`): any future engine adapter exposes ONLY this set as model tools — the same test guards the seam.

### D.3 The `types.ts ↔ DATAMODEL` drift script

A separate script (P1 lane-C) asserts the prototype `types.ts` stays in sync with the persisted model bodies ([04b]) for the surfaces this protocol touches:

```
script "types↔datamodel drift":
  parse types.ts model-mirroring types (AgentSession, AiSuggestion/WorkspaceSuggestion,
    WorkspaceBudget, ActivityEvent/TicketEvent, NotificationItem/Notification, …)
  compare field-by-field against the 04b §6–§15 backfill checklist
  FAIL if a 04b field is missing from types.ts (the "claims 1:1 parity it no longer has"
    hazard, REVIEW TL;DR (c)) — e.g. AgentSession.status not in {ready,busy,paused,stopped},
    WorkspaceSuggestion.type missing 'automation', WorkspaceBudget still single-row.
```

The script is advisory-then-blocking: it runs in CI and its checklist IS the [04b §15] backfill list, so "did the backfill land?" is a test, not a memory.

**No new verbs.** The registry *is* the frozen surface; the tests only prevent it from widening.

---

## §E. Fenced-block summary-parsing contract (`Q-DATA-CARRYOVER-HANDOFF`)

The estimate (D27) and the carry-over envelope ride **named fenced blocks inside the agent's `emit_carryover` summary** — a Conductor-side parsing convention, **NOT** an envelope schema change ([04b §14] pins the persisted relationship; this restates the *protocol* surface 02 §4 owns). Two block kinds:

| Fence | Parsed into | Decision |
|---|---|---|
| ` ```ws-estimate ` | `{ tokenEstimate?, durationEstimate?, confidence? }` → `AgentSession.tokenEstimate`/`durationEstimate` ([04b §7]) | D4 / D27 |
| ` ```ws-carryover ` | `{ summary, changedFiles[], openQuestions[], commitHash }` — the [02 §4] envelope | B-O2 |

Rules (Conductor-side, deterministic):
- **Max one block of each kind** per `emit_carryover` emission. A second block of the same kind = take the first, log the rest (no crash).
- **Parse-failure falls back** to treating the whole `summary` as the human one-liner (`Ticket.carryOver`, [04b §14]) — advisory only, never a crash. A missing `ws-carryover` block does NOT itself trigger §B reconciliation; only an `emit_carryover` whose *envelope* (block or top-level payload) fails schema validation does. (The fence is a convenience for the agent to co-emit the estimate; the envelope is still the validated contract.)
- The `ws-estimate` feed is **advisory** (`Q-ENG-TOKENFEED`): in PTY mode there is no exact live token count, so `tokenEstimate` is either a hook-payload usage figure (if the spike confirms one is present) or a labelled char-count heuristic — good enough to fire the [06] budget at ~70–80%, never treated as precise ([04b §7] `tokenEstimate` ADVISORY).
- This is the **single documented place** these blocks are parsed; feature docs cite `02 §4` (the home of the contract) — not a re-spec.

Relationship, disambiguated (full table in [04b §14]): `Ticket.carryOver` = human one-liner (derived from the latest envelope `summary`); `CarryOver` envelope = machine, stage→stage; `Handoff` = machine, within-session, a superset that may carry the envelope in `carried?`.

**No new verbs.** The blocks ride the existing `emit_carryover`/`emit_handoff` payloads; parsing is Conductor-side.

---

## §F. `emit_output → emit_carryover` collapse (`Q-ENG-VERB-EMITOUTPUT`)

[03 §3.4] ("a design agent still calls `emit_carryover`/`emit_output`") and [03 §7 step 1/6] reference an `emit_output` verb. **`emit_output` is NOT a verb** — it appears in neither the 02 §2 table nor the [§D](#d-verb_registry--the-executable-no-write-guarantee-q-eng-verb-conformance) `VERB_REGISTRY`. It collapses into **`emit_carryover`**, the single canonical final-output verb:

- A role's richer output (a design's `artifacts:[{kind,uri,title}]`, a report) does NOT need a new verb — it rides `emit_carryover` whose payload matches the **role's `outputSchema`** ([03 §3.2], which MAY add fields atop the base `{summary, changedFiles[], openQuestions[], commitHash}`). The verb is fixed; the schema is the variable part — exactly 03 §3.4's own "the verb surface is the stable waist; roles + schemas are the variable parts."
- Wherever a build doc or example says `emit_output`, read `emit_carryover` (the §D conformance test would *fail* on an `emit_output` tool, so the collapse is enforced, not just documentary).
- If a genuinely distinct artifact-output verb were ever needed it would have to be added to the 02 §2 table explicitly (and the registry + count test updated) — it is **not** being added (`Q-ENG-VERB-EMITOUTPUT` opt 2 not taken). **No new verbs.**

---

## §G. Offline `Question[]` self-structuring (`Q-ENG-OFFLINE-NORMALIZE`)

02 §5 says the Conductor "may have the user's **Assistant** normalize raw questions into tappable choices via `draft_questionset` (if nobody's online, a deterministic banner suffices)." That left a UX gap: `request_input` can fire **with no user connected**, and `draft_questionset` needs a *connected* Assistant — so who shapes raw questions into mobile cards?

**Resolution:** the **Stage-Agent self-phrases a fully-structured `Question[]` directly in `request_input`** — it is an LLM, alive at ask-time, fully capable of emitting `{ id, text, kind:'free'|'choice'|'approve', choices? }` itself. `draft_questionset` is demoted to **optional polish** (a connected Assistant prettifying an already-usable set), never a prerequisite for a usable card.

```
Stage-Agent calls request_input({ questions: Question[] })   // already self-structured, 02 §5 shape
  → Conductor validates the Question[] shape (kind ∈ {free,choice,approve}; choices present iff kind==='choice')
  → persists the QuestionSet, sets needs-input, fires Notification (B-34) — WORKS with zero users online
  → IF a user later connects AND the set looks raw, the Assistant MAY draft_questionset to refine
    (a superseding QuestionSet, append-only correction D49) — pure polish, never gating
```

This is distinct from the §B escalation (where the *Conductor* authors a system question because the agent failed): here the agent is **healthy** and asking on purpose, so *it* owns the phrasing. The deterministic banner ([02 §5]) remains the floor only when even the raw `Question[]` is absent (a hard-crash `stopped` signal synthesizing a generic "agent stopped — open to view").

**No new verbs.** `request_input` (existing worker verb) carries the structured `Question[]`; `draft_questionset` (existing assistant verb) stays optional.

---

## §H. Cross-reference index

| This doc | Reconciles / pins | Source `Q-*` | Cited by |
|---|---|---|---|
| §B Stop-hook reconciliation loop | [02 §1] stuck→needs-input, [02 §3] Stop, [06 §2] self-handoff | `Q-ENG-CARRYOVER-ENFORCE`, `Q-ENG-TURNEND` | 05, 07, 09, 19, 24 |
| §C token lifecycle | [02 §2] scoping, [02 §3] `X-WS-Hook-Token`, [04b §7] | `Q-ENG-TOKEN-LIFECYCLE`, `Q-SEC-CREDLIFETIME` | 07, 14, 16, 17 |
| §D VERB_REGISTRY + tests | [02 §2] frozen surface, [02 §7] B-23, [04b §15] | `Q-ENG-VERB-CONFORMANCE`, `Q-MP-SEAM` | 03, 05, 11, all `[control-API]` |
| §E fenced-block parsing | [02 §4] envelope, [04b §7]/§14 | `Q-DATA-CARRYOVER-HANDOFF`, `Q-ENG-TOKENFEED` | 05, 07, 19, 20 |
| §F emit_output collapse | [03 §3.4]/§7 | `Q-ENG-VERB-EMITOUTPUT` | 03, 07 |
| §G offline Question[] | [02 §5] | `Q-ENG-OFFLINE-NORMALIZE` | 09, 11, 18 |

**Self-check:** No new verbs introduced. No write verb granted to any LLM session — the `VerbTag` union has no `write` member and the §D conformance test pins it. The Stop hook is the single turn-end + reconciliation trigger (slot release + carry-over enforcement, one signal two consumers). `emit_output` collapsed into `emit_carryover`. Every "write" is a `[control-API]` Conductor action (B-23). Engine path stays interactive-PTY-only; no §B/§C/§D path routes to headless `-p` on failure (escalate instead). This doc edits neither `02_PROTOCOL_AND_FLOW.md` nor any existing file.
