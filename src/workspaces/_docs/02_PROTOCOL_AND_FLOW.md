# 02 — Protocol & flow

> How sessions, the orchestrator, and the UI talk; how a ticket moves; the question/approval loop. Prereq: [01](./01_ARCHITECTURE.md). Entities → [04](./04_DATA_MODEL.md). Roles: Assistant (per-user chat) · Stage-Agent (worker) · Conductor (deterministic — coordination + the only writer). No standing Coordinator; an optional one-shot background reasoner is future (01 §3.x).

---

## 1. Ticket lifecycle state machine

State = `{ stageId, statusKey }` — two strict levels (spec DH5): **stage** = pipeline column; **status** = state within it. Status enum (matches `_data/types.ts` `TicketStatus`): `idle | needs-input | busy | done | paused | stuck`.

**Invariant — status is AI-owned / read-only to the user.** Only the **Conductor** writes `Ticket.status`. The user has exactly **three levers**, each translated by the Conductor:
1. **answer a QuestionSet** (§5),
2. **approve / promote** (advance a `done` stage),
3. **pause / resume**.

```
 user creates ticket → (firstStage, idle)        [aiEnabled=false stages park at idle]
        │ user "Start" / promote into an aiEnabled stage
        ▼
   (stage, busy) ──emit_question / Notification(permission_prompt)──▶ (stage, needs-input)
        │                                                                  │ user answers QuestionSet
        │ emit_carryover + Stop hook                                       │ Conductor injects answers, --resume
        ▼                                                                  ▼
   (stage, done) ──user taps "Promote to <next>"──▶ carry A→B, spawn next ──▶ (nextStage, busy)
        ▲
        │ heartbeat stale / max-turns / idle_prompt  (spec B-35)
   (stage, busy) ──────────────────────────────────▶ (stage, stuck) ──agent self-phrases (or det. notif)──▶ (stage, needs-input)
   (stage, *) ──user Pause──▶ (stage, paused) ──user Resume──▶ (stage, busy)
 final stage done → ticket terminal; container torn down; branch + TicketEvents retained (audit)
```

