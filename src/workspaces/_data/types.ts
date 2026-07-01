//? Workspaces — UI data model.
//?
//? These types APPROXIMATE the authoritative Prisma schema (`prisma/schema.prisma`,
//? bodies in `_docs/04b_DATA_MODEL_ADDENDA.md` §6–§13). The port is NOT a 1:1
//? mechanical lift (MIGRATION §0): several prototype types are display projections
//? (`Sprint.start` is a string, `NotificationItem`/`AiSuggestion` are read-projections
//? of `Notification`/`WorkspaceSuggestion`, `WorkspaceBudget` was single-row, now
//? multi-cap) and ~8 model families were doc-only. This file has since been backfilled
//? (04b §15) to carry the canonical shapes alongside the UI-render ones. Where a field
//? is server-only (encrypted tokens, embeddings, raw payloads) it's omitted here — the
//? UI never sees it. Anything the screens render but the schema doesn't store yet
//? (derived/display helpers) is marked `// ui-only`.

export type Role = 'owner' | 'admin' | 'member';

//? Ticket lifecycle: STAGE = pipeline column, STATUS = state within that stage.
//? Strictly two levels (DATAMODEL DH5). `status` here is the StageStatus.key.
//? A stage's `id` is a FREE string (custom stages allowed); `StageKind` is the
//? typed SEMANTIC role the stage plays, which a preset instantiates (04b §12).
//? 'unrefined'+'refined' both map to the 'refine' role; 'impl' → 'code'.
export type StageKind = 'refine' | 'plan' | 'code' | 'test' | 'review' | 'final';
export type TicketStatus = 'idle' | 'needs-input' | 'busy' | 'done' | 'paused' | 'stuck';

export interface Member {
  id: string;
  name: string;
  email: string;
  avatar?: string;        // uploaded image filename / url (User.avatar)
  avatarFallback: string; // colour for the initials fallback (User.avatarFallback)
  role: Role;             // WorkspaceMember.role
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role: Role; // ui-only: the current user's role in this workspace
  // --- field sweep (04b §13) ---
  timezone?: string;              // D55 — IANA tz; anchors cron + budget window + sprint dates
  presetKey?: string;             // D1/D18 — 'simple' | 'advanced' | 'professional' (provenance)
  pricing?: unknown;              // D31 — per-model price map (Json in schema)
  assistantTokenBudget?: number;  // per-user-Assistant context budget → self-handoff
  reasonerTokenBudget?: number;   // optional future one-shot reasoner budget
  handoffInstruction?: string;    // editable self-handoff instruction template
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  gitlabPath: string;
  // --- field sweep (04b §13) ---
  gitUrl?: string;                                         // the linked repo url (alongside gitlabPath)
  linkedFiles?: { path: string; role: 'generate' | 'link' }[]; // D9/D19 — GENERATE vs LINK
  generatedDocsPath?: string;                              // D21 — where GENERATE'd docs are committed
  baseImageRef?: string;                                   // Q-CT-IMAGESEL — L2 per-project image selector
  dockerfilePath?: string;                                 // optional per-project Dockerfile
}

export interface PipelineStage {
  id: string;          // free stage id (e.g. 'impl'); custom stages allowed
  kind: StageKind;     // the typed semantic role (04b §12)
  name: string;
  order: number;
  aiEnabled: boolean;
  wipLimit?: number; // ui-only: column WIP warning threshold
  avgTokensPerTurn?: number; // doc 05 (D4/D28) — rolling per-stage average feeding the estimate blend
}

export interface Ticket {
  id: string;            // ui-only display id, mirrors Ticket.prefix e.g. "DEV-1240"
  workspaceId: string;
  projectId: string;
  title: string;
  description?: string;
  stageId: string;       // current pipeline column → PipelineStage.id (free string)
  status: TicketStatus;  // StageStatus.key within the stage
  labels: string[];      // GitLab-native, cached
  creatorId?: string;    // who created the ticket (shown first); falls back to viewers[0]
  assigneeId?: string;   // who picked it up (shown second); falls back to next viewer
  viewers: string[];     // ui-only: member ids currently viewing (presence)
  hasTerminal: boolean;  // ui-only: a live terminal is attached
  branch?: string;
  mr?: string;           // ui-only shorthand ("!91 · draft"); canonical column is `mrUrl`
  issue?: string;        // ui-only shorthand; canonical column is `issueUrl`
  mrUrl?: string;        // GitLab-derived cache — the MR url (canonical, 04b §13)
  issueUrl?: string;     // GitLab-derived cache — the issue url (canonical, 04b §13)
  archived?: boolean;    // doc 13 bulk Archive — soft, never deletes
  lastActivityAt?: string; // denormalized from the latest TicketEvent — default backlog sort key
  commitHash?: string;   // frozen worktree commit the ticket's context is pinned to (DH5)
  costLabel?: string;    // ui-only: "€1.18 · 12m" derived from SpendRecord
  sprintId?: string;
  carryOver?: string;
  needsInput?: string;
  files?: TicketFile[];
  links?: TicketLink[];
  history?: StageHistoryEntry[];
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  oldNo?: number;
  newNo?: number;
  text: string;
}

