# 03 — Automation & pluggability

> Triggers + cron, doc-refresh, the stage-type plugin model, integrations, and the proof that new features need zero core changes. Prereq: [01](./01_ARCHITECTURE.md), [02](./02_PROTOCOL_AND_FLOW.md).

---

## 1. The trigger / event engine

### 1.1 Three planes (don't conflate them)
| Plane | What | Direction | Status today |
|---|---|---|---|
| **Inbound hooks** | Claude lifecycle signals (`SessionStart`/`Stop`/`PostToolUse`/`Notification`) POSTing to the orchestrator | agent → orchestrator | exists: `PipelineStageCfg.hooks: Record<string,boolean>` (the `HOOK_CATALOG` toggles) |
| **Events** | normalized facts the orchestrator derives from hooks + cron + user actions | internal bus | **new** |
| **Triggers** | `when (event) → run (action)` rules | config → action | **new** |

Inbound hooks are the **raw source**; the orchestrator normalizes them into **events**; **triggers** match events to **actions**. So the Pipeline "Hooks" tab is unchanged (it decides *which raw signals fire*); a new **Automation** surface decides *what to do with them*.

### 1.2 The unified `WorkspaceTrigger` shape (one model for stage-lifecycle AND cron)
```ts
type TriggerEventKind =
  | 'stage.on_enter' | 'stage.on_complete' | 'stage.on_signal' | 'stage.on_approval'
  | 'ticket.created' | 'ticket.merged' | 'suggestion.accepted'
  | 'cron';
type TriggerActionKind =
  | 'start-stage' | 'invoke-workspace-ai' | 'run-command' | 'emit-signal' | 'notify';

interface WorkspaceTrigger {
  id; workspaceId; enabled; name;
  on: TriggerEventKind;
  match: { stageIds?: string[]; statusKeys?: string[]; projectIds?: string[] };  // empty = any
  cron?: string;                       // required iff on==='cron' (5-field crontab)
  action: TriggerActionKind;
  params: {
    targetStageId?: string | 'next';   // start-stage
    template?: string;                 // invoke-workspace-ai / message — mustache over carry-over + trigger ctx
    command?: string;                  // run-command: an ALLOW-LISTED key, not raw shell
    notifyType?: 'needs-input'|'merge'|'ai-suggestion'|'container-failure';
  };
  requiresApproval: boolean;           // true → emit a Suggestion instead of executing (B-23 governance)
  dedupeKey?: string; debounceMs?: number; lastFiredAt?: string;
}
```
`template` reuses the existing `CARRY_VARS` (`{{summary}} {{changedFiles}} {{openQuestions}} {{commitHash}}`) plus trigger context (`{{ticketId}} {{stageName}} {{statusKey}} {{reason}}`). So *"on-complete → ping the Workspace-AI with message X"* is literally `{ on:'stage.on_complete', action:'invoke-workspace-ai', params.template:'Ticket {{ticketId}} finished {{stageName}}: {{summary}}' }`.

### 1.3 Storage & authoring
- Prisma `WorkspaceTrigger` (`@@index([workspaceId, on, enabled])`). Cron triggers also get a Redis materialized view (a sorted-set keyed by next-fire epoch) so the tick is O(due).
- **Two editing surfaces, one table:** stage-lifecycle triggers (`on` starts `stage.`) are authored in a new **"Automation" sub-tab inside the Pipeline editor** (auto-scoped to the selected stage); cron + workspace-lifecycle triggers on a new **workspace-level Automation screen**. The split is where you author, not two models.

### 1.4 Firing — the minimal scheduler (what to build)
The framework ships **no scheduler** (deliberate; `acquireLease`/`renewLease`/`releaseLease` Redis primitives + `registerCustomRoute`/`registerSocketMiddleware` exist). Build the minimal one:
```
Event-driven (stage.*/ticket.*/suggestion.*):
  Claude hook ──POST──▶ registerCustomRoute('/hooks/:kind', {phase:'pre-params'})  (token-gated, origin-exempt)
      └─ normalizeToEvent() ─▶ emitEvent()  [in-process EventEmitter — NOT socket.io, must run with no browser]
            └─ TriggerMatcher (load WorkspaceTrigger where on=kind & match⊇event) ─▶ ActionExecutor

Cron:
  one setInterval(30s) tick, guarded by acquireLease('ws-cron-tick', 60_000) + renew  (single-leader, multi-instance-safe)
      └─ ZRANGEBYSCORE cron-set WHERE nextFire ≤ now ─▶ emitEvent({kind:'cron', triggerId}) + reschedule
```
~80 lines, no BullMQ for v1. BullMQ is a drop-in behind `ActionExecutor` if you later want retry/visibility for *actions*. Event delivery is in-process (not sockets) precisely so automation runs while the user is offline; results broadcast to the UI via the Redis socket adapter.

