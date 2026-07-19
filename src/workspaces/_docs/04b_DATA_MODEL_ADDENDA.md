# 04b — Data model addenda (§6–§11 bodies, field sweep, type reconciliation)

> Build-grade addendum to [`04_DATA_MODEL.md`](./04_DATA_MODEL.md). **Does not edit 04.** This doc supplies the model bodies that feature docs 16–24 cite as `DATAMODEL §6–§11` (which `04 §1–§5` names but does not spell out), the Resolved-decision field sweep, the typed `StageKind` reconciliation, the `WorkspaceSuggestion` enum + patch field, the carryOver/Handoff relationship + fenced-block parsing pointer, and a `types.ts` backfill checklist with a recomputed delta count. Provider: MongoDB (`@map("_id") @db.ObjectId`); tenant = `Workspace`; every tenant model carries `workspaceId`. Cite this doc as `[04b §N]`.
>
> **Authority:** every section here traces to a `Q-DATA-*` (and a few `Q-SEC-*`/`Q-MP-*`) decision in [`REVIEW_AND_OPEN_QUESTIONS.md`](./REVIEW_AND_OPEN_QUESTIONS.md), all LOCKED 2026-06-04. The `→` markers carry the originating `Q-*` id inline. Where this doc states a persisted shape, the [INDEX delta table](./features/INDEX.md#new-fields--models-delta-table) is the aggregation source; this doc reconciles the deltas into model bodies, it does not invent new persistence beyond them.
>
> **No new verbs.** Nothing here adds, renames, or relaxes a structured-channel verb. The frozen surface (02 §2: 7 worker + 6 assistant verbs, all read|propose, none write) is untouched; every "write" implied below is a Conductor action behind `[control-API]`, never an LLM verb (B-23).

---

## §0. How this maps onto 04

`04` is organized as: §1 already-modeled · §2 new models · §3 field extensions · §4 append-only & tenant rules · §5 prototype-migration notes. It references `handoff/DATAMODEL §1–§11` as the formal Prisma source, but the live `04` body only develops §1–§5 worth of material, and the `handoff/` tree is frozen/deprecated (see `Q-INF-REFCODES`; codes inlined via `REFERENCE_CODES.md`). The feature docs nonetheless cite the persisted shapes by section number:

| Cited as | Owner doc(s) that cite it | Lives here as |
|---|---|---|
| `DATAMODEL §6` (event log) | 20 | [§6](#6-ticketevent--the-append-only-event-log) |
| `DATAMODEL §5`/§ runtime (AgentSession) | 05, 14, 24, 07 | [§7](#7-agentsession--the-one-canonical-runtime-row) |
| `DATAMODEL §7` (suggestions) | 11, 03 | [§8](#8-workspacesuggestion--5-value-type--patch) |
| `DATAMODEL §8` (spend/budget) | 05, 19 | [§9](#9-spendrecord--multi-row-workspacebudget) |
| `DATAMODEL §9` (notifications) | 18, 17 | [§10](#10-notification--pushsubscription) |
| `DATAMODEL §10`/§11 (rules + RBAC) | 16, 22, all | [§11](#11-append-only-framework-global-delete-cascade--workspacerole) |

`04 §2` already gives bodies for `AgentSession` (partial — three conflicting defs, reconciled in [§7](#7-agentsession--the-one-canonical-runtime-row)), `CarryOver`, `Handoff`, `QuestionSet`/`Question`, `WorkspaceTrigger`. Those are NOT re-defined here except where this doc canonicalizes a conflict (AgentSession) or pins a relationship (carryOver/Handoff, [§14](#14-carryover-string-vs-carryover-envelope-vs-handoff--the-fenced-block-contract)). → `Q-DATA-DATAMODEL-SECTIONS`

---

## §6. `TicketEvent` — the append-only event log

The single ordered, immutable, per-ticket fact stream. Doc 20 renders it (actor/type chips, LIVE badge, subscribe-first → snapshot → merge-on-`seq`, rewind scrubber); docs 18/22/24 source notifications and projections from it. Append-only (never updated/deleted via the app — `04 §4`). The prototype mirror is `ActivityEvent` (`types.ts:137`). → `Q-DATA-DATAMODEL-SECTIONS`

```prisma
model TicketEvent {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId          // tenant
  ticketId    String   @db.ObjectId
  seq         Int                              // MONOTONIC per ticket (Redis INCR, see below); the merge/dedupe key
  type        String                           // 'command'|'file-change'|'ai-message'|'status-change'|'mr'|'comment'  (+ growth)
  actor       String                           // member userId | 'ai' | 'conductor' | 'mr' | 'gitlab'
  sessionKey  String?                          // worker:ticket:stage | assistant:user | conductor — provenance of an AI-sourced event
  stageId     String?                          // the StageKind key (see §12) the event occurred in, if stage-scoped
  text        String                           // rendered one-liner for the feed
  metadata    Json?                            // { commitHash?, changedFiles?[], mrUrl?, diffRef?, voiceTranscript?, ... } — type-specific payload
  createdAt   DateTime @default(now())

  @@index([workspaceId, ticketId, seq])        // the ordered-read index (subscribe-first → snapshot)
  @@index([workspaceId, createdAt])             // the workspace-wide feed (doc 20 bounded-window)
}
```

**Monotonic `seq` — the load-bearing ordering guarantee.**
- `seq` is allocated by **Redis `INCR ws:{workspaceId}:ticket:{ticketId}:evseq`** at write time (the key formatter is `registerRedisKeyFormatter`, tenant-scoped). It is per-ticket, gap-tolerant (a crashed writer may burn a number — gaps are allowed, reordering is not), and strictly increasing. `seq` — NOT `createdAt` — is the client merge/dedupe key (clock skew across instances makes timestamps unsafe; D83 dedupes within a ticket by `seq`).
- The **only writer is the Conductor** (`01 §3.3`); no LLM verb writes a `TicketEvent` (B-23). `emit_event` (worker) and the GitLab webhook (`07 §C`) are *inputs* the Conductor serializes into the log — they do not write rows directly.
- **Subscribe-before-fetch race** (the first vertical-slice regression test, `Q-INF-TESTING`): a client subscribes to the `/pty`-sibling event channel, THEN fetches the snapshot up to the highest `seq`, THEN merges live events with `seq > snapshotMax`, discarding duplicates. The test pins this ordering; without it, an event arriving between snapshot and subscribe is lost.
- `metadata.voiceTranscript?` (doc 06, build-deferred D5) and `metadata.commitHash`/`changedFiles` (the rewind scrubber's snapshot cursor, D64) ride the existing `metadata Json?` — **no new columns** for either.

**No new verbs.** Writes are Conductor-internal; `emit_event` stays a propose-grade signal the Conductor consumes.

---

## §7. `AgentSession` — the ONE canonical runtime row

`AgentSession` had **three conflicting definitions** (`handoff/DATAMODEL §5`, `04 §2`, and the INDEX delta additions) — the #1 runtime-cohesion hazard. This is the single merged source of truth; `04 §2` cites THIS body. It is the orchestrator's durable runtime fact: socket sessions are ephemeral, and the cron recovery sweep reconstructs an accepted fenced prepare from the row plus its processed `WorkspaceSignal`; the container layer pins that recovery on `containerId`/`worktreePath`/`claudeSessionId`. The current runtime does **not** implement a standalone `resumeAll()` PTY rebind/token-remint pass. → `Q-DATA-AGENTSESSION`, merges INDEX deltas `AgentSession.durationEstimate` (05) + `tokenEstimate` (04 §2).

```prisma
model AgentSession {
  id              String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId     String   @db.ObjectId         // tenant
  ticketId        String?  @db.ObjectId          // null for assistant sessions not bound to a ticket
  stageId         String?                         // the StageKind key (§12); worker sessions only

  // --- identity / role ---
  kind            String                          // 'assistant' | 'worker'  (+ optional future 'reasoner' — one-shot, not standing; Q-ENG-REASONER)
  userId          String?  @db.ObjectId           // ASSISTANT sessions only: whose chat this is → drives that user's RBAC scope (01 §3.2)
  sessionKey      String                          // canonical key: assistant:{userId} | worker:{ticketId}:{stageId} | reasoner:{...}

  // --- engine / lifecycle (Claude-CLI-PTY realization) ---
  claudeSessionId String?                         // for `claude --resume` after crash/suspend; RE-CAPTURED if /clear rotates it (Q-ENG-CLEAR)
  model           String?                         // resolved model literal at spawn (haiku|sonnet|opus — provider-specific, Q-MP-CAPREG)
  cliVersion      String?                         // EXACT pinned Claude CLI version that ran this session (Q-CT-CLIPIN, audit: "which CLI built this MR")
  baseImageRef    String?                         // resolved L2 image tag (content-hash) this session ran in (Q-CT-IMGLIFECYCLE)

  // --- container binding (crash-recovery; Q-CT-RESUME) ---
  containerId     String?                         // the L3 per-ticket container id; null for host-side reasoning roles (Q-CT-HOSTROLES)
  worktreePath    String?                         // the in-container clone path (Q-CT-WORKTREE clone-into-volume)
  ptyAgentUrl     String?                         // 127.0.0.1:<port> the in-container pty-agent publishes (Q-CT-PTYAGENT), read via docker inspect

  // --- status (the SINGLE runtime state machine) ---
  status          String                          // ready | busy | paused | recovering | stopped (recovering is server-only; ADR 0279)

  // --- budget / estimate feed (advisory; Q-ENG-TOKENFEED) ---
  tokenEstimate   Int      @default(0)            // running estimate for the 06 self-handoff / budget trigger; ADVISORY (char-count or hook-payload, never precise)
  durationEstimate Int?                            // seconds; cold-start self-estimate parsed by Conductor from the planning agent's carry-over summary (D4, doc 05); >= 0, nullable until a planning stage runs

  // --- structured-channel security (Q-ENG-TOKEN-LIFECYCLE) ---
  channelTokenId  String?                         // reserved token id (NOT secret); standalone recovery remint is NOT implemented yet
  hookTokenId     String?                         // reserved separate WS_HOOK_TOKEN id; same not-yet-implemented recovery lifecycle

  startedAt       DateTime @default(now())
  lastHeartbeatAt DateTime?

  @@index([workspaceId, ticketId])
  @@index([workspaceId, kind, userId])            // an Assistant lookup by (kind, user)
  @@index([workspaceId, status])                  // CapacityManager admission scan (Q-CT-CAPACITY)
  @@unique([workspaceId, sessionKey])             // one live row per logical session
}
```

**Runtime `status` set — `ready | busy | paused | recovering | stopped`.** The four ordinary lifecycle states remain unchanged; `recovering` is a transient server-only fenced-recovery state (ADR 0279), never a client/LLM transition. This is the *runtime/engine* state of the SESSION, distinct from `Ticket.status`/`TicketStatus` (the AI-owned ticket lifecycle: `idle|needs-input|busy|done|paused|stuck`, `types.ts:15`) and from `StageStatusCfg` (per-stage non-lifecycle labels). The three state machines stay separate (`Q-DATA-STATUS`). Mapping of the older 8-literal draft (`starting|ready|busy|needs-input|done|stuck|killed|error`) onto the ordinary lifecycle states:

| Old literal | Canonical | Note |
|---|---|---|
| `starting`, `ready` | `ready` | transient spawn collapses into ready; the slot is held but no turn is running |
| `busy` | `busy` | a turn is executing; holds a concurrency slot (released on the Stop hook, `Q-ENG-TURNEND`) |
| `needs-input` | `busy` + open `QuestionSet` | needs-input is a TICKET state, not a session state — the session is parked awaiting an answer; surfaced via `Ticket.needsInput` + an open `QuestionSet` ([04 §2]), not a session status |
| `done` | `stopped` | the PTY process exited cleanly at stage end (container survives until ticket teardown, `Q-CT-UNIT`) |
| `paused` | `paused` | session parked, container KEPT for `--resume` (D87); reclaimable after an idle window |
| `stuck` | `busy` + Conductor escalation | `stuck` is the Conductor's runaway verdict → it forces `needs-input` (a TICKET state) via the carry-over-enforcement loop (`Q-ENG-CARRYOVER-ENFORCE`) |
| `killed`, `error` | `stopped` | terminal; `metadata`/the event log records the cause |

**Lifecycle facts pinned here:**
- The implemented recovery path is the leader-safe cron sweep, not `resumeAll()`: it scans `busy` plus durable `recovering`/`stopped` retry rows, reconstructs the exact processed prepare, validates the immutable container + owner fence (or the exact already-stopped container for an idempotent stop replay), and starts a normal higher-fence successor (using stored `claudeSessionId` for `--resume` when applicable). PTY-agent reattachment and `channelTokenId`/`hookTokenId` reminting remain **not implemented**; no current doc may claim otherwise.
- A stage transition is a NEW PTY (new row OR a re-keyed `sessionKey`) in the SAME container with freshly-rendered `.claude` (`Q-CT-UNIT`); the old PTY's row goes `stopped`.
- Host-side reasoning roles (Refine/Plan, `needsWorkspace=false`) leave `containerId`/`worktreePath` null and run in a minimal RO container (`Q-CT-HOSTROLES`).

**No new verbs.** Session lifecycle is driven by `[control-API]` Conductor actions + the Stop/SessionStart hooks; no LLM verb mutates this row.

---

## §8. `WorkspaceSuggestion` — 5-value `type` + `patch`

The Assistant's propose-only output (B-23): docs 11 (panel) + 03 §4 (config-review) render it. The `type` enum **diverged** (DATAMODEL 4-value / `04 §3` adds `automation` / `types.ts:103` 4-value missing `automation`). Canonical = the **5-value set**; `types.ts` `AiSuggestion.type` is backfilled to match ([§15](#15-typests-backfill-checklist)). Adds `patch Json?` for appliable config-review patches. → `Q-DATA-SUGGESTION-ENUM`

```prisma
model WorkspaceSuggestion {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  type        String                              // 'link-tickets' | 'create-epic' | 'config-review' | 'maintenance' | 'automation'  (5-value, CANONICAL)
  title       String
  body        String
  ticketIds   String[] @db.ObjectId               // tickets the suggestion concerns (link-tickets / create-epic)
  patch       Json?                               // appliable config patch for config-review/automation: { path, before, after } — applied ONLY when the user accepts → Conductor executes (B-23)
  status      String   @default("open")           // 'open' | 'accepted' | 'dismissed'
  createdAt   DateTime @default(now())

  @@index([workspaceId, status, createdAt])
}
```

- The 5th value `automation` lets the Assistant propose a `WorkspaceTrigger` (`04 §2`); `patch` carries the trigger draft. Accepting routes through `[control-API]` → the Conductor materializes the trigger (never the LLM — `propose_suggestion` is the only verb involved, and it is propose-grade).
- `patch` is `Json?` (nullable): `link-tickets`/`create-epic`/`maintenance` suggestions carry none; `config-review`/`automation` do.

**No new verbs.** `propose_suggestion` (assistant, propose-grade) is the only surface; acceptance is a `[control-API]` write.

---

## §9. `SpendRecord` + multi-row `WorkspaceBudget`

Doc 19 (Usage & Budget) + doc 05 (per-session cost chips) render these. `SpendRecord` is the append-grade per-turn cost fact; `WorkspaceBudget` is now **multi-row** (multi-cap IS v1 per D81/D82 — `Q-INF-BUDGET-SCOPE` overruled the review's single-cap recommendation). Prototype mirrors: `UsageRow` (`types.ts:225`), `WorkspaceBudget` (`types.ts:129`, single-row — backfilled to multi-cap in [§15](#15-typests-backfill-checklist)). → `Q-DATA-DATAMODEL-SECTIONS`, `Q-INF-BUDGET-SCOPE`

```prisma
model SpendRecord {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  ticketId    String?  @db.ObjectId
  stageId     String?                             // StageKind key (§12)
  sessionKey  String                              // the AgentSession this turn belongs to
  tokensIn    Int      @default(0)                // ADVISORY in PTY mode (hook payload if present else char-count estimate; Q-ENG-TOKENFEED)
  tokensOut   Int      @default(0)
  model       String                              // resolved model literal (pricing key)
  costEstimate Float   @default(0)                // tokens × editable per-model price (D31); 0 when pricing zeroed-out (tokens-only)
  createdAt   DateTime @default(now())

  @@index([workspaceId, ticketId, createdAt])     // per-ticket cost chip (actual-so-far)
  @@index([workspaceId, stageId, createdAt])      // rolling per-stage average → the D4 estimate blend
}
```

```prisma
model WorkspaceBudget {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId  String   @db.ObjectId               // MULTIPLE rows per workspace (multi-cap, D81)
  label        String                              // the cap's display name in the caps-list editor (doc 19)
  cap          Float                               // the spend/quota ceiling, in the periodWindow's unit
  alertPct     Int      @default(80)               // notify threshold (% of cap)
  enforcement  String                              // 'pauseNew' | 'pauseAll'  (D81 — see below)
  periodWindow Json     @default("\"calendar-month\"") // 'calendar-month' | { rolling: '5h' | '30d' | ... }  (D82; default calendar-month in workspace tz, §13)
  spent        Float    @default(0)                // running spend in the current window (recomputed on reset)
  windowStartAt DateTime @default(now())           // start of the current period window (rolls forward on reset)
  enabled      Boolean  @default(true)
  createdAt    DateTime @default(now())

  @@index([workspaceId, enabled])
}
```

- **`enforcement` (D81):** `pauseNew` blocks new sessions, lets in-flight turns finish; `pauseAll` pauses ALL active sessions to `stopped` immediately. Enforcement is a **Conductor** action (`[control-API]` `pause-all`, doc 24), advisory-then-pause — NOT a hard pre-flight gate (the subscription billing path keeps the cap advisory; only a future metered backend inverts this to a hard `blockTurn`, `Q-MP-BILLING` — documented, no schema field now).
- **`periodWindow` (D82):** `'calendar-month'` (default, workspace tz — [§13](#13-resolved-decision-field-sweep)) or a rolling window `{ rolling: '5h' }` that can express provider-native quotas (e.g. Claude's 5-hour). The `Json` shape is shipped as-is (multi-cap is v1); it is NOT pre-shaped around the parked multi-provider abstraction beyond what D82 already requires (`Q-MP-CAPREG` — a future capability registry supplies the meter UNIT a metered window needs).
- **"Which cap fired" modal (doc 19):** when any enabled cap's `spent ≥ cap`, the Conductor fires the cap's `enforcement` and emits a `Notification` naming the `label`. The caps-list editor + per-cap bar + which-cap-fired modal are fully spec'd (the doc-19 single-bar mockup is corrected to the caps list — `Q-INF-BUDGET-SCOPE` consequence, fixed in doc 19, not here).

**No new verbs.** Spend is accrued by the Conductor from hook/usage payloads; enforcement is a `[control-API]` action.

---

## §10. `Notification` + `PushSubscription`

Doc 18 (cross-surface alerts + PWA web-push) + doc 17 (push opt-in). `Notification` is the server-owned source; `NotificationItem` (`types.ts:119`) is the read-projection. → `Q-DATA-DATAMODEL-SECTIONS`, `Q-SEC-NOTIF-PUSH`

```prisma
model Notification {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  userId      String   @db.ObjectId               // recipient (per-user; fan-out is one row per recipient)
  type        String                              // 'needs-input' | 'merge' | 'ai-suggestion' | 'container-failure'  (the four, doc 18)
  title       String
  body        String                              // full body — stored server-side, shown IN-APP behind auth
  ticketId    String?  @db.ObjectId               // deep-link target (D65 navigate({ view, ticketId?, tab? }))
  deepLink    Json?                               // { view, ticketId?, tab?, terminalId? } — the D65 navigate payload
  read        Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@index([workspaceId, userId, read, createdAt]) // the bell + unread badge + grouped center
}
```

```prisma
model PushSubscription {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId
  userId        String   @db.ObjectId             // FRAMEWORK-GLOBAL (not tenant-scoped — a user's device, not a workspace's; §11)
  endpoint      String                            // the Web Push endpoint URL
  keys          Json                              // { p256dh, auth } — the Web Push encryption keys (server-only secret)
  fullBodyOptIn Boolean  @default(false)          // D80 REVERSED (Q-SEC-NOTIF-PUSH): push is REDACTED by default; full body opt-in per device
  createdAt     DateTime @default(now())
  lastUsedAt    DateTime?

  @@index([userId])
}
```

**Redacted-push posture (D80 REVERSED — `Q-SEC-NOTIF-PUSH`, sign-off 2026-06-04):** the web-push *payload* carries only the title + "open to view" by default; the full `Notification.body` is fetched **in-app behind auth**. A device may opt into full-body pushes via `PushSubscription.fullBodyOptIn`. This reverses the earlier full-body default (D80) per rule 19; doc 18 + the INDEX D80 row are updated to "redacted default; full-body opt-in" (corrected in those docs, not here).

**No new verbs.** Notifications are written by the Conductor from existing hooks/events (`07 §A`/`07 §C`); the client never writes one.

---

## §11. Append-only, framework-global, delete-cascade + `WorkspaceRole`

Consolidates the immutability/tenancy/cascade rules `04 §4` states for the new models, plus the tenant-scoped `WorkspaceRole` (custom RBAC, D76). → `Q-DATA-DATAMODEL-SECTIONS`, `Q-SEC-RBAC-ROLES`, `Q-SEC-RUNINTENANT`

### 11a. Append-only (app NEVER updates/deletes)
`TicketEvent`, `RagEntry`, `WorkspaceSignal`, `SpendRecord`, `CarryOver`, `Handoff`. Immutability is **app-enforced** (no update/delete path in any handler). A correction is a NEW append (e.g. a superseding `QuestionSet`, D49). These six are the DR restore-priority set (`Q-INF-DR`: the event log restores first).

### 11b. Framework-global (NOT tenant-scoped — no `workspaceId`)
`User`, `OAuthAccount`, `SshKey`, sessions (the framework session store), and `PushSubscription` (a user's device). Everything else carries `workspaceId` and goes through `tenantDb` (`getPrismaClientFor` + the Redis key formatter, B-O8).

### 11c. `runInTenant` is mandatory for every non-`/api` path (`Q-SEC-RUNINTENANT`, tracked P1 prerequisite)
The orchestrator's AI sessions (Assistants/Stage-Agents/optional reasoner) + the Conductor + **every background worker** (RAG indexer, pty-agent, signal-consumer, cron, reconcile-cron) run OUTSIDE the `/api` lifecycle, so they MUST call `runInTenant(workspaceId, …)` explicitly. The `$extends` where-injection isolation is first-class; the failure mode is `currentWorkspaceId()` throws (a hard crash, never a silent cross-tenant read). This is a checklist item every non-`/api` lane verifies, not an open flag.

### 11d. Delete-cascade (workspace teardown)
Deleting a `Workspace` cascades to every tenant-scoped row carrying its `workspaceId`: `Project`/`Pipeline`/`PipelineStage`(+children), `Ticket`/`TicketLink`/`TicketReference`/`Sprint`, `TicketEvent`, `AgentSession`, `CarryOver`/`Handoff`/`QuestionSet`, `WorkspaceTrigger`, `WorkspaceSignal`/`WorkspaceSuggestion`/`WorkspaceNote`, `SpendRecord`/`WorkspaceBudget`, `Notification`, `WorkspaceRole`, `InfoSource`/`RagEntry`, `WorkspaceMember`/`Invite`, `PreviewDeployment`. Framework-global rows (§11b) are NOT touched. Append-only rows ARE deleted on workspace teardown (immutability is within a workspace's life, not across its deletion). Live containers for the workspace are torn down (`07 §A`) BEFORE the row cascade so no orphaned PTY survives.

### 11e. `WorkspaceRole` — custom RBAC (D76, `Q-SEC-RBAC-ROLES`)
`WorkspaceMember.role` is a fixed enum and cannot express D76's fully-configurable custom roles. Add a tenant-scoped `WorkspaceRole`; `WorkspaceMember` references it by `key` (built-ins seeded per workspace). Prototype mirror: `PermRole` (`types.ts:236`).

```prisma
model WorkspaceRole {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  workspaceId String   @db.ObjectId
  key         String                              // stable ref ('owner'|'admin'|'member' seeded; custom keys added)
  label       String                              // editable display name
  perms       Boolean[]                           // one boolean per RBAC_CAPABILITIES entry (B-28 matrix, positional)
  builtIn     Boolean  @default(false)            // seeded built-ins (cannot be deleted; CAN be edited per D76 — no rows hard-locked)
  createdAt   DateTime @default(now())

  @@unique([workspaceId, key])
  @@index([workspaceId])
}
```

- **Single-Owner invariant (D77):** enforced in the membership `preApiExecute` check (block self-demotion; ownership moves only via transfer), **NOT** by locking rows. D76 keeps every row fully configurable (a custom role may grant any capability, including admin-management/transfer/delete); the invariant is behavioral, not structural.
- `WorkspaceMember.role` becomes a `key` reference into `WorkspaceRole` (per-workspace), replacing the fixed enum. The prototype's `Role` union (`types.ts:10`) stays as the seeded-built-in shorthand.

**No new verbs.** Every RBAC lever is a `[control-API]` request (doc 16), enforced in `preApiExecute` — never a structured-channel verb.

---

## §12. Typed `StageKind` — replacing the fixed 7-literal `StageId`

`types.ts:14` pins `StageId = 'unrefined'|'refined'|'plan'|'impl'|'test'|'review'|'final'` — a fixed 7-literal union that contradicts the dynamic 3/5/7 preset model (D1) and the free-string `PipelineStageCfg.id` (`types.ts:300`). Blind-stringifying it loses exhaustiveness AND breaks the screens that key columns by it (`Board.tsx:25` `Record<StageId, Ticket[]>`, `:30`, `:165`). Resolution: a typed **`StageKind`** the preset instantiates. → `Q-DATA-STAGEID`

```ts
// the SEMANTIC kind a stage plays in the pipeline — provider/preset-agnostic, exhaustive.
// A preset (D1) instantiates an ORDERED list of stages, each tagged with a StageKind;
// PipelineStageCfg.id stays a free string (custom stages); PipelineStageCfg.kind: StageKind is the typed role.
export type StageKind =
  | 'refine'      // 'unrefined' + 'refined' collapse to the refine role (intake/grooming)
  | 'plan'
  | 'code'        // 'impl'
  | 'test'
  | 'review'      // covers Reviewer1/Reviewer2 (professional dual-review, D16) — distinguished by order, not kind
  | 'final';
```

- **Why a kind, not the id:** the AgentRole plugin model (`03 §3`, `PipelineStageCfg.roleKey`) and the system-prompt layering (D2) bind to the *role a stage plays*, not its position. Two `review` stages (dual review) share `kind:'review'` but differ by `order` + `id`. The 3-tier preset emits `['refine','code','review']`; the 7-tier emits `['refine','plan','code','review','review','test','final']`. → reconciled with the dynamic preset model.
- **`PipelineStageCfg` gains `kind: StageKind`** (the typed role) while `id` stays the free string (`types.ts:300` comment already anticipates custom stages). `PipelineStage.id: StageId` (`types.ts:42`) is widened to `id: string` + `kind: StageKind`.
- **Migration of the seed's 7-literal ids** (`seed.ts:63–69`): `unrefined`/`refined` → `kind:'refine'`; `plan` → `'plan'`; `impl` → `'code'`; `test` → `'test'`; `review` → `'review'`; `final` → `'final'`. The board columns (`Board.tsx`) key on the stage `id` (a string), NOT on `StageKind` — so `Record<StageId, …>` becomes `Record<string, …>` keyed by the stage id, and exhaustiveness moves to `StageKind` switches (role logic), where it belongs. **Audit `Board.tsx`/`Pipeline.tsx`/`WorkspacesContext.tsx` switches FIRST** (the only consumers, found via grep) before the swap — they index by id, not by kind, so the change is mechanical.
- This is a **typed-key reconciliation**, not a blind string (the `Q-DATA-STAGEID` rejection of option 3). `StageEffort`/`StageModelTier` keep their provider-specific literals with a one-line forward-pointer (`Q-MP-CAPREG`) — they are NOT folded into `StageKind`.

**No new verbs.** Pure type reconciliation; no protocol surface.

---

## §13. Resolved-decision field sweep

Fields minted by Resolved decisions across docs 01–24 that must land in the real schema. Each row cites its decision; all are additive. → `Q-DATA-FIELDSWEEP`, `Q-DATA-ASSIGNMENT`

| Field | On | Type | Decision / source | Note |
|---|---|---|---|---|
| `Workspace.timezone` | `Workspace` | `String` (IANA, default host tz) | D55 | anchors cron (doc 10) + budget `periodWindow` reset (§9) + sprint dates |
| `Workspace.previewConcurrencyCap` | `Workspace` | `Int` (safe default; hard-capped ~20) | D86 | max concurrent preview containers before "Open preview" queues (doc 23) |
| `Workspace.presetKey` | `Workspace` | `'simple'\|'advanced'\|'professional'` | D1/D18 | provenance-only (tiers fully editable post-instantiation) |
| `Workspace.assistantTokenBudget` | `Workspace` | `Int?` (+ optional `reasonerTokenBudget`) | 06, `04 §3` | per-workspace-AI budget → self-handoff |
| `Workspace.handoffInstruction` | `Workspace` | `String` (editable template) | 06, `04 §3` | the editable self-handoff instruction |
| `Workspace.pricing` | `Workspace` | `Json` (per-model price map, editable, sensible defaults) | D31 | zero-out → tokens-only cost chips (doc 19/05) |
| `Ticket.archived` | `Ticket` | `Boolean @default(false)` | doc 13 (bulk Archive) | backlog bulk-action target; soft, never deletes |
| `Ticket.lastActivityAt` | `Ticket` | `DateTime?` | doc 12/13 (sort, `TicketSort.key:'updated'`) | denormalized from the latest `TicketEvent`; the default backlog sort key |
| `Ticket.creatorId` | `Ticket` | `String?` (GitLab-derived cache) | `Q-DATA-ASSIGNMENT` | GitLab=SoT (B-29); reconciled by the webhook (`07 §C`); ui-optional (`types.ts:57` already present) |
| `Ticket.assigneeId` | `Ticket` | `String?` (GitLab-derived cache) | `Q-DATA-ASSIGNMENT` | same; `types.ts:58` already present |
| `Ticket.mrUrl` | `Ticket` | `String?` (GitLab-derived cache) | `Q-DATA-ASSIGNMENT` | the MR url; `types.ts:64` `mr?` is the prototype shorthand — canonical column `mrUrl` |
| `Ticket.issueUrl` | `Ticket` | `String?` (GitLab-derived cache) | `Q-DATA-ASSIGNMENT` | the issue url; `types.ts:64` `issue?` shorthand — canonical column `issueUrl` |
| `Sprint.startAt` | `Sprint` | `DateTime?` (workspace tz) | doc 13 (D55) | replaces the prototype's display-string `start` (`types.ts:111`) for the real column |
| `Sprint.endAt` | `Sprint` | `DateTime?` (workspace tz) | doc 13 (D55) | replaces display-string `end` |
| `Project.gitUrl` | `Project` | `String` | D? (INDEX 01) | the linked repo (alongside `gitlabPath`) |
| `Project.linkedFiles[]` | `Project` | `{ path; role:'generate'\|'link' }[]` | D9/D19 | GENERATE vs LINK |
| `Project.generatedDocsPath` | `Project` | `String @default("docs/luckystack/")` | D21 | where GENERATE'd docs are committed |
| `Project.baseImageRef` | `Project` | `String?` (+ optional `dockerfilePath`) | `Q-CT-IMAGESEL` | the L2 per-project image selector; default = framework base (P2) |
| `PipelineStageCfg.systemPrompt` | `PipelineStageCfg` | `String` | D2/D17 | the layered base prompt, distinct from `customInstructions`/`promptTemplate` |
| `PipelineStageCfg.roleKey` | `PipelineStageCfg` | `String @default("code")` | `04 §3` (03 §3) | the AgentRole plugin binding |
| `PipelineStage.avgTokensPerTurn` | `PipelineStage`/Cfg | `Int?` | doc 05 (D4/D28) | rolling per-stage average feeding the estimate blend |
| `StageModelCfg.contextBudgetTokens` | `StageModelCfg` | `Int?` | `04 §3` (06) | per-stage token budget → self-handoff |
| `WorkspaceSignal.seq` + `processedAt` | `WorkspaceSignal` | `Int` (monotonic) + `DateTime?` | `04 §3` (B-O6) | serial consumption ordering |
| **ro/rw DB credential pair** | per-`IntegrationTool`/tier | encrypted `String` pair (`mongo:ro`/`mongo:rw`) | D25, `Q-SEC-CREDLIFETIME` | long-lived per-tier DB users stored ENCRYPTED, injected at boot via tmpfs env-file (denyRead from Bash); NOT in `.claude/settings.json`. GitLab PAT lives in a server-side MCP tool (P4 minting deferred). |

Notes: `Ticket.mr?`/`issue?` (prototype shorthands) → canonical columns `mrUrl`/`issueUrl`; `creatorId`/`assigneeId` are already in `types.ts` and are confirmed GitLab-derived caches (not Workspaces-owned). `Sprint.start`/`end` (display strings) → real `startAt`/`endAt` DateTimes. The PRICING map lands on `Workspace.pricing` (D31).

---

## §14. carryOver-string vs `CarryOver` envelope vs `Handoff` — the fenced-block contract

Three overlapping carry-forward concepts, disambiguated (`04 §2` defines the two new models; this pins the relationship + the parsing contract). → `Q-DATA-CARRYOVER-HANDOFF`

| Concept | Shape | Audience | Scope | Lives in |
|---|---|---|---|---|
| `Ticket.carryOver` | `string` (`types.ts:67`) | **human** | the latest one-liner on the card | a denormalized string column |
| `CarryOver` envelope | `Json` `{ summary, changedFiles[], openQuestions[], commitHash }` (B-O2) | **machine** | stage → stage (a promotion) | `CarryOver` model (`04 §2`) |
| `Handoff` | `Json` `{ summary, decisions[], state, next[], gotchas[], carried? }` | **machine** (superset of the envelope) | WITHIN a session (budget/manual `/clear`+reload) | `Handoff` model (`04 §2`) |

- **Relationship:** `Handoff` ⊇ `CarryOver` envelope (it can carry the stage envelope in `carried?` when a self-handoff happens mid-stage). `Ticket.carryOver` (the human one-liner) is derived from the latest envelope's `summary`, NOT a third source of truth.
- **Parsing contract (the fenced-block convention, Conductor-side — NOT an envelope schema change):** the estimate (D27) and the carry-over envelope are emitted as **named fenced blocks inside the agent's `emit_carryover` summary**:
  - ` ```ws-estimate ` → `{ tokenEstimate?, durationEstimate?, confidence? }` parsed into `AgentSession.tokenEstimate`/`durationEstimate` (D4/D27).
  - ` ```ws-carryover ` → the `{ summary, changedFiles[], openQuestions[], commitHash }` envelope.
  - **Rules:** max-one block of each kind per emission; parse-failure falls back to treating the whole summary as the human one-liner (no crash, advisory only). The Conductor parses; this is the single documented place (the full spec is `02 §4`, cited — not restated here). The envelope schema does NOT change.
- **No verb collapses or additions:** `emit_carryover` (stage→stage) and `emit_handoff` (within-session) stay distinct worker verbs; the stray `emit_output` (doc 03 §3.4/§7) collapses INTO `emit_carryover` (`Q-ENG-VERB-EMITOUTPUT`) — `emit_output` is NOT a verb.

**No new verbs.** The fenced blocks ride existing `emit_carryover`/`emit_handoff` payloads; parsing is Conductor-side.

---

## §15. `types.ts` backfill checklist

`types.ts` (the prototype) claims field-for-field DATAMODEL parity it no longer has (~8 doc-only model families, 3 conflicting AgentSession defs, the fixed `StageId`). Backfill in ONE types-only pass (`Q-DATA-TYPES-BACKFILL`). Each item is types-only, no behavior:

- [ ] **`StageId` → `StageKind`** ([§12](#12-typed-stagekind--replacing-the-fixed-7-literal-stageid)). Replace the 7-literal union with `StageKind`; widen `PipelineStage.id`/`Ticket.stageId` to `string`; add `PipelineStage.kind`/`PipelineStageCfg.kind: StageKind`. Audit `Board.tsx`/`Pipeline.tsx`/`WorkspacesContext.tsx` key/switch sites first (they index by id, not kind — mechanical).
- [ ] **`AiSuggestion.type`** (`types.ts:103`): add `'automation'` → the 5-value set ([§8](#8-workspacesuggestion--5-value-type--patch)); add `patch?: Json`-equivalent (`patch?: unknown` in the UI type or a typed `{ path; before; after }`).
- [ ] **`WorkspaceBudget`** (`types.ts:129`): single-row → **multi-row/multi-cap** ([§9](#9-spendrecord--multi-row-workspacebudget)). Add `label`, `enforcement: 'pauseNew'|'pauseAll'`, `periodWindow`, `windowStartAt`; the screen renders a caps LIST, not one bar.
- [ ] **`AgentSession` runtime type** (no prototype type today — `Terminal`/`TerminalProcess`/`TerminalLine` are the UI view): add a typed `AgentSession` mirroring [§7](#7-agentsession--the-one-canonical-runtime-row) (`kind`, `userId`, `claudeSessionId`, `containerId`, `worktreePath`, `status: 'ready'|'busy'|'paused'|'recovering'|'stopped'`, `tokenEstimate`, `durationEstimate`).
- [ ] **`TicketEvent` parity** (`ActivityEvent`, `types.ts:137`): add `seq: number`, `stageId?`, `sessionKey?`, `metadata?` to align with [§6](#6-ticketevent--the-append-only-event-log).
- [ ] **`WorkspaceRole`** ([§11e](#11e-workspacerole--custom-rbac-d76-q-sec-rbac-roles)): `PermRole` (`types.ts:236`) already approximates it — add `key`, `builtIn`, `workspaceId` to make it the real `WorkspaceRole` mirror.
- [ ] **`Notification`/`PushSubscription`** ([§10](#10-notification--pushsubscription)): `NotificationItem` (`types.ts:119`) is the read-projection — add `deepLink?` + a `PushSubscription` type with `fullBodyOptIn`.
- [ ] **`Ticket` canonical cols**: `mr?`→`mrUrl?`, `issue?`→`issueUrl?`; add `archived`, `lastActivityAt`.
- [ ] **`Sprint`**: `start`/`end` display strings → real `startAt?`/`endAt?` DateTimes (keep display helpers ui-only).
- [ ] **Field-sweep additions** ([§13](#13-resolved-decision-field-sweep)): `Workspace.timezone`/`pricing`/`previewConcurrencyCap`/`assistantTokenBudget`/`handoffInstruction`; `Project.gitUrl`/`linkedFiles[]`/`generatedDocsPath`/`baseImageRef`; `PipelineStageCfg.systemPrompt`/`roleKey`; `PipelineStage.avgTokensPerTurn`; `StageModelCfg.contextBudgetTokens`.
- [ ] **Already-spec'd new types** to add now (per `04 §5`): `CarryOverEnvelope`, `Handoff`, `QuestionSet`/`Question`, `WorkspaceTrigger` (+ `TriggerEventKind`/`TriggerActionKind`), `AgentRole`/`TicketArtifact`, `PreviewDeployment`, `BoardFilter`, `TicketSort`.
- [ ] **Header correction**: drop the "mirror field-for-field where it matters / maps 1:1 / mechanical" claim (`types.ts:1–8`, `04 §5`) until the backfill lands; or enumerate the still-doc-only models. (`Q-INF-MIGRATION` — the "mechanical/1:1" wording is corrected in MIGRATION.md too.)
- [ ] **Forward-pointers** (no code change, comments only): one line beside `StageModelTier`/`StageEffort` (`types.ts:256–257`) — "provider-specific; a future capability registry replaces these" (`Q-MP-CAPREG`).

---

## §16. Recomputed delta count

The INDEX delta table (`features/INDEX.md`) states **"Net-new persisted fields/models: 14 … = 21 delta rows total, + 1 already-in-04 surfaced field"** — that count was computed from the feature-doc `INDEX delta:` lines BEFORE this cohesion pass folded in the §13 field sweep and §11e/§9 model canonicalizations. The recomputed totals:

**Net-new PERSISTED models introduced/canonicalized by this addendum (beyond the INDEX 14):**

| Source | Net-new persisted |
|---|---|
| INDEX delta (batch-1 ten + `PreviewDeployment` + final-sweep three) | **14** (unchanged — already aggregated) |
| §11e `WorkspaceRole` (D76, was only a prototype `PermRole`) | +1 model |
| §13 field sweep — fields NOT already in the INDEX 14 | +`Workspace.timezone`, `Workspace.pricing`, `Workspace.assistantTokenBudget`(+`reasonerTokenBudget`), `Workspace.handoffInstruction`, `Ticket.archived`, `Ticket.lastActivityAt`, `Ticket.mrUrl`, `Ticket.issueUrl`, `Sprint.startAt`, `Sprint.endAt`, `Project.baseImageRef`(+`dockerfilePath`), `WorkspaceSignal.seq`, `WorkspaceSignal.processedAt`, the **ro/rw cred pair** = **+14 fields** |
| §9 `WorkspaceBudget` multi-cap fields beyond `enforcement`+`periodWindow` (already in INDEX) | +`label`, `windowStartAt` = +2 fields |
| §8 `WorkspaceSuggestion.patch` | +1 field |
| §10 `Notification.deepLink`, `PushSubscription.fullBodyOptIn` | +2 fields |
| §6 `TicketEvent.seq`/`sessionKey` (the `seq` was assumed; named explicitly here) | +0 new (already implied by `04 §1`/B-O6) |
| §7 `AgentSession` merged fields (`claudeSessionId`, `containerId`, `worktreePath`, `ptyAgentUrl`, `cliVersion`, `baseImageRef`, `channelTokenId`, `hookTokenId`, `sessionKey`, `durationEstimate`) | +`durationEstimate` already in INDEX; the rest are runtime-merge of the 3 defs, not net-new persistence beyond `04 §2` → **+0 net-new beyond 04** |

**Recomputed total: 14 (INDEX) + 1 model (`WorkspaceRole`) + 19 additional persisted fields (§13/§9/§8/§10) = 1 net-new model + ~19 net-new fields ABOVE the INDEX 14, i.e. ~34 net-new persisted fields/models once the field sweep + RBAC + multi-cap details are folded in** (plus the 7 ui-only types from the INDEX, unchanged, and the `StageKind` reconciliation which retypes rather than adds). The INDEX "14 / 21 rows" was the pre-sweep feature-doc aggregate; this is the post-cohesion-pass schema-truth count. The cohesion pass updates the INDEX delta-table headline to reflect the sweep (that edit lands in INDEX, not here — this doc does not edit 04 or INDEX).

---

## §17. Cross-reference index

| This doc | Reconciles | Cited by feature docs |
|---|---|---|
| §6 TicketEvent | `04 §1`/§4, B-O6, B-22 | 18, 20, 22, 24 |
| §7 AgentSession | `04 §2` (3 defs merged), `01 §4`, `07 §A` | 05, 14, 19, 24 |
| §8 WorkspaceSuggestion | `types.ts:101`, DATAMODEL §7 | 03, 11 |
| §9 SpendRecord/WorkspaceBudget | `types.ts:129`/`:225`, D81/D82 | 05, 19 |
| §10 Notification/PushSubscription | `types.ts:119`, D80 (reversed) | 17, 18 |
| §11 rules + WorkspaceRole | `04 §4`, `types.ts:236`, D76/D77 | 16, 22, all (tenant) |
| §12 StageKind | `types.ts:14`/`:300`, D1, `Board.tsx` | 02, 03, 12 |
| §13 field sweep | D1/D9/D21/D25/D31/D55/D86, `Q-DATA-ASSIGNMENT` | 01, 02, 04, 05, 13, 19, 22, 23 |
| §14 carryOver/Handoff | `04 §2`, B-O2, D27, `02 §4` | 05, 07, 20 |

**Self-check:** No new verbs introduced. No write verb granted to any LLM session. Every "write" is a `[control-API]` Conductor action (B-23). `StageEffort`/`StageModelTier` left provider-specific with a forward-pointer (no premature `providerKey`). `periodWindow` shipped per D82 (multi-cap is v1) without pre-shaping the parked multi-provider abstraction. This doc edits neither `04_DATA_MODEL.md` nor `features/INDEX.md`.

---

## §18. All-in-one models (DEFERRED — design-only for V1, not migrated until each lane opens)

The all-in-one review round ([`REVIEW_AND_OPEN_QUESTIONS_2_ALLINONE.md`], `Q-TRUST-AUTONOMY`/`Q-FORGE-*`/`Q-MR-*`/`Q-CI-*`) surfaced 12 model/field shapes for the future built-in mode (own repo + MR + CI + auto-merge). **The locked V1 scope ([`V1_SCOPE.md`] §4) overrides that round** — V1 is GitLab-only, push-on-approval → GitLab create-MR-URL, no built-in MR/CI/auto-merge. These shapes are recorded here so they are pinned, NOT so they are built. → all rows below tagged **DEFERRED — V1: OUT (see `V1_SCOPE` §4)**.

> **Lane B MUST NOT author Prisma tables for ANY model in this section in V1.** Every shape here is a **design record only** — it lands in the schema the *day its lane opens* (built-in forge mode, built-in MR, built-in CI, the auto-merge end of the autonomy dial), never before. The owning doc carries the build-grade body; this section is the deferral ledger that keeps §6–§17's V1 schema honest by listing what is deliberately ABSENT. Nothing here is in the V1 migration. Do not fold any of these into `types.ts` (§15) in V1.

| # | Model / field | One-line shape | Owning doc | Tag |
|---|---|---|---|---|
| 1 | `MergeRequest` | the built-in MR row (`number`/`state`/`source`+`targetBranch`/`base`+`headCommit`/`mergeStrategy`/`externalRef?`) — authoritative only in `forgeMode='builtin'`; external mode is a projection | [BUILTIN_MR_REVIEW] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |
| 2 | `ReviewThread` | a diff-anchored (or MR-level) review conversation (`filePath?`/`line?`/`side?`/`anchorCommit`/`status open\|resolved`) | [BUILTIN_MR_REVIEW] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |
| 3 | `ReviewComment` | a single APPEND-ONLY comment inside a thread (`threadId`/`authorId`/`body`); AI never authors one | [BUILTIN_MR_REVIEW] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |
| 4 | `Approval` | an approval cast against a specific `headCommit`; stale-on-new-head (`stale Boolean`, never deleted, §11a-style) | [BUILTIN_MR_REVIEW] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |
| 5 | `ForgeConnection` | the generalized per-workspace forge row (`mode`/`baseUrl?`/`repoPath?`/`tokenEnc?`/`webhookSecret?`/`ciRunner?`/`builtinRepoRef?`/`status`); one per workspace, generalizes the live GitLab columns | [FORGE_ABSTRACTION] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** — only `GitLabForge` is built; the row stays design-only (GitLab columns serve V1) |
| 6 | `Workspace.forgeMode` | `String @default("gitlab")` — `'gitlab' \| 'github' \| 'builtin'`; in V1 only `'gitlab'` is a live value | [FORGE_ABSTRACTION] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** — field shape design-only; V1 behaves exactly as if `'gitlab'` were hard-coded |
| 7 | `Pipeline` | the per-project CI DEFINITION derived from `.workspaces/ci.yml` (`specHash`/`stages[]`/`runnerKind`/`enabled`); one active per project | [BUILTIN_CI_PIPELINES] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |
| 8 | `PipelineRun` | one execution at a frozen `commitHash` (`trigger`/`status`/`mergeRequestId?`/`artifacts?`); links a run to its MR check-list | [BUILTIN_CI_PIPELINES] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |
| 9 | `PipelineJob` | one job in a run (`name`/`stage`/`needs[]` DAG/`imageRef`/`status`/`containerId?`/`exitCode?`); container exec for the builtin-container runner | [BUILTIN_CI_PIPELINES] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |
| 10 | `AuditEntry` | the append-only trust ledger (`seq` monotonic/`actorId?`/`actorKind`/`action`/`target`/`detail?`/`signalSeq?`/`controlReqId?`); decision-bearing `[control-API]` ops only | [TRUST_SAFETY_UX] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |
| 11 | `Workspace.autonomyLevel` | `String @default("gate-key-stages")` — `'gate-every-stage' \| 'gate-key-stages' \| 'full-auto' \| 'full-auto-merge'`; the `'full-auto-merge'` value is itself the deferred auto-merge end of the dial | [TRUST_SAFETY_UX] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** — the autonomy DIAL is design-only in V1; the `'full-auto-merge'` value is doubly-deferred (depends on the deferred built-in MR/merge, #1) |
| 12 | `Ticket.autonomyOverride` | `String?` (same enum; null ⇒ inherit `Workspace.autonomyLevel`) — tightens (never loosens) one ticket's level | [TRUST_SAFETY_UX] | **DEFERRED — V1: OUT (see `V1_SCOPE` §4)** |

**Why these are listed here and NOT in §6–§17:** §6–§17 are the *V1 schema truth* — every row there is migrated in V1. This §18 is the deliberate-absence ledger: the all-in-one round designed a built-in forge/MR/CI/auto-merge surface, the locked scope deferred it whole ([`V1_SCOPE`] §4, §6), and pinning the shapes here keeps a future lane from re-deriving them while keeping them out of the V1 migration and out of the §16 recomputed delta count. The §16 totals (and the INDEX delta) count ONLY §6–§17 V1 persistence; nothing in §18 is in either count.

**No new verbs.** Every deferred surface above is, when its lane opens, driven by `[control-API]` Conductor actions (B-23) — no LLM verb is added by recording these. This section adds nothing to the V1 schema and edits neither `04_DATA_MODEL.md` nor `features/INDEX.md`.