export interface TicketFile {
  path: string;
  add: number;
  del: number;
  diff?: DiffLine[]; // GitLab-MR-style inline diff for the preview
}

export interface TicketLink {
  id: string;            // related ticket id
  rel: 'relates to' | 'blocks' | 'duplicates';
  ai: boolean;           // AI-suggested
  reason?: string;       // why the AI proposed the link (shown on the ? hover)
}

export interface StageHistoryEntry {
  stage: string;
  summary: string;
  done: boolean;
}

//? The read-projection of `WorkspaceSuggestion` (04b §8). Canonical model shape is
//? `WorkspaceSuggestion` below; this is what the panel renders. 5-value `type` incl.
//? 'automation' (proposes a WorkspaceTrigger).
export interface AiSuggestion {
  id: string;
  type: 'link-tickets' | 'create-epic' | 'config-review' | 'maintenance' | 'automation';
  title: string;
  body: string;
  ticketIds: string[];
  patch?: unknown; // appliable config/automation patch { path, before, after } (config-review/automation only)
}

//? The canonical Assistant propose-only output (04b §8, B-23). `AiSuggestion` above
//? is the read-projection screens render; this mirrors the persisted model.
export interface WorkspaceSuggestion {
  id: string;
  workspaceId: string;
  type: 'link-tickets' | 'create-epic' | 'config-review' | 'maintenance' | 'automation';
  title: string;
  body: string;
  ticketIds: string[];
  patch?: unknown; // appliable config patch — applied ONLY on accept → Conductor executes
  status: 'open' | 'accepted' | 'dismissed';
  createdAt?: string;
}

export interface Sprint {
  id: string;
  name: string;
  start: string | null;  // ui-only: display date "May 27"
  end: string | null;    // ui-only: display date
  startAt?: string;      // real column (04b §13) — workspace-tz DateTime (ISO), replaces display `start`
  endAt?: string;        // real column — replaces display `end`
  active: boolean;
  ticketCount: number;   // ui-only: derived count
  daysLeft: number | null; // ui-only: derived from endAt
}

//? The read-projection of `Notification` (04b §10). `deepLink` = the D65 navigate payload.
export interface NotificationItem {
  id: string;
  type: 'needs-input' | 'merge' | 'ai-suggestion' | 'container-failure';
  title: string;
  body: string;
  ticketId?: string;
  deepLink?: { view: string; ticketId?: string; tab?: string; terminalId?: string }; // D65 navigate payload
  time: string;
  read: boolean;
}

//? Web-push registration (04b §10). FRAMEWORK-GLOBAL (a user's device, not a
//? workspace's). `keys` (Web Push encryption keys) are server-only and omitted here.
//? Redacted-push posture: `fullBodyOptIn` gates whether the push may carry the full
//? Notification.body (D80 REVERSED).
export interface PushSubscription {
  id: string;
  userId: string;
  endpoint: string;
  fullBodyOptIn: boolean; // push is REDACTED by default; full-body opt-in per device
  createdAt?: string;
  lastUsedAt?: string;
}

//? Multi-cap budget (04b §9, D81/D82): MULTIPLE rows per workspace — the screen renders
//? a caps LIST, not one bar. The canonical shape adds `id`/`label`/`enforcement`/
//? `periodWindow`/`windowStartAt`/`enabled`. NOTE (hard-constraint kept-both): the
//? prototype's single-row fields (`cap`/`alertPct`/`spent`/`currency`) are KEPT so
//? `seed.ts`'s single `BUDGET` const still type-checks; the multi-cap fields are added
//? OPTIONAL alongside them rather than replacing (a real reshape would drop `currency`).
export interface WorkspaceBudget {
  spent: number;
  cap: number;
  alertPct: number;
  currency: string;        // ui-only: single-row prototype display (superseded by multi-cap)
  // --- multi-cap (04b §9) ---
  id?: string;
  label?: string;                              // the cap's display name in the caps-list editor
  enforcement?: 'pauseNew' | 'pauseAll';       // pauseNew blocks new sessions | pauseAll pauses all now
  periodWindow?: 'calendar-month' | { rolling: string }; // D82 — default calendar-month (workspace tz)
  windowStartAt?: string;                      // start of the current period window (ISO)
  enabled?: boolean;
}

