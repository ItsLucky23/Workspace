# 04 — Data model

> Prisma models (real repo) ↔ the prototype's `src/workspaces/_data/types.ts`. Source of truth = `handoff/DATAMODEL.md`; prototype types mirror it field-for-field "where it matters." This doc lists what's **present**, what's **new**, and what must be **extended** for the Workspace-AI. MongoDB provider (`@map("_id") @db.ObjectId`); tenant = `Workspace` (every tenant model carries `workspaceId`).

---

## 1. Already modeled (spec + prototype) — no change needed

| Concern | Prisma (`DATAMODEL.md`) | Prototype (`types.ts`) |
|---|---|---|
| Identity / access | `User`, `OAuthAccount`, `SshKey`, `Workspace`, `WorkspaceMember(Role)`, `Invite` | `Member`, `Workspace`, `SshKeyEntry`, `InviteEntry`, `Role`, `PermRole` |
| Project & pipeline | `Project`, `Pipeline`, `PipelineStage` + children (`StageSkill`/`StageCommand`/`StageToolPermission`/`StageSource`/`StageStatus`/`StageProcess`) + `claudeSettings Json` | `Project`, `PipelineStage`, `PipelineStageCfg` (+ `StageCommandCfg`/`StageToolCfg`/`StageStatusCfg`/`StageProcessCfg`/`StageModelCfg`/`StageNetworkCfg`) |
| Info layer | `InfoSource`, `RagEntry` | `InfoDoc`, `SkillEntry` |
| Tickets / board | `Ticket`, `TicketLink`, `TicketReference`, `Sprint` | `Ticket`, `TicketLink`, `TicketFile`, `StageHistoryEntry`, `Sprint` |
| Event log | `TicketEvent` (append-only, `seq` via Redis INCR) | `ActivityEvent` |
| Runtime | `AgentSession` | `Terminal`/`TerminalProcess`/`TerminalLine` (UI view) |
| Workspace-AI | `WorkspaceSignal`, `WorkspaceSuggestion`, `WorkspaceNote` | `AiSuggestion` (read-projection), `ChatMessage` |
| Spend / budget | `SpendRecord`, `WorkspaceBudget` | `UsageRow`, `WorkspaceBudget` |
| Notifications | `Notification`, `PushSubscription` | `NotificationItem` (read-projection) |

The prototype intentionally omits server-only fields (encrypted tokens, embeddings, raw payloads) and marks display helpers `// ui-only` (`Ticket.viewers/hasTerminal/costLabel`, etc.).

---

## 2. New models the Workspace-AI needs (add these)

### `AgentSession` (exists in `DATAMODEL.md`; the orchestrator's source of truth)
```prisma
model AgentSession {
  id String @id ...
  workspaceId String; ticketId String?; stageId String?
  kind        String   // 'assistant' | 'worker'   (+ optional future 'reasoner' for one-shot background jobs)
  userId      String?  // assistant sessions only: whose chat this is (drives that user's RBAC)
  containerId String?  ; ptyAgentUrl String?
  claudeSessionId String?   // for `claude --resume` after crash/suspend (NEW vs spec — add it)
  status      String   // starting|ready|busy|needs-input|done|stuck|killed|error
  model       String?
  tokenEstimate Int    @default(0)   // running estimate for the budget/self-handoff check (06)
  startedAt   DateTime @default(now()); lastHeartbeatAt DateTime?
  @@index([workspaceId, ticketId]) ; @@index([workspaceId, kind, userId])
}
```
**Why it's the truth:** socket sessions are ephemeral; the SessionManager rehydrates PTYs from these rows on boot (01 §4).

### `CarryOver` (NEW) — the structured stage→stage envelope (B-O2)
```prisma
model CarryOver {
  id String @id ...
  workspaceId String; ticketId String; fromStageId String; toStageId String; sessionId String
  envelope Json   // { summary, changedFiles[], openQuestions[], commitHash }
  createdAt DateTime @default(now())
  @@index([ticketId, createdAt])
}
```
`Ticket.carryOver` (prototype string) stays the **human one-liner**; this stores the machine envelope. Prototype: add a `CarryOverEnvelope` interface.

### `Handoff` (NEW) — token-optimization self-handoff (see [06](./06_TOKEN_OPTIMIZATION.md))
```prisma
model Handoff {
  id String @id ...
  workspaceId String; sessionKey String   // assistant:… | worker:ticket:stage  (| reasoner:… future)
  ticketId String?; stageId String?
  body Json   // { summary, decisions[], state, next[], gotchas[], carried? }  (superset of CarryOver)
  reason String   // 'budget' | 'manual'
  createdAt DateTime @default(now())
  @@index([sessionKey, createdAt])
}
```
Written when a long session crosses its context budget: the AI emits it (`emit_handoff` verb), the orchestrator stores it, then `/clear`s the session and reloads `body` as the fresh opening context. Generalizes `CarryOver` (stage→stage) to within-session. Prototype: add a `Handoff` interface.

