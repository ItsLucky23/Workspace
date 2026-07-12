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

//? X1 — ChatProposal.op may be any catalog-enabled control-op (type-only import; erases at runtime).
import type { ControlOp } from '../_functions/controlApi';

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

//? The linked-repo status for the active workspace (register-flow step A). `linked`
//? reflects whether a bare clone exists under data/workspaces/<id>/; branch/head are
//? the current baseline pointer; `error` carries a (token-scrubbed) clone failure.
export interface RepoInfo {
  linked: boolean;
  gitUrl?: string;
  branch?: string;
  head?: string;
  error?: string;
}

//? ---------------------------------------------------------------- git workflow config
//? Per-workspace git strategy + push policy (hosting-proxy plan). CODE acts on every field
//? here (branch name + preview-host derivation, push behaviour) — the STRUCTURED half of git
//? customization; freeform "how to commit" guidance lives in skills/context-docs, not here.
//? Canonical logic + DEFAULT_GIT_CONFIG live in server/git/branchStrategy.ts.
export type BranchStrategyKind = 'ticket-prefix' | 'typed' | 'custom';
export type PushPolicy = 'local-only' | 'push' | 'merge-request';
export interface GitConfig {
  branchStrategy: BranchStrategyKind; // how a ticket maps to a branch name
  defaultBranchType: string;          // 'typed'/'custom' fallback type (feature/hotfix/…)
  branchTemplate: string;             // 'custom' template — {{type}} {{prefix}} {{key}} {{number}} {{slug}}
  pushPolicy: PushPolicy;             // how committed work leaves the container
  targetBranch: string;               // MR/push target, e.g. 'main'
  protectedBranches: string[];        // never commit directly to these
  commitSigning: boolean;             // git commit -S in the container
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
  gitConfig?: GitConfig;          // per-workspace git strategy + push policy (hosting-proxy plan)
  forgeType?: string;             // #10 'gitlab' | 'github' — which forge provider
  allowMergeOnRedCI?: boolean;    // ci-allow-red: let a human merge while CI is red
  enabledSections?: string[];     // module gating: gateable nav-section ids that are ON; [] ⇒ all shown (modules.ts)
  productContext?: string;        // Q2 — brand/product context folded into every creative generation
  aiInstruction?: string;         // Q4 — workspace-wide "how the AI works here", prepended to every AI completion
  outputLanguage?: string;        // K4 — preferred AI output language (empty = model default)
  geminiModel?: string;           // P2 — per-workspace Gemini model override (empty = env/default)
  geminiTemperature?: string;     // P2 — per-workspace Gemini temperature (empty = model default)
  geminiBaseUrl?: string;         // X4 — per-workspace custom Gemini base URL (empty = env/default)
  autonomyLevel?: string;         // A4 — 'gate-every' | 'gate-key-stages' | 'full-auto'
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

//? A build+deploy unit within a project (monorepo services) — ADR 0035.
export interface ServiceSummary {
  id: string;
  projectId: string;
  name: string;
  path: string;
}

//? K1/K3 — a provisioned third-party SERVICE STACK (docker-compose: Kafka/Postgres/…). Workspace-scoped.
//? The Services panel lists these; the compose itself is server-only (not shipped to the client).
export interface ServiceStackSummary {
  id: string;
  name: string;
  status: string;      // 'stopped' | 'running' | 'error'
  services: string[];  // the service names inside the stack
}

//? ADR 0043 — a user-app DATABASE connection (dev/staging/prod), for the DB panel.
//? The URL itself is server-only (encrypted); the client sees only the metadata.
export interface DbConnectionSummary {
  id: string;
  projectId: string;
  name: string;
  kind: string;      // 'postgres' | 'mysql' | 'mongo'
  envKind: string;   // 'dev' | 'staging' | 'prod'
}

//? ADR 0043 — a schema migration awaiting/after apply. The DB panel lists these + drives apply.
export interface MigrationSummary {
  id: string;
  projectId: string;
  name: string;
  envKind: string;
  status: string;    // 'pending' | 'applied' | 'failed'
  error?: string | null;
  createdAt: string;
}

//? The switcher-facing subset of a Project (ADR 0035 multi-project). The board /
//? pipeline / sources render the ACTIVE project's data; this drives the shell picker.
export interface ProjectSummary {
  id: string;
  name: string;
  gitUrl?: string;
  baseImageRef?: string;   // #45 — the built/selected image tag, so a reload shows what image is built
  stack?: string;          // #45 — resolved stack (node/python/…) when no explicit image
}

//? A persistent environment (ADR 0037): a dev/staging/prod deployment at a stable route.
export interface EnvironmentSummary {
  id: string;
  projectId: string;
  serviceId?: string;
  kind: string;                 // 'dev' | 'staging' | 'prod'
  route: string;                // stable host
  status: string;               // 'idle'|'deploying'|'live'|'error'|'stopped'
  url?: string;
  lastError?: string;
  lastDeployedAt?: string;
}

//? A downloadable build export (ADR 0038): a docker-save tarball behind a signed TTL'd link.
export interface BuildArtifactSummary {
  id: string;
  projectId: string;
  kind: string;                 // 'image' | 'bundle'
  status: string;               // 'building' | 'ready' | 'error'
  downloadUrl?: string;         // present when ready
  sizeBytes: number;
  error?: string;
  createdAt: string;
  //? #64 — the D4 deploy-hook result for this export (fired=a hook URL was configured; ok/httpStatus = response).
  deployHookFired?: boolean;
  deployHookOk?: boolean;
  deployHookStatus?: number;
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

//? Ticket priority. `urgent` is the hotfix/security tier: a #12 CapacityManager
//? admits it past the workspace concurrency cap (it still needs approval to merge).
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export const TICKET_PRIORITIES: readonly TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

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
  //? #16 (W2) — NON-blocking advisory questions the agent proceeded past with an assumption. The user
  //? can confirm the assumption or correct it (a divergent answer schedules a revision turn). `index` is
  //? the position in the stored list (the conductor resolves by that index). Only UNRESOLVED ones.
  advisoryQuestions?: { index: number; q: string; assumption: string }[];
  priority?: TicketPriority; // low|normal|high|urgent — `urgent` = hotfix/security tier (force-passes the capacity cap, #12)
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

//? ----- Built-in MR review (BUILTIN_MR_REVIEW) -----
//? Client mirror of `server/mr/service.ts` MrView (+ its diff shape). Kept in step
//? with that server type structurally so the `workspaces/mrAction` sync payload
//? drops straight in without a transform.
export type MrDiffLineKind = 'add' | 'del' | 'ctx' | 'hunk';
export interface MrDiffLine { kind: MrDiffLineKind; content: string; oldNo: number | null; newNo: number | null }
export type MrFileStatus = 'added' | 'deleted' | 'modified' | 'renamed';
export interface MrDiffFile {
  path: string; oldPath: string | null; status: MrFileStatus;
  additions: number; deletions: number; lines: MrDiffLine[]; truncated: boolean;
}
export interface MrDiff { files: MrDiffFile[]; additions: number; deletions: number; truncated: boolean }
export interface MrComment { id: string; authorId: string | null; authorKind: string; body: string; createdAt: string }
export interface MrThread {
  id: string; filePath: string | null; line: number | null; side: string; resolved: boolean; comments: MrComment[];
}
export interface MrApproval { userId: string; stale: boolean; createdAt: string }
//? Transient outcome of a merge/rollback (not persisted) — the client toasts it. `reason` is one of
//? no-approval | conflict | not-linked | nothing-to-merge | error; `files` lists conflicting paths.
export interface MrActionOutcome { ok: boolean; reason?: string; files?: string[] }
//? #51/#52 — the latest CI run's rolled-up status + per-job state + parsed security findings, so the
//? MR panel can render a Checks section (was invisible; the merge gate felt arbitrary).
export interface MrCheckJob { name: string; status: string; severity: string | null }
export interface MrCheckFinding { severity: string; title: string }
export interface MrChecks { status: string; maxSeverity: string | null; jobs: MrCheckJob[]; findings: MrCheckFinding[] }
export interface MrView {
  id: string; number: number; title: string; status: string; sourceBranch: string; targetBranch: string;
  headSha: string | null; externalUrl: string | null; mergeStrategy: string;
  diff: MrDiff; threads: MrThread[]; approvals: MrApproval[]; actionResult?: MrActionOutcome; checks?: MrChecks;
}
export type MrActionKind = 'create' | 'comment' | 'approve' | 'merge' | 'rollback' | 'resolve' | 'review';
export interface MrActionFields {
  ticketKey: string; mrId?: string; body?: string; filePath?: string; line?: number; threadId?: string; side?: string; resolved?: boolean;
}
export type MrActionResult = { ok: true; outcome?: MrActionOutcome } | { ok: false; error: string };

//? Cost/usage tracking (#16) — the real per-ticket token totals + 7-day activity the snapshot
//? aggregates from SpendRecord (replaces the seed dummies). Token VOLUME, not money (Max subscription).
export interface UsageByTicket { ticketKey: string; tokensIn: number; tokensOut: number; turns: number }
export interface UsageDay { day: string; tokens: number }
//? Per-AI usage breakdown: tokens + cost grouped by the AI (provider + feature/role) that ran the turn.
//? `subscription` = the Claude PTY coding agent (Max subscription — no metered €, shown as token volume),
//? everything else is a metered API provider with a real cost estimate.
export interface AiUsage { providerId: string; providerLabel: string; feature: string; tokensIn: number; tokensOut: number; turns: number; costEstimate: number; subscription: boolean }
//? #100 — per-user token/cost attribution (the Usage 'by person' card renders tokens/cost per member).
export interface UserUsage { userId: string; tokensIn: number; tokensOut: number; turns: number; costEstimate: number }
export interface WorkspaceUsage { byTicket: UsageByTicket[]; activity: UsageDay[]; totalTokens: number; totalTurns: number; byAi: AiUsage[]; byUser: UserUsage[] }

//? Workspace flow insights (#5): cycle time, throughput, cost-per-ticket — the snapshot aggregates
//? these from tickets + usage. Advisory; shown on the Usage page.
export interface WorkspaceInsights {
  avgCycleHours: number; throughput7d: number; avgTokensPerTicket: number; doneCount: number; openCount: number;
}

//? Content platform (ADR 0069, F4.2) — the content-lane snapshot: the in-flight content pieces + the
//? media €-budget status, so the content UI + settings render from the snapshot.
//? A produced media asset on a content piece (U-fix B) — what the detail page shows + lets you download.
export interface ContentAssetSummary {
  id: string;
  kind: string;          // 'image'|'video'|'voice'|'music'|'sfx'|'render'|'model-3d'|…
  url: string;           // '/media/<file>' (served by the backend) or a hosted provider url
  status: string;        // 'queued'|'processing'|'pending'|'ready'|'error' (queued/processing = live gen)
  stub: boolean;         // produced in dummy mode (no key) — a placeholder, not real media
  queuePosition?: number; // provider queue position while status='queued' (drives "in queue · position N")
  startedAt?: number;    // epoch ms the job left the queue + began — the UI elapsed-timer anchor (status='processing')
  regenerable?: boolean; // I1: a ready, AI-generated (not imported) asset can be regenerated / varied
  variant?: boolean;     // I2: this asset was regenerated/varied from another (has a parent in the version lineage)
  critique?: string;     // F5: a stored AI critique of an image asset (content-critique-image)
  posterUrl?: string;    // F4: a poster frame extracted from a rendered mp4 (the gallery/publish thumbnail)
  publishedOn?: string[]; // S2: platforms this asset is currently published on (drives the unpublish control)
  publishJobs?: { platform: string; status: string; externalUrl?: string; scheduledAt?: string }[]; // #143: honest per-job status (done/stub/error/scheduled/unpublished) + external link
}

//? V1 — a timeline VIDEO SCENE surfaced to the editor: a real clip (or a still) with trim + a transition.
export interface VideoSceneSummary {
  id: string;
  order: number;
  videoAssetId: string | null;
  imageAssetId: string | null;
  startTrimMs: number;
  endTrimMs: number | null;
  durationMs: number;
  transitionIn: string;   // 'cut' | 'fade' | 'xfade'
  prompt: string | null;
}

export interface ContentPieceSummary {
  id: string;
  title: string;
  format: string;
  stageId: string;
  status: string;
  channelId: string | null;
  assets: ContentAssetSummary[];   // U-fix B: the piece's produced assets (surfaced so the UI can show/download them)
  scenes: VideoSceneSummary[];     // V1: the piece's ordered video-timeline scenes (empty until built)
  voiceVolume: number;             // V5 audio-track: linear voice gain in the mix
  musicVolume: number;             // V5 audio-track: ducked music gain in the mix
  voiceUrl: string | null;         // V5: the piece's voiceover asset url (for the audio-track waveform)
  musicUrl: string | null;         // V5: the piece's background-music asset url (for the audio-track waveform)
  spentCents: number;              // Q1: this piece's own media spend (from MediaSpend rows), for per-piece cost transparency
  archived?: boolean;              // #129: soft-archived — hidden from the board, shown in the Archived view with Restore
}
//? Content analytics fold (F5.1) surfaced for the insights dashboard (U4).
export interface ContentAnalyticsView {
  totalPieces: number;
  doneCount: number;
  publishedCount: number;
  byStage: { stage: string; count: number }[];
  byFormat: { format: string; count: number }[];
  totalCostCents: number;
  costByFeature: { feature: string; cents: number }[];
}
//? A style-library entry (U4) — a named style preset (global or per-workspace/brand). `systemPrompt` +
//? `builtin` let the Q3 style-manager edit per-workspace styles (builtins are read-only).
export interface ContentStyleSummary { id: string; key: string; label: string; feature: string; builtin: boolean; systemPrompt: string; previewAssetUrl?: string | null; previewKind?: string | null }
//? Inspiration/reference library entry (an example ad/thumbnail/intro the AI emulates).
export interface ContentReferenceSummary { id: string; kind: string; title: string; description: string; assetUrl?: string | null; tags: string[] }
//? A channel + its brand voice (U4) — the per-channel brand snippet that feeds brand-RAG.
export interface ContentChannelSummary { id: string; name: string; platform: string; handle?: string | null; brandVoice: string; defaultStyleId?: string | null }
//? A publish target (FIX-C) — a platform + whether the workspace has a stored OAuth connection for it,
//? so the settings UI shows connect/connected and the piece-detail only offers publish to a live target.
export interface PublishTargetSummary { platform: string; connected: boolean }

export interface ContentSnapshot {
  pieces: ContentPieceSummary[];
  mediaBudget: { enabled: boolean; capCents: number; spentCents: number; alertPct: number; overAlert: boolean };
  analytics: ContentAnalyticsView;      // U4: the content-analytics dashboard fold
  styles: ContentStyleSummary[];        // U4: the style library
  references: ContentReferenceSummary[]; // inspiration library (example ads/thumbnails/intros)
  channels: ContentChannelSummary[];    // U4: channels + their brand voice
  publishTargets: PublishTargetSummary[];   // FIX-C: youtube/tiktok + connected?
  mediaCosts: { feature: string; cents: number }[];   // Q1: per-feature € estimate for the pre-spend confirm
  mediaModels: { feature: string; model: string }[];   // P3: per-feature model overrides (empty = env/default)
  shortLinks: ShortLinkSummary[];       // H2/H3 (ads): trackable links + clicks (the A/B comparison data)
}

//? H3 (ads) — a trackable short link surfaced to the UI. `clicks` is the conversion signal; `variant` groups
//? A/B ad variants so the highest-click variant is the experiment winner (H2).
export interface ShortLinkSummary {
  id: string;
  contentProjectId: string | null;
  slug: string;
  targetUrl: string;
  variant: string | null;
  clicks: number;
}

//? Review ergonomics (ADR 0048) — one item in the cross-ticket answer-queue: a ticket parked on a
//? question, surfaced in a single queue the reviewer swipes/stacks through.
export interface AnswerQueueItem {
  ticketKey: string;
  title: string;
  question: string;
  priority: string;
}

//? Delivery analytics (ADR 0047) — the fuller on-request fold surfaced on the analytics dashboard.
export interface WorkspaceAnalytics {
  cycleP50Hours: number;
  cycleP85Hours: number;
  throughputByWeek: { weekStart: string; done: number }[];
  stuckCount: number;
  doneCount: number;
  openCount: number;
  tokensByLabel: { label: string; tokens: number }[];
  totalTokens: number;
}

//? RAG code-index status (07 §D) — the `workspaces/scanIndex` sync result.
export interface RagIndexStatus { ok: boolean; files: number; chunks: number; commitHash: string; embedder: string }

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
  type: 'link-tickets' | 'create-epic' | 'config-review' | 'maintenance' | 'automation' | 'copilot';
  title: string;
  body: string;
  ticketIds: string[];
  patch?: unknown; // appliable config/automation patch { path, before, after }; #109 copilot: { navigate, prefill, op }
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
//? A user (or assistant) comment on a ticket — a `WorkspaceNote` projection. `author`
//? is the User.id ('' for a non-user author); the UI resolves it to a member.
export interface TicketNote {
  id: string;
  ticketId: string;   // the DEV-#### key
  author: string;     // User.id, or '' when authorKind !== 'user'
  body: string;
  time: string;
}

export interface NotificationItem {
  id: string;
  type: 'needs-input' | 'merge' | 'ai-suggestion' | 'container-failure' | 'assignment';
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
  type: 'command' | 'file-change' | 'ai-message' | 'status-change' | 'mr' | 'comment' | 'ci';
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
  type: 'command' | 'file-change' | 'ai-message' | 'status-change' | 'mr' | 'comment' | 'ci';
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
  container?: string;   // the L3 container name — routes the PTY to `docker exec` (07b §9)
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
  source: 'generated' | 'git' | 'uploaded' | 'starter' | 'design-system';
  updated: string;
  note: string;              // "frozen @ abc123" | "spec"
  summary: string;           // one-liner of what the file/skill contains
  pendingBranches?: string[]; // branches whose changes aren't in this file yet
  usedByStages?: string[];   // stage names that load this doc
  content: string;           // markdown/text shown in the read-only preview
  aiEditable: boolean;       // may the AI edit this doc? (docs-init per-file gate; backed by InfoSource.enabled)
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
  sentAt: string;             // #77 — ISO timestamp the invite was created (was a literal 'pending')
  expiresAt: string | null;   // #77 — ISO expiry (7-day), or null if it never expires
}

//? A pending invitation addressed to the LOGGED-IN user's email, resolved across
//? ALL workspaces (not tenant-scoped) — drives the onboarding "you've been invited"
//? list. Accepted by its opaque `token` via the `accept-invite` control-op.
export interface MyInvite {
  token: string;
  workspaceName: string;
  role: Role;
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
//? A control-op the Workspace-AI proposes for the user to CONFIRM (the AI never writes;
//? an accepted proposal dispatches the matching control-op under the normal RBAC).
export interface ChatProposal {
  //? O-B (IDEA_TO_OUTCOME): the Assistant can now propose CREATE ops too — not just reshuffle the board.
  //? Each still maps to an EXISTING control verb (no new verbs): create-ticket → quick-add,
  //? create-content → content-from-brief. The AI only proposes; accept dispatches (single-writer intact).
  //? X1 (UNIVERSAL_TOOL/COMPLETION): beyond the 5 legacy shapes, `op` may be ANY catalog-enabled
  //? ControlOp (server/ai/opCatalog.ts validates + the CHAT_ENABLED_OPS tranche in chatOps.ts
  //? dispatches). Generic ops carry their validated fields in `params`; `destructive: true` makes
  //? the client wrap the accept in an extra explicit confirm (B-23 confirm-on-important).
  op: 'assign' | 'create-ticket' | 'create-content' | ControlOp;
  summary: string;          // human-readable ("Move DEV-3 → Review")
  destructive?: boolean;    // extra confirm required at accept (X1 generic ops)
  params?: Record<string, unknown>; // generic-op fields, already server-validated against the workspace
  ticketKeys?: string[];
  stageId?: string;
  assigneeId?: string;
  body?: string;
  title?: string;           // create-ticket / create-content
  description?: string;     // create-ticket (optional richer body)
  brief?: string;           // create-content (what the piece is about)
  format?: string;          // create-content ('faceless' | 'talking-head' | …)
}

//? O-A (IDEA_TO_OUTCOME) — the IntakeCopilot: a natural-language idea ("build a todo app", "make a launch
//? video") decomposes into an ordered, single-approval PLAN of steps. Each step is a ChatProposal that maps to
//? an existing verb (no new verbs); approving the plan dispatches the steps in order (single-writer intact).
export interface ChatPlan {
  summary: string;          // "Plan: build a todo app (3 tickets)"
  steps: ChatProposal[];    // ordered; each dispatched via the same accept path as a single proposal
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  questionSetId?: string; // renders a QuestionSet card inline in the Assistant chat (ERRATA E4)
  proposal?: ChatProposal; // an AI action proposal rendered with an Accept button
  plan?: ChatPlan;         // O-A — a multi-step intake plan rendered with an Approve-plan button
  pending?: boolean;       // the AI turn is in flight (renders a thinking indicator)
  accepted?: boolean;      // the proposal/plan has been dispatched (Accept consumed)
  declined?: boolean;      // J5 — the proposal/plan was rejected (dismissed without dispatch)
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
  definitionOfDone?: string;         // optional "done when…"; empty ⇒ the AI judges completion itself
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
  | 'invoke-agent-role'
  | 'run-command'
  | 'emit-signal'
  | 'webhook'
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

//? Studio module — the design + marketing tool. A BRIEF describes the product; the AI designer/
//? marketer roles generate ARTIFACTS from it. Kinds: landing page, marketing copy, brand kit,
//? go-to-market strategy.
export type StudioArtifactKind = 'landing' | 'component' | 'brand' | 'copy' | 'strategy' | 'email' | 'ads' | 'social' | 'names' | 'thumbnail' | 'videoScript';

//? A recorded AI run for the central activity feed (the "Activity" tab of the Workspace-AI panel).
//? Designer module (ADR 0034) — a persisted design-library entry + the workspace's active flag.
export interface DesignArtifact {
  id: string;
  kind: string;                        // 'theme' | 'style' | 'animation'
  name: string;
  description: string;
  content: unknown;
  source: string;
  active: boolean;
  createdAt: string;
}

//? Interviewer module (ADR 0034) — a persisted, categorised improvement finding.
export interface InterviewFinding {
  id: string;
  area: string;                        // reliability|dx|ux|performance|security|product|other
  severity: string;                    // low|normal|high
  title: string;
  summary: string;
  status: string;                      // open|accepted|dismissed
  ticketId: string | null;
  createdAt: string;
}

//? Ticket ↔ artifact link (ADR 0034) — a design/Studio artifact a ticket implements.
export interface TicketArtifactLink {
  id: string;
  ticketId: string;                    // DEV-#### key
  artifactId: string;
  artifactKind: string;                // 'design' | 'studio'
  name: string;
  label: string | null;
}

export interface AiRun {
  id: string;
  feature: string;
  label: string;
  prompt: string;
  output: string;
  providerId: string;
  status: 'ok' | 'error';
  error?: string;
  createdAt: string;
  ms: number;
}

//? The workspace's central brand library (ADR 0013 G-MKT-2) — one source of brand truth every
//? Studio generation seeds from.
export interface StudioBrandLibrary {
  workspaceId: string;
  name: string;
  palette: { name: string; hex: string }[];
  typography: { heading: string; body: string };
  voice: string;
  taglines: string[];
  logoIdeas: string[];
}

export interface StudioBrief {
  id: string;
  workspaceId: string;
  projectId?: string;
  name: string;
  productName: string;
  audience: string;
  tone: string;
  goals: string;
  notes?: string;
  createdAt: string;
}

export interface StudioArtifact {
  id: string;
  workspaceId: string;
  briefId: string;
  kind: StudioArtifactKind;
  role: 'designer' | 'marketer';
  title: string;
  content: unknown;          // kind-specific: {html} | {sections[]} | brand tokens | {markdown}
  providerId?: string;
  status: 'generating' | 'ready' | 'error';
  error?: string;
  createdAt: string;
}