//? The UI render-view of the event log (kept — screens read this shape).
export interface ActivityEvent {
  time: string;
  actor: string; // member id | 'ai' | 'mr'
  ticketId: string;
  type: 'command' | 'file-change' | 'ai-message' | 'status-change' | 'mr' | 'comment';
  text: string;
}

//? The canonical append-only, per-ticket, ordered event log (04b §6). `seq` is
//? MONOTONIC per ticket (Redis INCR) and is the client merge/dedupe key (NOT createdAt —
//? clock skew). The ONLY writer is the Conductor (B-23). `ActivityEvent` above is the
//? UI render-view; this mirrors the persisted model.
export interface TicketEvent {
  id: string;
  workspaceId: string;
  ticketId: string;
  seq: number;           // MONOTONIC per ticket; the merge/dedupe key
  type: 'command' | 'file-change' | 'ai-message' | 'status-change' | 'mr' | 'comment';
  actor: string;         // member userId | 'ai' | 'conductor' | 'mr' | 'gitlab'
  sessionKey?: string;   // provenance of an AI-sourced event
  stageId?: string;      // the StageKind key the event occurred in, if stage-scoped
  text: string;
  metadata?: unknown;    // { commitHash?, changedFiles?[], mrUrl?, diffRef?, voiceTranscript?, ... }
  createdAt?: string;
}

//? A single rendered terminal line. `tone` maps to a terminal-ansi token.
export type TerminalTone = 'text' | 'muted' | 'green' | 'blue' | 'amber' | 'red' | 'cyan';
export interface TerminalLine {
  tone: TerminalTone;
  prefix?: string; // e.g. "claude>", "$", "▲ vite"
  text: string;
  cursor?: boolean;
  wait?: boolean; // awaiting user input
}

//? One running process inside a ticket's container (claude / server / client …).
//? A stage can start several (configurable via the pipeline's processStartConfig).
export interface TerminalProcess {
  name: string;        // 'claude' | 'server' | 'client'
  status: TicketStatus;
  cwd: string;
  exit: string;
  lines: TerminalLine[];
}

export interface Terminal {
  ticketId: string;
  stage: string;
  processes: TerminalProcess[];
}

//? The ONE canonical runtime row (04b §7) — the orchestrator's durable runtime fact
//? (the UI `Terminal`/`TerminalProcess` above are the render-view, not the row).
//? NOTE: this 4-state `status` (ready|busy|paused|stopped) is DISTINCT from
//? `TicketStatus` (the AI-owned ticket lifecycle) and `StageStatusCfg` — three
//? separate state machines (Q-DATA-STATUS). No LLM verb mutates this row.
export interface AgentSession {
  id: string;
  workspaceId: string;
  ticketId?: string;                 // null for assistant sessions not bound to a ticket
  stageId?: string;                  // the StageKind key; worker sessions only
  kind: 'assistant' | 'worker' | 'reasoner'; // 'reasoner' is an optional future one-shot role
  userId?: string;                   // ASSISTANT sessions only: whose chat → drives RBAC scope
  sessionKey: string;                // assistant:{userId} | worker:{ticketId}:{stageId} | reasoner:{...}
  claudeSessionId?: string;          // for `claude --resume`; RE-CAPTURED if /clear rotates it
  model?: string;                    // resolved model literal at spawn (haiku|sonnet|opus)
  cliVersion?: string;               // EXACT pinned Claude CLI version that ran this session
  baseImageRef?: string;             // resolved L2 image tag (content-hash) this session ran in
  containerId?: string;              // L3 per-ticket container id; null for host-side roles
  worktreePath?: string;             // the in-container clone path
  ptyAgentUrl?: string;              // 127.0.0.1:<port> the in-container pty-agent publishes
  status: 'ready' | 'busy' | 'paused' | 'stopped'; // the SINGLE runtime state machine
  tokenEstimate: number;             // running estimate for self-handoff / budget trigger; ADVISORY
  durationEstimate?: number;         // seconds; cold-start self-estimate; nullable until a planning stage runs
  channelTokenId?: string;           // id (NOT secret) of the per-session structured-channel token
  hookTokenId?: string;              // id of the SEPARATE per-session WS_HOOK_TOKEN
  startedAt?: string;
  lastHeartbeatAt?: string;
}