### `QuestionSet` + `Question` (NEW) — the phone-from-the-beach loop (02 §5)
```prisma
model QuestionSet {
  id String @id ...
  workspaceId String; ticketId String; stageId String; sessionId String
  status String   // 'open' | 'answered' | 'superseded'
  questions Json  // Question[] = { id, text, kind:'free'|'choice'|'approve', choices?[], answer? }
  createdAt DateTime @default(now()); answeredAt DateTime?
  @@index([ticketId, status])
}
```
Prototype: add `QuestionSet`/`Question`; extend `ChatMessage` with `questionSetId?: string`. `Ticket.needsInput` (existing string) = denormalized banner = first open question.

### `WorkspaceTrigger` (NEW) — automation (03 §1)
```prisma
model WorkspaceTrigger {
  id String @id ...
  workspaceId String; enabled Boolean @default(true); name String
  on String           // stage.on_enter|on_complete|on_signal|on_approval | ticket.created|merged | suggestion.accepted | cron
  match Json          // { stageIds?[], statusKeys?[], projectIds?[] }
  cron String?        // iff on=='cron'
  action String       // start-stage|invoke-workspace-ai|run-command|emit-signal|notify
  params Json         // { targetStageId?, template?, command?, notifyType? }
  requiresApproval Boolean @default(false)
  dedupeKey String?; debounceMs Int?; lastFiredAt DateTime?
  @@index([workspaceId, on, enabled])
}
```
Prototype: add `WorkspaceTrigger` + the `TriggerEventKind`/`TriggerActionKind` unions.

### `Schedule` (optional/NEW) — if cron jobs aren't fully expressed as `WorkspaceTrigger(on:'cron')`
Use `WorkspaceTrigger(on:'cron')` as the single model; a separate `Schedule` is only needed if you want non-trigger jobs. Default: **don't** add it — fold cron into `WorkspaceTrigger`.

---

## 3. Fields to extend on existing models

| Model | Add | Why |
|---|---|---|
| `PipelineStage` / `PipelineStageCfg` | **`roleKey: string`** (default `'code'`) | the AgentRole plugin model (03 §3) |
| `PipelineStage` / `StageModelCfg` | **`contextBudgetTokens: Int?`** | per-stage token budget → self-handoff (06) |
| `Workspace` (or a settings model) | **`assistantTokenBudget` (+ optional `reasonerTokenBudget`), `handoffInstruction` (editable template)** | per-workspace-AI budget + the editable self-handoff instruction (06) |
| `WorkspaceSignal` | `seq Int` (monotonic), `processedAt` | serial consumption ordering (B-O6) |
| `WorkspaceSuggestion` | `patch Json?` | appliable config-review patches (03 §4); add `'automation'` to `type` |
| `AgentRole` *(registry, code not DB)* | — | roles are **registered in code**, not stored per-workspace (03 §6) |
| `Ticket` | (none new server-side) | `carryOver`/`needsInput` already present |

`StageModelCfg` already encodes the model-escalation rules (`autoEscalate`, `base`, `rules[minScore→model/effort/maxTurns]`) and maps to `--model`/`--max-turns` (B-38). `StageNetworkCfg` maps to `permissions.sandbox.network`. `StageCommandCfg` maps to `permissions.allow/ask/deny`. `StageToolCfg{toolId,tier}` + `EnvVar`/`IntegrationTool`/`IntegrationField` cover integrations (the tier → `mongo:ro|rw` keyed client, B-O8).

---

## 4. Append-only & tenant rules (carry into the real schema)

- **Append-only (never update/delete via app):** `TicketEvent`, `RagEntry`, `WorkspaceSignal`. Immutability app-enforced.
- **Tenant-scoped (carry `workspaceId`, go through `tenantDb` + the Redis key formatter):** everything except `User`/`OAuthAccount`/`SshKey`/sessions (framework-global). The orchestrator's AI sessions (Assistants/Stage-Agents, + an optional one-shot reasoner) + the Conductor run **outside** the `/api` lifecycle → they must call `runInTenant(workspaceId, …)` explicitly (open flag in `BESLISSINGEN.md` B-final).
- **Graded DB clients (B-O8):** `getPrismaClientFor('mongo:ro'|'mongo:rw'|'redis:ro'|'redis:rw')`; the stage's `StageToolCfg.tier` chooses; the credential lives in the integration mechanism (CLI client / MCP server), not in `.claude/settings.json`.

---

## 5. Prototype → real-repo migration notes

- The prototype holds state in `page.tsx` + context + `_data/seed.ts` (dummy). Each interface above maps to a Prisma model 1:1; moving over is mechanical.
- New prototype types to add now (types only, no behavior): `CarryOverEnvelope`, `Handoff`, `QuestionSet`/`Question`, `WorkspaceTrigger` (+ unions), `roleKey` + `contextBudgetTokens` on `PipelineStageCfg`/`StageModelCfg`, per-workspace AI-budget + `handoffInstruction` fields, `AgentRole`/`TicketArtifact` (for the plugin model). These can ship with the docs as the typed contract even before any backend exists.