### 1.5 ActionExecutor + governance
```
ActionExecutor(trigger, event):
  if trigger.requiresApproval:
     → WorkspaceSuggestion{ type:'automation', body: rendered template, action: trigger };  STOP.
       (user Accept → re-enters as a 'suggestion.accepted' event → runs)
  else switch trigger.action:
     'start-stage'         → Conductor.promoteTicket(ticketId, targetStageId)   // spawns next agent
     'invoke-workspace-ai' → spawnReasoner(render(template, ctx))   // one-shot ephemeral LLM (the only non-Assistant LLM; optional)
     'run-command'         → OrchestratorCommandRegistry.run(command)           // ALLOW-LISTED only
     'emit-signal'         → WorkspaceSignal.create(...)
     'notify'              → Notification.create(...)
```
`run-command` is **never raw shell** — it maps a key to a registered command (e.g. `ai:refresh-docs`), so a config-authored trigger can't be an RCE. This is the hybrid the spec wants: CPU-bound glue is business logic; only `invoke-workspace-ai` spends an LLM turn.

### 1.6 Relation to the existing Hooks tab
The Hooks tab (`hooks: Record<string,boolean>`) stays as-is — it's the **upstream enabler** (`stage.on_complete` is meaningless if the `Stop` hook is off). The Automation surface *layers on top* and can show "requires the `Stop` hook (currently on/off)" as a dependency hint.

---

## 2. "Refresh generated docs" — one path, four entry points

The three scripts (`npm run ai:index`, `ai:capabilities`, `ai:project-index`) are wired through **one** registered command:
`OrchestratorCommandRegistry.register('ai:refresh-docs', { run: () => exec the three scripts, cwd: repo/worktree })`. After running, the orchestrator re-indexes the regenerated `docs/AI_*.md` into the RAG store for the affected commit (matching the delta-indexer path).