//? Sources — context docs (loaded as files) + skills/MCP (queried on demand).
//? Mirrors InfoSource in DATAMODEL (mode 'context-doc' | 'skill').
export interface InfoDoc {
  id: string;
  name: string;
  source: 'generated' | 'git' | 'uploaded';
  updated: string;
  note: string;              // "frozen @ abc123" | "spec"
  summary: string;           // one-liner of what the file/skill contains
  pendingBranches?: string[]; // branches whose changes aren't in this file yet
  usedByStages?: string[];   // stage names that load this doc
  content: string;           // markdown/text shown in the read-only preview
}

export interface SkillEntry {
  id: string;
  name: string;
  kind: 'frozen' | 'live';
  status: string;
  model?: string;
  on: boolean;
  description?: string;      // what it does (Details)
  usedByStages?: string[];   // stages that enable this skill
  lastIndexed?: string;
}

//? Account: SSH keys (B-05). For the dummy login the `value` (public-key text)
//? decides identity: '123' → test, '456' → mathijs.
export interface SshKeyEntry {
  id: string;
  name: string;
  type: string;        // 'ed25519' | 'rsa'
  fingerprint: string;
  added: string;
  lastUsed: string;
  userId: string;      // which member this key authenticates as
}

export interface SessionEntry {
  id: string;
  device: string;
  location: string;
  lastActive: string;
  current: boolean;
}

export interface InviteEntry {
  id: string;
  email: string;
  role: Role;
  sent: string;
}

//? The rendered spend aggregate (UI). `SpendRecord` below is the per-turn fact.
export interface UsageRow {
  ticketId: string;
  tokensIn: string;
  tokensOut: string;
  cost: number;
  time: string;
}

//? The append-only per-turn cost fact (04b §9). Tokens are ADVISORY in PTY mode.
//? `UsageRow` above is the rendered aggregate; this mirrors the persisted model.
export interface SpendRecord {
  id: string;
  workspaceId: string;
  ticketId?: string;
  stageId?: string;      // StageKind key
  sessionKey: string;    // the AgentSession this turn belongs to
  tokensIn: number;      // ADVISORY
  tokensOut: number;
  model: string;         // resolved model literal (pricing key)
  costEstimate: number;  // tokens × editable per-model price (D31); 0 when pricing zeroed-out
  createdAt?: string;
}

//? Editable RBAC role: one boolean per RBAC_CAPABILITIES entry. `locked` is the
//? Owner row (always all-true, not editable). Persisted per workspace — held in
//? app context for the prototype so edits survive tab/route changes.
export interface PermRole {
  key: string;
  name: string;
  locked?: boolean;
  perms: boolean[];
}

//? The canonical custom RBAC role (04b §11e, D76). `PermRole` above approximates it;
//? this adds the persisted `key`/`label`/`builtIn`/`workspaceId`. `perms` is one boolean
//? per RBAC_CAPABILITIES entry (positional).
export interface WorkspaceRole {
  id: string;
  workspaceId: string;
  key: string;        // stable ref ('owner'|'admin'|'member' seeded; custom keys added)
  label: string;      // editable display name
  perms: boolean[];   // one boolean per RBAC_CAPABILITIES entry (positional)
  builtIn: boolean;   // seeded built-ins (cannot be deleted; CAN be edited per D76)
}

//? Workspace-AI chat message (dummy, client-only for the prototype).
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  questionSetId?: string; // renders a QuestionSet card inline in the Assistant chat (ERRATA E4)
}

//? ---------------------------------------------------------------- carry-forward + questions

//? The structured stage→stage envelope (04 §2, 04b §14). `Ticket.carryOver` (string)
//? stays the human one-liner; this is the machine envelope.
export interface CarryOverEnvelope {
  summary: string;
  changedFiles: string[];
  openQuestions: string[];
  commitHash?: string;
}

