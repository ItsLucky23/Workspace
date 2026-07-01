//? Workspaces — UI data model.
//?
//? These types mirror `handoff/DATAMODEL.md` (the formal Prisma model for the
//? project) field-for-field where it matters, so that when we move to the real
//? repo + Prisma migration the dummy data maps over with minimal churn. Where a
//? field is server-only (encrypted tokens, embeddings, raw payloads) it's
//? omitted here — the UI never sees it. Anything the screens render but the
//? schema doesn't store yet (derived/display helpers) is marked `// ui-only`.

export type Role = 'owner' | 'admin' | 'member';

//? Ticket lifecycle: STAGE = pipeline column, STATUS = state within that stage.
//? Strictly two levels (DATAMODEL DH5). `status` here is the StageStatus.key.
export type StageId = 'unrefined' | 'refined' | 'plan' | 'impl' | 'test' | 'review' | 'final';
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
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  gitlabPath: string;
}

export interface PipelineStage {
  id: StageId;
  name: string;
  order: number;
  aiEnabled: boolean;
  wipLimit?: number; // ui-only: column WIP warning threshold
}

export interface Ticket {
  id: string;            // ui-only display id, mirrors Ticket.prefix e.g. "DEV-1240"
  workspaceId: string;
  projectId: string;
  title: string;
  description?: string;
  stageId: StageId;      // current pipeline column
  status: TicketStatus;  // StageStatus.key within the stage
  labels: string[];      // GitLab-native, cached
  creatorId?: string;    // who created the ticket (shown first); falls back to viewers[0]
  assigneeId?: string;   // who picked it up (shown second); falls back to next viewer
  viewers: string[];     // ui-only: member ids currently viewing (presence)
  hasTerminal: boolean;  // ui-only: a live terminal is attached
  branch?: string;
  mr?: string;
  issue?: string;
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

export interface AiSuggestion {
  id: string;
  type: 'link-tickets' | 'create-epic' | 'config-review' | 'maintenance';
  title: string;
  body: string;
  ticketIds: string[];
}

export interface Sprint {
  id: string;
  name: string;
  start: string | null;  // display date "May 27"
  end: string | null;
  active: boolean;
  ticketCount: number;
  daysLeft: number | null;
}

export interface NotificationItem {
  id: string;
  type: 'needs-input' | 'merge' | 'ai-suggestion' | 'container-failure';
  title: string;
  body: string;
  ticketId?: string;
  time: string;
  read: boolean;
}

export interface WorkspaceBudget {
  spent: number;
  cap: number;
  alertPct: number;
  currency: string;
}

//? Event log (TicketEvent in DATAMODEL — append-only, per-ticket, ordered).
export interface ActivityEvent {
  time: string;
  actor: string; // member id | 'ai' | 'mr'
  ticketId: string;
  type: 'command' | 'file-change' | 'ai-message' | 'status-change' | 'mr' | 'comment';
  text: string;
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

//? Usage / spend (SpendRecord aggregate in DATAMODEL).
export interface UsageRow {
  ticketId: string;
  tokensIn: string;
  tokensOut: string;
  cost: number;
  time: string;
}

//? Editable RBAC role: one boolean per RBAC_CAPABILITIES entry. `locked` is the
//? Owner row (always all-true, not editable). Persisted per workspace — held in
//? app context for the prototype so edits survive tab/route changes.
export interface PermRole {
  name: string;
  locked?: boolean;
  perms: boolean[];
}

//? Workspace-AI chat message (dummy, client-only for the prototype).
export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
}

//? ---------------------------------------------------------------- pipeline config
//? The rich per-stage configuration that maps to the genormaliseerd PipelineStage
//? model + its child collections (StageSkill / StageCommand / StageToolPermission
//? / StageSource / StageStatus / StageProcess) and the rendered claudeSettings
//? block (model/effort/max-turns/budget/hooks). See handoff/DATAMODEL.md §2 +
//? handoff/CLAUDE_SETTINGS_MAP.md. Editable locally in the prototype.

export type StageModelTier = 'haiku' | 'sonnet' | 'opus';
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
export interface StageModelCfg { autoEscalate: boolean; base: StageModelChoice; rules: ModelRule[] }

//? Network egress: allow-list (only these reachable) or block-list (everything
//? except these), built from category presets + explicit hosts/prefixes (*.x.com).
export interface StageNetworkCfg { enabled: boolean; mode: NetworkMode; categories: string[]; domains: string[] }

//? One pipeline stage (meta) + its full editable config, flattened for the UI.
//? `id` is a free string (not StageId) so custom stages can be added in the editor.
export interface PipelineStageCfg {
  id: string;
  name: string;
  order: number;
  aiEnabled: boolean;
  customInstructions: string;
  promptTemplate: string;            // carry-over template with {{chips}}
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