Entry points: **(a) cron** `{ on:'cron', cron:'0 3 * * *', action:'run-command', command:'ai:refresh-docs' }`; **(b) on-complete** `{ on:'stage.on_complete', match.stageIds:['final'], … }`; **(c) chat** — the `refresh_docs` verb (the user's Assistant in chat, or the Coordinator in the background) calls the **same** registered command; **(d) maintenance suggestion** — staleness surfaces as a `maintenance` `WorkspaceSuggestion` the user accepts. The AI never guesses *when*: a trigger fires it, or the user asks.

---

## 3. Stage-type / AgentRole plugin model

### 3.1 The role is the unit of pluggability
Add ONE field to the existing `PipelineStageCfg`:
```ts
interface PipelineStageCfg { id; roleKey: string; /* …all existing fields unchanged… */ }
```
`roleKey` defaults to `'code'`, so every existing stage is unchanged (`STAGE_CONFIGS` all become `roleKey:'code'`). The role supplies **defaults + contracts**; per-stage config still overrides them.

### 3.2 The `AgentRole` definition
```ts
interface AgentRole {
  key; label; description;
  systemPromptTemplate: string;        // → the session's appended system prompt (mustache)
  needsWorkspace: boolean;             // true → container+worktree (code); false → lightweight reasoning session (refine/plan)
  defaultSkillKeys: string[];          // merged with, overridable by, per-stage cfg
  defaultSourceIds: string[];
  defaultCommands: StageCommandCfg[];
  defaultModelCfg: StageModelCfg;
  outputSchema: JsonSchema;            // base carry-over {summary,changedFiles,openQuestions,commitHash}; a role MAY add fields
  artifactKind: string;               // 'file-diff' | 'design' | 'report' | …
  ingest: (raw, ctx) => Promise<TicketArtifact[]>;   // how its output becomes ticket artifacts
  viewerComponent?: string;            // client viewer key; falls back to FileDiffViewer
  acceptFlow?: 'diff-review' | 'artifact-review' | string;
}
```
`needsWorkspace` is the concrete realization of the "containers only for code stages" decision.

### 3.3 Registration surface (same DI pattern as the framework's `registerPrismaClient`/`registerSocketMiddleware`)
```ts
registerAgentRole(codeRole);     // built-in
registerAgentRole(designRole);   // future — no core change
registerArtifactViewer('design', lazy(() => import('./DesignViewer')));   // client
registerOrchestratorCommand('ai:refresh-docs', { run });                  // allow-listed commands
```
The Pipeline General tab gains a **Role dropdown** (`listAgentRoles()`); picking a role pre-fills the stage's skills/sources/commands/model. `TicketDetail` renders an artifact via its `artifactKind` viewer, falling back to the existing `FileDiffViewer`.

### 3.4 The MCP/structured-channel surface is the stable waist
Adding a role adds **no verbs**. A design agent still calls `emit_carryover`/`emit_output` — its payload just matches the design `outputSchema`. The verb surface (02 §2) is the one thing held stable; roles + schemas are the variable parts.

---

## 4. Workspace-AI as a pipeline-authoring assistant

Same reasoning sessions (the user's **Assistant** when asked in chat; an optional one-shot reasoner in the background), same verbs, one extra read capability: `read_pipeline` → returns `PipelineStageCfg[]` + the role/skill/doc catalogs. It emits a `config-review` `WorkspaceSuggestion` whose body carries an **appliable patch**:
```ts
WorkspaceSuggestion {
  type: 'config-review',
  title: 'Plan loads RAG but Refined does not — likely swapped',
  body:  '…explanation…',
  patch: [{ stageId:'refined', op:'add', field:'skillKeys', value:'rag' },
          { stageId:'plan',    op:'remove', field:'skillKeys', value:'rag' }]
}
```
**Accept** applies the patch to `PipelineStageCfg` (RBAC-gated: a Member cannot accept). The existing **"Validate with AI"** button becomes: invoke the user's Assistant with `read_pipeline` → it returns `StageWarning[]` (the type already exists) + optional `config-review` suggestions. No new subsystem — a reasoning session + a read verb + the existing suggestion surface.

---

## 5. Integrations — goal-defined, mechanism-open

**Goal (the contract):** *let a stage-agent use a configured third-party tool — e.g. query the workspace database to see real data.* Already modeled in the UI: workspace **Env vars** + **Integration tools** mapped to those env vars + a per-stage **select** with a `ro`/`rw` **tier** (spec **B-O8**: `mongo:ro|rw`, `redis:ro|rw`, extensible). **Deliberately open** (and what's "incomplete" today — it's a UI model only; the per-tool server files don't exist): **how** the agent reaches the tool.

| Mechanism | What | When |
|---|---|---|
| **whitelisted CLI client in the container** (rec. v1) | `mysql`/`mongosh`/`redis-cli` or a tiny `ws-db query …` wrapper, allow-listed in `permissions.allow`, creds from env at the tier; agent "sees data" via Bash | default — simplest, stack/OS-agnostic, ~nothing to build per tool |
| **MCP server per tool** | typed `query`/`schema` tools | richer ergonomics, but it's the per-tool JS server we have NOT built and may not need for v1 |
| **context-doc / RAG skill** | schema/data summaries as a loaded doc | simple reads |

The credential **tier** + egress allow-list apply regardless of mechanism. Real credential wiring (decrypt per request, scoped/short-lived tokens) lands in the orchestrator phase. **Decide per integration**; don't hard-commit the whole product to MCP.

---

## 6. Scalability — stable code vs per-workspace data

| Stable (code; ships with the orchestrator) | Per-workspace (data; Prisma/Redis) |
|---|---|
| the structured-channel **verb surface** | `WorkspaceTrigger[]` rows |
| **AgentRoleRegistry** (installed roles) | `PipelineStageCfg[]` (which role per stage + overrides) |
| `TriggerEventKind`/`TriggerActionKind` enums | `IntegrationTool[]`, `EnvVar[]`, `permRoles` |
| **ArtifactViewerRegistry** | RAG slices, carry-over, statuses, network rules |
| **OrchestratorCommandRegistry** | cron strings, templates |

**Adding workspaces = pure data.** **Adding capabilities = a registry registration** (`registerAgentRole`/`registerArtifactViewer`/`registerOrchestratorCommand`), never a migration to the trigger/role contract. The cron tick is single-leader (one lease), so it doesn't multiply with workspaces.

---

## 7. Walkthrough — adding a "Claude Design" stage (zero core changes)

Goal: a stage where Claude Code + design skills produce designs viewable in the workspace (spec `CLAUDE_DESIGN_FEATURE_COMPLETION.md`). Only **additions**:

1. **Register the role** (server boot, ~30 lines): `registerAgentRole({ key:'design', needsWorkspace:false?/true?, systemPromptTemplate:'You are a product designer… call emit_output when done', defaultSkillKeys:['design-system','component-catalog'], defaultCommands:[{pattern:'Write(designs/*)', mode:'allow'}], outputSchema: base + artifacts:[{kind:'svg'|'figma-json', uri, title}], artifactKind:'design', ingest, viewerComponent:'DesignViewer', acceptFlow:'artifact-review' })`.
2. **Ship the skill bundle**: `skills/custom/design-system/SKILL.md` etc. (framework skill discovery picks them up via `npm run ai:capabilities`). No code.
3. **Register the viewer** (client): `registerArtifactViewer('design', lazy(() => import('./DesignViewer')))`. `TicketDetail` already renders by `artifactKind`.
4. **User creates the stage** (data): `addStage()` (exists) → set the Role dropdown to "Claude Design"; defaults pre-fill. A `PipelineStageCfg` row with `roleKey:'design'`.
5. **Wire the flow** (data, optional): a trigger `{ on:'stage.on_approval', match.stageIds:['refined'], action:'start-stage', params.targetStageId:'<design>' }`.
6. **Carry-over to Implementation** (already works): the design stage's `emit_output` includes `artifacts`; the next stage's `promptTemplate` references `{{summary}}` and the orchestrator injects the artifact URIs (carry-over is artifact-kind-agnostic).

Nothing in the trigger engine, verb surface, scheduler, or governance changed. **Extensible by construction.**