//? Token-optimization self-handoff (04b §14). Superset of the CarryOver envelope
//? (carries it in `carried?` on a mid-stage self-handoff). WITHIN a session.
export interface Handoff {
  id?: string;
  workspaceId?: string;
  sessionKey: string;          // assistant:… | worker:ticket:stage
  ticketId?: string;
  stageId?: string;
  reason: 'budget' | 'manual';
  summary: string;
  decisions: string[];
  state?: unknown;
  next: string[];
  gotchas: string[];
  carried?: CarryOverEnvelope; // the stage envelope, when a self-handoff happens mid-stage
  createdAt?: string;
}

//? One question inside a QuestionSet (04 §2 / MIGRATION §6).
export interface Question {
  id: string;
  prompt: string;
  kind: 'choice' | 'approve' | 'free';
  options?: string[];  // choice variant
  answer?: string;
}

//? The phone-from-the-beach Q/A loop (04 §2, MIGRATION §6). A correction is a NEW
//? superseding set (D49, append-only). `sessionId` carries the claudeSessionId so an
//? answer `--resume`s the SAME session.
export interface QuestionSet {
  id: string;
  ticketId: string;
  sessionKey: string;
  stageId?: string;
  sessionId?: string;
  questions: Question[];
  status: 'open' | 'answered' | 'superseded';
  createdAt?: string;
}

//? ---------------------------------------------------------------- pipeline config
//? The rich per-stage configuration that maps to the genormaliseerd PipelineStage
//? model + its child collections (StageSkill / StageCommand / StageToolPermission
//? / StageSource / StageStatus / StageProcess) and the rendered claudeSettings
//? block (model/effort/max-turns/budget/hooks). See handoff/DATAMODEL.md §2 +
//? handoff/CLAUDE_SETTINGS_MAP.md. Editable locally in the prototype.

// provider-specific; a future capability registry replaces these (Q-MP-CAPREG).
export type StageModelTier = 'haiku' | 'sonnet' | 'opus';
// provider-specific; a future capability registry replaces these (Q-MP-CAPREG).
export type StageEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type CommandMode = 'allow' | 'ask' | 'deny';
export type ToolTier = 'ro' | 'rw';
export type NetworkMode = 'whitelist' | 'blacklist';

//? title/desc/category are set for custom commands (catalog commands get those
//? from COMMAND_CATALOG); they drive the ? info popover + grouping.
export interface StageCommandCfg { id: string; pattern: string; mode: CommandMode; title?: string; desc?: string; category?: string }
//? A stage selects a workspace-configured integration tool (by id) + a tier.
export interface StageToolCfg { toolId: string; tier: ToolTier }

//? ---- workspace-level integrations (configured once per workspace) ----
//? Env vars hold the actual secrets/config; an integration tool maps its config
//? fields to env vars + (optionally) exposes itself to the AI via an MCP server.
//? The pipeline then just SELECTS which tools a stage may use.
export interface EnvVar { id: string; key: string; value: string; secret: boolean }
export interface IntegrationField { id: string; label: string; placeholder?: string; envVarId: string | null }
export interface IntegrationTool {
  id: string;
  name: string;
  type: string;        // INTEGRATION_TYPES key, or custom
  fields: IntegrationField[];
  mcp: { enabled: boolean; command: string };
}
export interface StageStatusCfg { key: string; label: string; kind: 'base' | 'custom' }
export interface StageEnvVar { key: string; value: string }
//? A container process: where it runs (cwd), what env it gets, and the ordered
//? commands. Stack-agnostic (npm / dotnet / go / make / …).
export interface StageProcessCfg { id: string; name: string; cwd: string; env: StageEnvVar[]; commands: string[] }

//? Model selection: a base choice, plus optional auto-escalation by the task
//? complexity score (1–10) the agent assigns itself. Each rule = a switch case:
//? "score ≥ minScore → this model / effort / max-turns".
export interface StageModelChoice { model: StageModelTier; effort: StageEffort; maxTurns: number }
export interface ModelRule extends StageModelChoice { id: string; minScore: number }
export interface StageModelCfg { autoEscalate: boolean; base: StageModelChoice; rules: ModelRule[]; contextBudgetTokens?: number /* 04b §13 — per-stage token budget → self-handoff */ }

//? Network egress: allow-list (only these reachable) or block-list (everything
//? except these), built from category presets + explicit hosts/prefixes (*.x.com).
export interface StageNetworkCfg { enabled: boolean; mode: NetworkMode; categories: string[]; domains: string[] }