- `busy→done` does **NOT** auto-advance — promote is a user action (unless a `stage.on_complete → start-stage` trigger is configured; see 03).
- `needs-input→busy` resumes the **same** agent session via `--resume <claudeSessionId>` (the agent keeps its context).
- `stuck` is transient: the stuck agent self-phrases a user question (it's an LLM, alive at decision-time) — or, on a hard crash, a deterministic notification fires; either way the Conductor lands it in `needs-input`. This is the "update: stopped, reason: …" path.

---

## 2. Structured channel — the agent→orchestrator verbs

The stable, tiny **verb surface**. Transport is **mechanism-flexible** (01 §1): v1 = a whitelisted CLI/HTTP helper the agent runs via Bash (e.g. `ws emit-carryover --file out.json` → POST to the orchestrator); optional = an MCP server exposing the same verbs as tools. **Define the JSON payloads as the contract; swap transport freely.** All verbs are read/propose — the **Conductor** performs every state write.

### Stage-Agent verbs (workers — report up; never mutate global state directly)
| Verb | Payload | Effect |
|---|---|---|
| `report_status` | `{ statusKey, note?, complexityScore?:1–10 }` | bump heartbeat; emit `ws-ai:status`; feed model auto-escalation |
| `emit_event` | `{ type:'command'\|'file-change'\|'comment', text }` | append `TicketEvent`; emit `ws-ai:event` (most events come from hooks; this is for narrated milestones) |
| `request_input` | `{ questions:Question[] }` | **blocking** — Conductor sets `needs-input`, fires `ws-ai:needs-input` + `Notification`, holds the call open until the user answers; returns `{ answers }`. The man-in-the-middle pivot. |
| `emit_carryover` | the envelope (§4) | validate vs schema; persist `CarryOver`; mark stage `done` |
| `emit_signal` | `{ type, payload }` | append `WorkspaceSignal` for serial consumption by the Conductor (§6) |
| `emit_handoff` | `{ summary, decisions, state, next, gotchas, carried? }` | store a `Handoff` for the token-optimization self-handoff (06) |
| `query_context` | `{ question }` | **synchronous** — pull full prior-stage output / event-log on demand, or an immediate cross-ticket answer; orchestrator answers from the DB or routes to a connected Assistant (or the optional reasoner). (B-O2 "fetch full output if needed".) |

### Assistant verbs (per-user chat — read / propose only, gated by *that user's* RBAC)
| Verb | Payload | Effect |
|---|---|---|
| `get_ticket` | `{ ticketId }` | read model: `{ stageId, status, carryOver, openQuestions, history, links, costLabel }` |
| `list_tickets` | `{ stageId?, status? }` | board snapshot (for "how is X doing?") |
| `read_pipeline` | `{ workspaceId }` | the `PipelineStageCfg[]` + role/skill/doc catalogs (config-review / authoring) |
| `propose_suggestion` | `{ type, title, body, relatedTicketIds?, patch? }` | create `WorkspaceSuggestion(status:'open')`; emit `ws-ai:suggestion` |
| `draft_questionset` | `{ ticketId, rawQuestions }` | normalize/prettify raw questions into mobile-friendly `Question[]` (Conductor persists) |
| `refresh_docs` | `{ scope }` | runs the allow-listed `ai:*` doc-refresh command (03 §2) |
| (proposing a promote / config change) | — | the Assistant *proposes*; the **Conductor** executes after RBAC + validation, then replies `{ ok }` or `{ ok:false, reason:'forbidden' }` |

### Background reasoning (no standing per-workspace LLM)
There is **no standing Coordinator**. Coordination is the deterministic **Conductor** (§6). The Assistant read/propose surface above is reused, unchanged, by the **(optional, future) one-shot background reasoner** the Conductor spawns *only* for proactive/scheduled tasks when no user is online (01 §3.x) — fed a batch of unprocessed signals, it reasons, proposes, and exits.

### Scoping
Per-session token (maps token→ticket/stage/ws/user, so a worker can't spoof another ticket and an Assistant acts only as its user) + per-stage `permissions.allow` (which verbs/tools a session may call). With MCP transport, add `--strict-mcp-config` so a stage sees only its declared servers. **No session has write verbs** — mutations are Conductor-only.

---

## 3. Hooks — the lifecycle/event backbone (native, not the structured channel)

Claude `type:http` hooks POST to an orchestrator endpoint (`registerCustomRoute`, `pre-params` phase, origin-exempt, `X-WS-Hook-Token`-gated). They give events without scraping stdout, and they fire in **interactive** sessions too. (Mapping per `handoff/CLAUDE_SETTINGS_MAP.md` §3.)

> **Forward-compat note (report-only):** the `type:http` hook set is the **Claude realization** of a provider-neutral lifecycle contract — an API backend would synthesize the same normalized lifecycle events from a raw stream. See [MULTI_PROVIDER_SEAM](./MULTI_PROVIDER_SEAM.md).

| Hook | Use |
|---|---|
| `SessionStart` | register the `AgentSession`; inject carry-over |
| `PostToolUse` (Bash/Edit/Write/mcp__*) | → `TicketEvent` (the event-log source) |
| `PostToolUseFailure` | → error `TicketEvent` (+ maybe needs-input) |
| `Notification` (`permission_prompt`\|`idle_prompt`) | → `needs-input` + `Notification` |
| `Stop` | turn finished → done-check / promote-offer + token-budget check (06) |
| `PreCompact` | near-context-limit signal — co-opt as a token-optimization trigger (06) |
| `UserPromptSubmit` | log the prompt (incl. voice transcript) as a `TicketEvent` |

**Turn-end detection** (no ANSI sentinel-scraping): primary = the worker's `emit_carryover` (explicit done); secondary = the `Stop` hook; tertiary = PTY `onExit`; backstop = watchdog idle.

---

## 4. Carry-over envelope (spec B-O2 — unchanged contract)

What every stage emits and the next receives:

```jsonc
// emit_carryover payload — validated against the stage's output schema:
{
  "summary": "string",         // required
  "changedFiles": ["path"],    // required (may be empty)
  "openQuestions": ["string"], // required (may be empty)
  "commitHash": "string"       // required (frozen snapshot)
}
// Conductor wraps it on persist (agent never writes these):
// CarryOver { ticketId, fromStageId, toStageId, sessionId, envelope: <above>, createdAt }
```

- `Ticket.carryOver` (the existing string field) stays the **human-readable** one-liner shown in the UI banner. The structured envelope lives in the new `CarryOver` model for machine injection.
- **Injection A→B (on promote):** the Conductor fills the next stage's `promptTemplate` `{{summary}} {{changedFiles}} {{openQuestions}} {{commitHash}}` (the `CARRY_VARS` chips already in `seed.ts`) from the stored envelope, writes the injected prompt, and spawns stage B. If B needs more, it calls `query_context` for the full prior output (B-O2 on-demand).
- **Human and AI stages share the envelope** — an `aiEnabled=false` stage just means a human fills it via the UI.
- **Same machinery powers the within-session self-handoff** (06): a long session writes a handoff (a superset of this envelope) and reloads it after `/clear`.

---

## 5. Question / approval flow (the phone-from-the-beach core)

The current `ChatMessage{id,role,text}` + single-string `Ticket.needsInput` are too thin to answer on a phone. Add **`QuestionSet`**:

```ts
interface QuestionSet {
  id; workspaceId; ticketId; stageId;
  sessionId: string;                 // which AgentSession asked (for --resume)
  status: 'open' | 'answered' | 'superseded';
  questions: Question[];
  createdAt; answeredAt?;
}
interface Question {
  id; text;
  kind: 'free' | 'choice' | 'approve';   // approve = a gate, tap Approve/Reject
  choices?: string[];                    // for kind:'choice' — one-tap on mobile
  answer?: string;
}
```
`Ticket.needsInput` becomes the denormalized one-liner (= first open question) for the board banner; the full set lives in `QuestionSet`. `ChatMessage` gains optional `questionSetId` so a chat bubble can render a question card inline.

**Flow:** Stage-Agent calls `request_input`/`emit_question` (it can pre-phrase the questions itself; or a `Notification(permission_prompt)` hook becomes a single `approve` question). The Conductor may have the user's **Assistant** normalize raw questions into tappable choices via `draft_questionset` (if nobody's online, a deterministic banner suffices until a user opens it), then persists the QuestionSet, sets `needs-input`, and fires a `Notification` (in-app + email + web-push, B-34) that deep-links to the ticket. **Mobile:** the banner renders the QuestionSet as cards — choice = one tap, approve = Approve/Reject, free = short text. The per-user chat panel is the free-text fallback (the Assistant interprets it into the same answers). On submit → the Conductor stamps answers, resumes the same agent, sets `busy`. **Approve == Promote:** an `approve` QuestionSet on a `done` stage IS the promote gate (mobile card vs desktop button).

---

## 6. Signals / Suggestions / Notes / Notifications — and how ticket-agents report back

> **This answers "do the per-ticket agents talk to a general AI, or is it all structured JSON?"** — It's structured JSON into a durable log; the **deterministic Conductor** consumes it (no LLM needed for coordination). LLM judgement, when needed, is deferred to a connected user's Assistant or an optional one-shot reasoner. Agents never chat an LLM directly.

- **`WorkspaceSignal`** — append-only, durable (spec B-O6). A Stage-Agent calls the **`emit_signal`** verb (structured JSON via the CLI/HTTP helper = "the API"); the Conductor appends a row (`seq`-ordered). `type ∈ observation | stopped | dependency-hint | suggestion-input | config-observation | maintenance-hint`. The **Conductor consumes the log serially under a Redis lease**: it applies deterministic rules directly, and for entries needing LLM judgement it defers to a connected user's Assistant — or, with no user online, an optional one-shot reasoner — to `propose_suggestion`. Indirect-via-log on purpose: durable (survives restart), no interleaving/race, decoupled (no reasoner need exist when the signal is emitted), and it keeps any reasoner's context from being flooded with raw stage chatter (the Conductor can batch/summarize first).
  - **The "stopped" path:** a stuck agent calls `emit_signal('stopped', {reason, userQuestion?})` (or the watchdog synthesizes it) → Conductor sets `stuck`; the agent has self-phrased a user question (or a deterministic notification fires on a hard crash) → `needs-input` + `Notification`.
  - **Synchronous exception:** when an agent needs an answer *now* ("is another ticket touching this file?"), it uses **`query_context`** (not `emit_signal`) → the orchestrator answers from the DB or routes to a connected Assistant (or the optional reasoner) → returns inline.
- **`WorkspaceSuggestion`** (proposes-only, B-23) — `type ∈ link-tickets | create-epic | config-review | maintenance` (+ `automation`); `status ∈ open|accepted|dismissed|snoozed` (+ `snoozedUntil`); may carry an appliable `patch` (config-review). The UI `AiSuggestion` stub is its read-projection. **Accept → the Conductor executes** (RBAC-gated). Who drafts: deterministic Conductor rules for the simple ones (e.g. two tickets touched the same file → `link-tickets`); a connected user's Assistant (or the optional one-shot reasoner) for reasoning-heavy ones (`config-review`, staleness `maintenance`).
- **`WorkspaceNote`** — free-form `{ body, archived }`.
- **`Notification`** (B-34) — `type ∈ needs-input | merge | ai-suggestion | container-failure`; `channels ∈ inapp|email|push`; the UI `NotificationItem` is its projection (`time` ← `createdAt`).

---

## 7. RBAC / proposes-only boundary (enforces B-23)

> **B-23 (quoted):** "De Workspace-AI mag **alleen voorstellen produceren** (`WorkspaceSuggestion`) en notities schrijven; nooit zelf scrum-/git-acties uitvoeren. **Uitvoeren gebeurt pas na `accept` door een gebruiker** (en respecteert de RBAC…)."

| Action | Emitted by | Executed by | Gate |
|---|---|---|---|
| Edit file / run cmd / open MR | Stage-Agent | Stage-Agent (in container) | `permissions.allow/ask/deny` + egress sandbox + `--max-turns`/budget |
| Set status / write `TicketEvent` / write `CarryOver` / write `Handoff` | Conductor | Conductor | deterministic (status is AI-owned); no human gate |
| Promote A→B | **user** (approve/promote, via their Assistant or the board) | Conductor | user accept; RBAC "work on tickets" |
| `link-tickets` / `create-epic` | Assistant (or optional reasoner) | Conductor on accept | user accept (+ RBAC for epic/sprint) |
| `config-review` (apply a stage-config patch) | Assistant (or optional reasoner) | Conductor on accept | user accept **+ RBAC "edit pipeline/stages"** (a Member cannot accept) |
| `maintenance` (re-index / refresh docs) | a Conductor rule or an Assistant | Conductor on accept | user accept |
| Send Notification | Conductor | Conductor | deterministic |
| Pause / Resume / Answer | **user** | Conductor | RBAC "work on tickets" |

**Hard rule:** no Assistant (or future reasoner) session has **any write verb** in its structured-channel surface, so they are *structurally* unable to execute scrum/git actions — B-23 is guaranteed by the architecture, not by prompt discipline. An Assistant's proposals are additionally gated by *its own user's* role.