//? One pipeline stage (meta) + its full editable config, flattened for the UI.
//? `id` is a free string (not a fixed StageId) so custom stages can be added in
//? the editor; `kind` is the typed semantic role (04b §12).
export interface PipelineStageCfg {
  id: string;
  kind: StageKind;
  name: string;
  order: number;
  aiEnabled: boolean;
  customInstructions: string;
  promptTemplate: string;            // carry-over template with {{chips}}
  // --- field sweep (04b §13) / V1_SCOPE §3.2 ---
  systemPrompt?: string;             // D2/D17 — layered base prompt, distinct from customInstructions
  roleKey?: string;                  // 04 §3 — the AgentRole plugin binding
  userEditable?: boolean;            // edit-lock: may the user edit while this stage is active
  gateForApproval?: boolean;         // proceed-or-gate: gate for human approval before promoting
  // child collections
  skillKeys: string[];               // enabled SkillEntry ids
  sourceIds: string[];               // loaded InfoDoc ids (context docs)
  commands: StageCommandCfg[];
  tools: StageToolCfg[];
  statuses: StageStatusCfg[];
  processes: StageProcessCfg[];
  visibleStageIds: string[];
  modelCfg: StageModelCfg;
  network: StageNetworkCfg;
  hooks: Record<string, boolean>;    // which lifecycle hooks fire
  wipLimit?: number;
}

//? A non-blocking finding from "Validate with AI".
export interface StageWarning {
  stageId: string;
  severity: 'warn' | 'info';
  text: string;
}

//? ---------------------------------------------------------------- automation + signals

//? Durable signal transport (04b, B-O6). APPEND-ONLY. `seq` (monotonic) + `processedAt`
//? give the serial-consumption ordering.
export interface WorkspaceSignal {
  id: string;
  workspaceId: string;
  seq: number;           // MONOTONIC (serial consumption ordering)
  kind: string;          // the signal type
  payload: unknown;
  processedAt?: string;  // null until the consumer serially processes it
  createdAt?: string;
}

//? The event that fires a WorkspaceTrigger (schema `on`). Accepting an `automation`
//? suggestion materializes a trigger through [control-API] → the Conductor (B-23).
export type TriggerEventKind =
  | 'stage.on_enter'
  | 'stage.on_complete'
  | 'stage.on_signal'
  | 'stage.on_approval'
  | 'ticket.created'
  | 'ticket.merged'
  | 'suggestion.accepted'
  | 'cron';

//? What a trigger does when it fires (schema `action`).
export type TriggerActionKind =
  | 'start-stage'
  | 'invoke-workspace-ai'
  | 'run-command'
  | 'emit-signal'
  | 'notify';

//? Automation (04 §2, 03 §1). Materialized by the Conductor on accept (never the LLM).
export interface WorkspaceTrigger {
  id: string;
  workspaceId: string;
  enabled: boolean;
  name: string;
  on: TriggerEventKind;
  match: unknown;                    // { stageIds?[], statusKeys?[], projectIds?[] }
  cron?: string;                     // iff on === 'cron'
  action: TriggerActionKind;
  params: unknown;                   // { targetStageId?, template?, command?, notifyType? }
  requiresApproval: boolean;
  dedupeKey?: string;
  debounceMs?: number;
  lastFiredAt?: string;
}

//? The AgentRole plugin (03 §3) a stage binds to via `roleKey`. Minimal shape — the
//? docs name it but give no build-grade body. // inferred
export interface AgentRole {
  key: string;
  label: string;
  needsWorkspace?: boolean; // code roles run in a container; reasoning roles host-side
}

//? An artifact a stage produced, attached to a ticket. Minimal shape. // inferred
export interface TicketArtifact {
  id: string;
  ticketId: string;
  kind: string;   // e.g. 'diff' | 'file' | 'url'
  label?: string;
  ref?: string;
}

//? A preview deployment (DEFERRED surface — V1_SCOPE §4; type kept for UI shape only).
//? Minimal shape. // inferred
export interface PreviewDeployment {
  id: string;
  ticketId: string;
  url?: string;
  status: string;
}

//? Board filtering state (ui-only). Minimal shape. // inferred
export interface BoardFilter {
  assigneeId?: string;
  labels?: string[];
  sprintId?: string;
  query?: string;
}

//? Backlog/board sort selection (ui-only; `TicketSort.key:'updated'` = lastActivityAt).
//? Minimal shape. // inferred
export interface TicketSort {
  key: 'updated' | 'created' | 'title' | 'status';
  dir: 'asc' | 'desc';
}
