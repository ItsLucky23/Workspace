//? Workspaces — the read snapshot (the server side of `useWorkspaceData()`).
//?
//? Aggregates one workspace's tenant-scoped rows into the exact frontend types the
//? screens render (MIGRATION §4), narrowing DB strings to the typed unions so the
//? client gets fully-typed data (no `unknown[]`). Reads go through `tenantDb` inside
//? `runInTenant(workspaceId)`; the cross-workspace bits (which workspaces a user
//? belongs to, User join) use the plain client. `PipelineStage.key` → frontend `id`.
//?
//? Scope note: `stages` carries the board META (id/kind/name/order/aiEnabled/wipLimit)
//? for the board columns; `stageConfigs` carries the FULL per-stage editor config
//? (prompting, commands, tools, statuses, processes, model/network/hooks) — both are
//? derived from the same `PipelineStage` rows.

import type { PrismaClient, PipelineStage as DbPipelineStage } from '@prisma/client';

import { activeCountReadOnly, queueLength, capacityLimit } from '../orchestrator/capacity';
import { runInTenant, currentWorkspaceId } from '../tenant/tenantContext';
import { tenantDb } from '../tenant/tenantDb';
import { listAgentRoles } from '../automation/agentRoles';
import { listAiRuns } from '../ai/activity';
import { formatTime, toContentAssetSummary, toContentPieceSummary, toVideoSceneSummary, toEnvVar, toInfoDoc, toTicket } from './mappers';
import { AI_PROVIDER_LIST } from '../ai/providers/catalog';
import { listConnections } from '../ai/connections';
import { repoStatus } from '../git/repoStore';
import { baseDomain } from '../proxy';
import { listTemplates } from '../scaffold/templates';
import { parseTokenKey, parseHealthKey, credentialKey, envCredentials, credentialSource } from '../content/publishOAuth';
import { buildChannelHealth, accountKey } from '../content/publishHealth';
import { listLibrary } from '../content/assetLibrary';
import { listTrash, workspaceStorage } from '../media/trash';
import { normalizeGitConfig, DEFAULT_GIT_CONFIG, type GitConfig } from '../git/branchStrategy';
import { aggregateUsage, type WorkspaceUsage } from '../spend/record';
import { computeInsights, type WorkspaceInsights } from '../obs/insights';
import { computeAnalytics } from '../obs/analytics';
import { computeContentAnalytics } from '../content/contentAnalytics';
import { listWorkspaceTemplates } from '../documents/templates';
import type {
  ActivityEvent, AiSuggestion, CommandMode, EnvVar, InfoDoc, IntegrationTool, InviteEntry, Member,
  ModelRule, MyInvite, NetworkMode, NotificationItem, PermRole, PipelineStage, PipelineStageCfg, Role,
  AiSkillEntry, DocumentEntry, DocumentTemplateEntry, SkillEntry, Sprint, SshKeyEntry, StageCommandCfg, StageEffort, StageEnvVar, StageKind, StageModelTier,
  RepoInfo, StageProcessCfg, StageStatusCfg, StageToolCfg, Ticket, TicketNote, ToolTier, Workspace, WorkspaceBudget, WorkspaceReadiness,
  WorkspaceTrigger, TriggerEventKind, TriggerActionKind,
  StudioBrief, StudioArtifact, StudioArtifactKind, StudioBrandLibrary,
  ProjectSummary, ServiceSummary, ServiceStackSummary, DbConnectionSummary, MigrationSummary, EnvironmentSummary, BuildArtifactSummary, WorkspaceAnalytics, ContentSnapshot, ContentAssetSummary, VideoSceneSummary,
  ChatMessage, PatSummary,
} from '../../src/workspaces/_data/types';
import { getMediaBudgetStatus } from '../media/budget';
import { mediaCostTable } from '../media/registry';
import { buildReadiness } from './readiness';


//? Read a string field off a Json value (for the brand-library palette/typography JSON).
const jsonStr = (v: unknown, key: string): string => (v !== null && typeof v === 'object' && typeof (v as Record<string, unknown>)[key] === 'string' ? ((v as Record<string, string>)[key] ?? '') : '');

//? DB-string → the studio artifact kind (fallback keeps a stale row from crashing the snapshot).
const ARTIFACT_KINDS: readonly StudioArtifactKind[] = ['landing', 'component', 'brand', 'copy', 'strategy', 'email', 'ads', 'social', 'names', 'thumbnail', 'videoScript'];
const asArtifactKind = (s: string): StudioArtifactKind => ((ARTIFACT_KINDS as readonly string[]).includes(s) ? s : 'landing') as StudioArtifactKind;
const asArtifactStatus = (s: string): StudioArtifact['status'] => (s === 'generating' || s === 'error' ? s : 'ready');

//? DB-string → the trigger unions (fallback to a safe default so a stale row can't crash the snapshot).
const TRIGGER_ONS: readonly TriggerEventKind[] = ['stage.on_enter', 'stage.on_complete', 'stage.on_signal', 'stage.on_approval', 'ticket.created', 'ticket.merged', 'suggestion.accepted', 'cron'];
const TRIGGER_ACTIONS: readonly TriggerActionKind[] = ['start-stage', 'invoke-workspace-ai', 'invoke-agent-role', 'run-command', 'emit-signal', 'webhook', 'notify'];
const asTriggerOn = (s: string): TriggerEventKind => ((TRIGGER_ONS as readonly string[]).includes(s) ? s : 'ticket.created') as TriggerEventKind;
const asTriggerAction = (s: string): TriggerActionKind => ((TRIGGER_ACTIONS as readonly string[]).includes(s) ? s : 'notify') as TriggerActionKind;

//? DB-string → typed-union narrowers (ternary narrowing, no `as`): in the true
//? branch of the `===` chain TS narrows the string to the compared literals.
const asRole = (key: string): Role => (key === 'owner' || key === 'admin' ? key : 'member');
const asKind = (s: string): StageKind => (s === 'refine' || s === 'plan' || s === 'test' || s === 'review' || s === 'final' ? s : 'code');
const asSugType = (s: string): AiSuggestion['type'] => (s === 'link-tickets' || s === 'create-epic' || s === 'config-review' || s === 'automation' || s === 'copilot' ? s : 'maintenance');
const asEvType = (s: string): ActivityEvent['type'] => (s === 'command' || s === 'file-change' || s === 'status-change' || s === 'mr' || s === 'comment' || s === 'ci' ? s : 'ai-message');
const asSkillKind = (s: string | null): SkillEntry['kind'] => (s === 'frozen' ? 'frozen' : 'live');
const asNotifType = (s: string): NotificationItem['type'] => (s === 'needs-input' || s === 'merge' || s === 'ai-suggestion' || s === 'assignment' || s === 'publish-failure' ? s : 'container-failure');
const asCommandMode = (s: string): CommandMode => (s === 'allow' || s === 'deny' ? s : 'ask');
const asToolTier = (s: string): ToolTier => (s === 'rw' ? s : 'ro');
const asStatusKind = (s: string): StageStatusCfg['kind'] => (s === 'base' ? s : 'custom');
const asNetworkMode = (s: string): NetworkMode => (s === 'blacklist' ? s : 'whitelist');
const asModelTier = (s: string): StageModelTier => (s === 'haiku' || s === 'opus' ? s : 'sonnet');
const asEffort = (s: string): StageEffort => (s === 'low' || s === 'high' || s === 'xhigh' || s === 'max' ? s : 'medium');

//? `Notification.deepLink` is a nullable Prisma `Json` column; narrow it cast-free via
//? the TS 4.9+ `in`-operator narrowing on `unknown` (no `as`).
const asDeepLink = (v: unknown): NotificationItem['deepLink'] => {
  if (v === null || typeof v !== 'object') return undefined;
  if (!('view' in v) || typeof v.view !== 'string') return undefined;
  const ticketId = 'ticketId' in v && typeof v.ticketId === 'string' ? v.ticketId : undefined;
  const tab = 'tab' in v && typeof v.tab === 'string' ? v.tab : undefined;
  const terminalId = 'terminalId' in v && typeof v.terminalId === 'string' ? v.terminalId : undefined;
  return { view: v.view, ticketId, tab, terminalId };
};

//? `PipelineStage.hooks` is a Prisma `Json` column; coerce it to the frontend's
//? `Record<string, boolean>` cast-free, dropping any non-boolean entries.
const asHooks = (v: unknown): Record<string, boolean> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(v)) { if (typeof val === 'boolean') out[key] = val; }
  return out;
};

//? Map a Prisma PipelineStage row → the frontend `PipelineStageCfg`. Shared by the
//? snapshot AND the realtime `save-stage-config` `_sync` route so a live stage-config
//? delta matches the initial-load shape exactly (no divergence, no refetch).
export function toStageConfig(s: DbPipelineStage): PipelineStageCfg {
  return {
    projectId: s.projectId,
    id: s.key, kind: asKind(s.kind), name: s.name, order: s.order, aiEnabled: s.aiEnabled,
    customInstructions: s.customInstructions, promptTemplate: s.promptTemplate, definitionOfDone: s.definitionOfDone,
    systemPrompt: s.systemPrompt, roleKey: s.roleKey, userEditable: s.userEditable, gateForApproval: s.gateForApproval,
    skillKeys: s.skillKeys, aiSkillIds: s.aiSkillIds, sourceIds: s.sourceIds,
    commands: s.commands.map((c): StageCommandCfg => ({
      id: c.id, pattern: c.pattern, mode: asCommandMode(c.mode), title: c.title ?? undefined, desc: c.desc ?? undefined, category: c.category ?? undefined,
    })),
    tools: s.tools.map((t): StageToolCfg => ({ toolId: t.toolId, tier: asToolTier(t.tier) })),
    statuses: s.statuses.map((st): StageStatusCfg => ({ key: st.key, label: st.label, kind: asStatusKind(st.kind) })),
    processes: s.processes.map((p): StageProcessCfg => ({
      id: p.id, name: p.name, cwd: p.cwd,
      env: p.env.map((e): StageEnvVar => ({ key: e.key, value: e.value })),
      commands: p.commands,
    })),
    visibleStageIds: s.visibleStageIds,
    modelCfg: {
      autoEscalate: s.modelCfg.autoEscalate,
      base: { model: asModelTier(s.modelCfg.base.model), effort: asEffort(s.modelCfg.base.effort), maxTurns: s.modelCfg.base.maxTurns },
      rules: s.modelCfg.rules.map((r): ModelRule => ({ id: r.id, minScore: r.minScore, model: asModelTier(r.model), effort: asEffort(r.effort), maxTurns: r.maxTurns })),
      contextBudgetTokens: s.modelCfg.contextBudgetTokens ?? undefined,
    },
    network: { enabled: s.network.enabled, mode: asNetworkMode(s.network.mode), categories: s.network.categories, domains: s.network.domains },
    hooks: asHooks(s.hooks),
    wipLimit: s.wipLimit ?? undefined,
  };
}

//? Runtime guard: is the Conductor's save-stage-config op result a PipelineStage row?
//? Narrows the (deliberately `unknown`) result to a typed `PipelineStageCfg` delta
//? WITHOUT an `as`-cast (the strict no-assertion posture).
function isDbPipelineStage(v: unknown): v is DbPipelineStage {
  return v !== null && typeof v === 'object' && 'key' in v && 'kind' in v && 'modelCfg' in v && 'processes' in v;
}

//? Narrow the save-stage-config op result to the frontend `PipelineStageCfg` delta the
//? realtime `_sync` route broadcasts (or null if the op no-oped).
export function stageConfigDelta(result: unknown): PipelineStageCfg | null {
  return isDbPipelineStage(result) ? toStageConfig(result) : null;
}

export interface WorkspaceSnapshot {
  workspaces: (Pick<Workspace, 'id' | 'name' | 'slug' | 'ownerId' | 'role' | 'forgeType' | 'webhookConfigured' | 'webhookLastEventAt' | 'allowMergeOnRedCI' | 'enabledSections' | 'productContext' | 'aiInstruction' | 'outputLanguage' | 'geminiModel' | 'geminiTemperature' | 'geminiBaseUrl' | 'autonomyLevel'>)[];
  activeWorkspaceId: string | null;
  //? Multi-project (ADR 0035): the active workspace's projects + the selected one.
  //? board/pipeline/tickets/sprints below are scoped to `activeProjectId`.
  projects: ProjectSummary[];
  activeProjectId: string | null;
  //? The active project's declared services (monorepo build/deploy units, ADR 0035).
  services: ServiceSummary[];
  serviceStacks: ServiceStackSummary[];
  dbConnections: DbConnectionSummary[];
  migrations: MigrationSummary[];
  //? The active project's persistent environments (dev/staging/prod deployments, ADR 0037).
  environments: EnvironmentSummary[];
  //? The active project's recent downloadable build exports (ADR 0038).
  buildArtifacts: BuildArtifactSummary[];
  //? Greenfield scaffolding (ADR 0046): the curated stack templates for "new project from template".
  templates: { key: string; label: string; description: string }[];
  members: Member[];
  tickets: Ticket[];
  stages: PipelineStage[];
  stageConfigs: PipelineStageCfg[];
  //? P1 — per-workspace AI provider overrides per feature (empty = the global defaults).
  aiOverrides: { feature: string; providerId: string }[];
  //? ADR 0007 — the CONNECTED AIs, and what can be connected. `hasKey` is presence ONLY; the
  //? credential is encrypted at rest and never leaves the server. No endpoint in either shape: which
  //? host answers is infrastructure, resolved server-side.
  aiConnections: { id: string; providerId: string; label: string; model: string; kind: 'subscription' | 'api-key'; hasKey: boolean; verifiedAt: string | null; lastError: string | null }[];
  aiProviderCatalog: { id: string; label: string; kind: 'subscription' | 'api-key'; models: { id: string; label: string }[]; defaultModel: string; keyUrl: string }[];
  //? E5 — user-defined custom AI tasks (name + template + last output).
  customTasks: { id: string; name: string; promptTemplate: string; lastOutput: string | null; lastRunAt: number | null }[];
  //? O5 — reusable output specs (name + render format + watermark position).
  outputTemplates: { id: string; name: string; format: string; watermarkPosition: string }[];
  //? SK1 — canonical Skill rows: instruction skills surface here; capability skills surface in `skills`.
  aiSkills: AiSkillEntry[];
  //? DOC1 — the Documents module.
  documents: DocumentEntry[];
  documentTemplates: DocumentTemplateEntry[];
  sprints: Sprint[];
  suggestions: AiSuggestion[];
  budget: WorkspaceBudget | null;
  //? #103 — ALL spend caps (multi-cap editor); `budget` above stays the primary for the compact display.
  budgets: WorkspaceBudget[];
  //? #105/#19 — engine occupancy for the board busy/queued chip (global across instances; optional so
  //? the empty/loading snapshot can omit it).
  capacity?: { active: number; queued: number; limit: number };
  docs: InfoDoc[];
  skills: SkillEntry[];
  roles: PermRole[];
  envVars: EnvVar[];
  integrations: IntegrationTool[];
  invites: InviteEntry[];
  events: ActivityEvent[];
  notifications: NotificationItem[];
  notes: TicketNote[];
  //? Setup readiness (UX): the "is this actually set up?" booleans the screens read to explain WHY a feature
  //? is blocked and HOW to fix it (link a repo / add a key / connect an account) instead of a silent empty state.
  readiness: WorkspaceReadiness;
  //? The caller's RESOLVED per-capability booleans in the active workspace (positional over RBAC_CAPABILITIES,
  //? incl. custom roles — the flattened `Workspace.role` collapses those). Lets the UI show a "fix it" button
  //? only when the user actually MAY, and otherwise "ask someone with <capability>" — never a dead button.
  myPerms: boolean[];
  //? The caller's RAW role key in the active workspace (not `asRole`-flattened) — the source of `myPerms`.
  myRoleKey: string;
  //? Register-flow step A: the active workspace's linked-repo status (on-disk bare clone).
  repo: RepoInfo;
  //? The active workspace's git strategy + push policy (normalized; DEFAULT when unset).
  gitConfig: GitConfig;
  //? The active workspace's pause-all state (C2): when true the engine provisions no new turns.
  workspacePaused: boolean;
  //? Cost/usage tracking (#16): real per-ticket token totals + 7-day activity from SpendRecord.
  usage: WorkspaceUsage;
  //? Flow insights (#5): cycle time / throughput / cost-per-ticket.
  insights: WorkspaceInsights;
  //? Delivery analytics (ADR 0047): the fuller fold for the analytics dashboard.
  analytics: WorkspaceAnalytics;
  //? Review ergonomics (ADR 0048): the cross-ticket answer-queue — tickets parked on a question.
  //? Content platform (ADR 0069): the content-lane pieces + media €-budget status.
  content: ContentSnapshot;
  //? Automation (#2): the workspace's triggers.
  triggers: WorkspaceTrigger[];
  //? Scheduled tasks: the agent roles a trigger can run (registered at boot; global, not per-workspace).
  agentRoles: { key: string; label: string; description: string; mutates: boolean }[];
  //? Central AI-activity feed (the "Activity" tab of the Workspace-AI panel): recent AI runs with
  //? their prompt + output + status, so every AI-driven action is visible in one place.
  aiRuns: { id: string; feature: string; label: string; prompt: string; output: string; providerId: string; status: 'ok' | 'error'; error?: string; createdAt: string; ms: number }[];
  //? Studio module: product briefs + their generated artifacts + the central brand library.
  studioBriefs: StudioBrief[];
  studioArtifacts: StudioArtifact[];
  studioBrand: StudioBrandLibrary | null;
  //? Designer module (ADR 0034): the persisted design library (themes/styles/animations) + active flag.
  designArtifacts: { id: string; kind: string; name: string; description: string; content: unknown; source: string; active: boolean; createdAt: string }[];
  //? Interviewer module (ADR 0034): categorised, persisted improvement findings.
  interviewFindings: { id: string; area: string; severity: string; title: string; summary: string; status: string; ticketId: string | null; createdAt: string }[];
  //? U2 (gap-fix): open "unfuck the UI" review requests — the designer inbox feed.
  uiReviews: { id: string; projectId: string | null; page: string | null; problems: string[]; screenshots: string[]; notes: string | null; createdAt: string }[];
  //? Ticket ↔ artifact links (ADR 0034): design/Studio artifacts a ticket implements (keyed by DEV-#### key).
  ticketArtifactLinks: { id: string; ticketId: string; artifactId: string; artifactKind: string; name: string; label: string | null }[];
  //? #111 — the requesting user's persisted Workspace-AI chat history (per-user), chronological,
  //? so the conversation survives reload / is phone-desktop consistent.
  chat: ChatMessage[];
  //? #76 — the requesting user's persisted SSH keys (account-global), for the Account settings +
  //? terminal-unlock. Replaces the client-only SSH_KEYS seed.
  sshKeys: SshKeyEntry[];
  //? Cross-workspace: invitations addressed to THIS user's email (onboarding). Always
  //? present — even for a user with zero workspaces (the no-workspace early return).
  myInvites: MyInvite[];
  //? Preload gap-fix (X3) — the CALLER's own Personal Access Tokens for the active workspace (metadata
  //? only; see `PatSummary`). Was a mount-time GET (`workspaces/listPats`) on every settings visit.
  pats: PatSummary[];
}

const EMPTY: Omit<WorkspaceSnapshot, 'workspaces' | 'activeWorkspaceId' | 'activeProjectId' | 'myInvites'> = {
  projects: [], services: [], serviceStacks: [], dbConnections: [], migrations: [], environments: [], buildArtifacts: [], templates: listTemplates(),
  members: [], tickets: [], stages: [], stageConfigs: [], aiOverrides: [], aiConnections: [], aiProviderCatalog: [], customTasks: [], outputTemplates: [], aiSkills: [], documents: [], documentTemplates: [], sprints: [], suggestions: [], budget: null, budgets: [],
  docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [], notifications: [], notes: [],
  readiness: { repoLinked: false, aiText: false, media: { fal: false, elevenlabs: false, suno: false }, publishing: false, docker: false, push: false, secretManager: false },
  myPerms: [], myRoleKey: 'member',
  repo: { linked: false }, gitConfig: DEFAULT_GIT_CONFIG, workspacePaused: false,
  usage: { byTicket: [], activity: [], totalTokens: 0, totalTurns: 0, byAi: [], byUser: [] },
  insights: { avgCycleHours: 0, throughput7d: 0, avgTokensPerTicket: 0, doneCount: 0, openCount: 0 },
  analytics: { cycleP50Hours: 0, cycleP85Hours: 0, throughputByWeek: [], stuckCount: 0, doneCount: 0, openCount: 0, tokensByLabel: [], totalTokens: 0 },
  content: { pieces: [], mediaBudget: { enabled: false, capCents: 0, spentCents: 0, alertPct: 80, overAlert: false }, analytics: { totalPieces: 0, doneCount: 0, publishedCount: 0, byStage: [], byFormat: [], totalCostCents: 0, costByFeature: [] }, styles: [], references: [], channels: [], publishTargets: [], channelHealth: [], platformCredentials: [], assetLibrary: [], mediaCosts: [], mediaModels: [], mediaPrefs: { cheap: false, sceneContinuity: false, voiceId: '' }, shortLinks: [], comments: [], unreadComments: 0, trash: [], storage: { liveBytes: 0, trashBytes: 0, files: 0 } },
  triggers: [],
  agentRoles: [],
  aiRuns: [],
  studioBriefs: [],
  studioArtifacts: [],
  studioBrand: null,
  designArtifacts: [],
  interviewFindings: [],
  uiReviews: [],
  ticketArtifactLinks: [],
  chat: [],
  sshKeys: [],
  pats: [],
};

export async function buildSnapshot(prisma: PrismaClient, userId: string, wantWorkspaceId?: string, wantProjectId?: string): Promise<WorkspaceSnapshot> {
  const memberships = await prisma.workspaceMember.findMany({ where: { userId } });
  const wsIds = memberships.map((m) => m.workspaceId);
  const workspaceRows = wsIds.length > 0 ? await prisma.workspace.findMany({ where: { id: { in: wsIds } } }) : [];
  const roleByWs = new Map(memberships.map((m) => [m.workspaceId, m.roleKey]));
  //? Webhook secrets are write-once credentials: the snapshot exposes only configured state.
  const workspaces = workspaceRows.map((w) => ({ id: w.id, name: w.name, slug: w.slug, ownerId: w.ownerId, role: asRole(roleByWs.get(w.id) ?? 'member'), forgeType: w.forgeType, webhookConfigured: (w.webhookSecret ?? '').length > 0, webhookLastEventAt: w.webhookLastEventAt ? w.webhookLastEventAt.toISOString() : '', allowMergeOnRedCI: w.allowMergeOnRedCI, enabledSections: w.enabledSections, productContext: w.productContext, aiInstruction: w.aiInstruction, outputLanguage: w.outputLanguage, geminiModel: w.geminiModel, geminiTemperature: w.geminiTemperature, geminiBaseUrl: w.geminiBaseUrl, autonomyLevel: w.autonomyLevel }));

  //? Cross-workspace, by-email (NOT tenant-scoped): the pending invitations this user
  //? can accept from the onboarding. Uses the plain client — a user with no workspace
  //? has no tenant to scope to, and an invite lives in the INVITING workspace.
  const userRow = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const inviteRowsForMe = userRow?.email ? await prisma.invite.findMany({ where: { email: userRow.email, status: 'pending', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }) : [];
  const inviteWsIds = [...new Set(inviteRowsForMe.map((i) => i.workspaceId))];
  const inviteWsRows = inviteWsIds.length > 0 ? await prisma.workspace.findMany({ where: { id: { in: inviteWsIds } }, select: { id: true, name: true } }) : [];
  const inviteWsName = new Map(inviteWsRows.map((w) => [w.id, w.name]));
  const myInvites: MyInvite[] = inviteRowsForMe.map((i) => ({ token: i.token, workspaceName: inviteWsName.get(i.workspaceId) ?? '—', role: asRole(i.roleKey) }));

  const activeWorkspaceId = wantWorkspaceId && wsIds.includes(wantWorkspaceId) ? wantWorkspaceId : (wsIds[0] ?? null);
  if (!activeWorkspaceId) return { workspaces, activeWorkspaceId: null, activeProjectId: null, ...EMPTY, myInvites };

  return runInTenant(activeWorkspaceId, async () => {
    //? Multi-project (ADR 0035): an explicit requested project is validated strictly;
    //? stale/foreign targets scope to nothing rather than falling through to project #1.
    //? Only an omitted target gets the oldest-project legacy default. A sentinel ObjectId
    //? scopes to nothing for either invalid-target or genuinely project-less snapshots.
    const projectRows = await tenantDb.project.findMany({ orderBy: { createdAt: 'asc' } });
    const forgeConnectionRows = projectRows.length > 0
      ? await tenantDb.forgeConnection.findMany({ where: { projectId: { in: projectRows.map((project) => project.id) } } })
      : [];
    const forgeConnectionByProject = new Map(forgeConnectionRows.map((connection) => [connection.projectId, connection]));
    const activeProjectId = wantProjectId === undefined
      ? (projectRows[0]?.id ?? null)
      : (projectRows.some((project) => project.id === wantProjectId) ? wantProjectId : null);
    const projectScope = { projectId: activeProjectId ?? '000000000000000000000000' };
    const serviceRows = activeProjectId ? await tenantDb.service.findMany({ where: projectScope, orderBy: { createdAt: 'asc' } }) : [];
    const environmentRows = activeProjectId ? await tenantDb.environment.findMany({ where: projectScope, orderBy: { createdAt: 'asc' } }) : [];

    //? F27 — one query for the whole page's deploy history, bucketed per environment. Bounded per env so a
    //? long-lived project cannot grow the snapshot without limit; the full log stays queryable server-side.
    const deployHistoryRows = new Map<string, { id: string; commit: string; branch: string; status: string; error: string | null; createdAt: Date }[]>();
    if (environmentRows.length > 0) {
      const historyRows = await tenantDb.deployHistory.findMany({
        where: { envId: { in: environmentRows.map((e) => e.id) } },
        orderBy: { createdAt: 'desc' }, take: 120,
      });
      for (const row of historyRows) {
        const bucket = deployHistoryRows.get(row.envId) ?? [];
        if (bucket.length < 10) { bucket.push(row); deployHistoryRows.set(row.envId, bucket); }
      }
    }
    //? K1/K3 — provisioned service stacks (workspace-scoped, not per-project).
    const serviceStackRows = await tenantDb.serviceStack.findMany({ orderBy: { createdAt: 'asc' } });
    const buildArtifactRows = activeProjectId ? await tenantDb.buildArtifact.findMany({ where: projectScope, orderBy: { createdAt: 'desc' }, take: 20 }) : [];
    //? ADR 0043 — the active project's DB connections + migrations (for the DB panel). URLs stay server-only.
    const dbConnectionRows = activeProjectId ? await tenantDb.dbConnection.findMany({ where: projectScope, orderBy: { createdAt: 'asc' } }) : [];
    const migrationRows = activeProjectId ? await tenantDb.migration.findMany({ where: projectScope, orderBy: { createdAt: 'desc' }, take: 20 }) : [];

    const [memberRows, roleRows, stageRows, ticketRows, sprintRows, suggestionRows, budgetRows, sourceRows, envRows, integrationRows, inviteRows, eventRows, notificationRows, chatRows, noteRows, spendRows, triggerRows, studioBriefRows, studioArtifactRows, studioBrandRow, designArtifactRows, interviewFindingRows, artifactLinkRows, uiReviewRows] = await Promise.all([
      tenantDb.workspaceMember.findMany(),
      tenantDb.workspaceRole.findMany(),
      tenantDb.pipelineStage.findMany({ where: projectScope, orderBy: { order: 'asc' } }),
      tenantDb.ticket.findMany({ where: projectScope }),
      tenantDb.sprint.findMany({ where: projectScope }),
      tenantDb.workspaceSuggestion.findMany({ where: { status: 'open' } }),
      tenantDb.workspaceBudget.findMany({ orderBy: { createdAt: 'asc' } }),
      tenantDb.infoSource.findMany(),
      tenantDb.envVar.findMany(),
      tenantDb.integrationTool.findMany(),
      tenantDb.invite.findMany({ where: { status: 'pending' } }),
      //? `seq` is monotonic PER TICKET, so it can't order a cross-ticket workspace
      //? feed (ticket A#5 would outrank the newer ticket B#4). Order by createdAt —
      //? the @@index([workspaceId, createdAt]) exists for exactly this feed.
      tenantDb.ticketEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      tenantDb.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      //? #111 — this user's persisted Workspace-AI chat turns (per-user), newest-first bounded
      //? window; reversed to chronological below for the client's chat pane.
      tenantDb.workspaceChatMessage.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      //? Ticket comments (WorkspaceNote) — the ticket-detail comment thread filters
      //? this by ticketId. Bounded recent window, newest first.
      tenantDb.workspaceNote.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
      //? Cost/usage tracking (#16): recent SpendRecord rows → the Usage read (per-ticket tokens +
      //? 7-day activity), replacing the seed dummies. Bounded newest-first window.
      tenantDb.spendRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 5000, select: { ticketId: true, tokensIn: true, tokensOut: true, createdAt: true, providerId: true, feature: true, costEstimate: true, userId: true } }),
      //? Automation (#2): the workspace's WorkspaceTriggers (for the automation panel).
      tenantDb.workspaceTrigger.findMany({ orderBy: { createdAt: 'desc' } }),
      //? Studio module: briefs + their generated artifacts + the central brand library.
      tenantDb.studioBrief.findMany({ orderBy: { createdAt: 'desc' } }),
      tenantDb.studioArtifact.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      tenantDb.studioBrandLibrary.findFirst(),
      //? Designer library (ADR 0034): persisted themes/styles/animations + the active flag.
      tenantDb.designArtifact.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
      //? Interviewer findings (ADR 0034): categorised improvement ideas (open first).
      tenantDb.interviewFinding.findMany({ where: { status: { not: 'dismissed' } }, orderBy: { createdAt: 'desc' }, take: 200 }),
      //? Ticket ↔ artifact links (ADR 0034): which design/Studio artifact each ticket implements.
      tenantDb.ticketArtifactLink.findMany({ orderBy: { createdAt: 'asc' }, take: 500 }),
      //? U2 (gap-fix): open UI-review requests — the designer inbox that turns them into redesign tickets.
      tenantDb.uiReviewRequest.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);

    const userRows = await prisma.user.findMany({ where: { id: { in: memberRows.map((m) => m.userId) } } });
    //? #76 — the caller's account-global SSH keys (NOT tenant-scoped → plain prisma, no workspaceId).
    const sshKeyRows = await prisma.sshKey.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    //? Preload gap-fix (X3) — the CALLER's own Personal Access Tokens for this workspace (metadata only;
    //? the raw token/hash never re-enters any read). PersonalAccessToken is NOT in TENANT_MODELS (feature-model
    //? pattern, ADR 0050) and is further scoped to `userId` — mirrors listPats_v1's exact where + select.
    const patRows = await prisma.personalAccessToken.findMany({
      where: { workspaceId: activeWorkspaceId, userId, revoked: false },
      select: { id: true, name: true, tokenPrefix: true, scopes: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const pats: PatSummary[] = patRows.map((r) => ({ id: r.id, name: r.name, prefix: r.tokenPrefix, scopes: r.scopes, createdAt: r.createdAt.getTime(), lastUsedAt: r.lastUsedAt ? r.lastUsedAt.getTime() : null }));
    //? E5 — the workspace's user-defined AI tasks (name + template + last output). SECURITY fix (SK-ronde):
    //? CustomAiTask/OutputTemplate are NOT in TENANT_MODELS, so the old no-where `tenantDb` reads passed
    //? through UNSCOPED — every snapshot leaked every workspace's rows. Feature-model pattern (ADR 0050):
    //? explicit workspaceId.
    const customTaskRows = await prisma.customAiTask.findMany({ where: { workspaceId: currentWorkspaceId() }, orderBy: { createdAt: 'desc' } });
    //? O5 — the workspace's reusable output specs (same explicit scoping fix).
    const outputTemplateRows = await prisma.outputTemplate.findMany({ where: { workspaceId: currentWorkspaceId() }, orderBy: { createdAt: 'desc' } });
    //? SK1 — one canonical store for prompt instructions and workflow capabilities. `skillType` keeps the
    //? semantics distinct without maintaining a second InfoSource-backed skill model.
    const aiSkillRows = await prisma.skill.findMany({ where: { workspaceId: currentWorkspaceId() }, orderBy: { slug: 'asc' } });
    //? DOC1 — the workspace's documents (newest-edited first; bounded).
    //? C7 — archived documents ship too (flagged), so the list can offer a restore instead of hiding them forever.
    const documentRows = await prisma.document.findMany({ where: { workspaceId: currentWorkspaceId() }, orderBy: { updatedAt: 'desc' }, take: 100 });
    //? DESIGN_DOCS_PROGRAM 2.5 — per-document revision history (id/note/date only; content is fetched on
    //? restore, never shipped in the snapshot) so the editor can list + restore prior versions.
    const revisionRows = await prisma.documentRevision.findMany({ where: { workspaceId: currentWorkspaceId() }, orderBy: { createdAt: 'desc' }, select: { id: true, documentId: true, note: true, createdAt: true }, take: 500 });
    const revisionsByDoc = new Map<string, { id: string; note: string; createdAt: number }[]>();
    for (const r of revisionRows) { const list = revisionsByDoc.get(r.documentId) ?? []; list.push({ id: r.id, note: r.note, createdAt: r.createdAt.getTime() }); revisionsByDoc.set(r.documentId, list); }
    //? DESIGN_DOCS_PROGRAM 2.1 — the workspace's document templates (virtual builtins + user rows).
    const documentTemplates = await listWorkspaceTemplates(prisma, currentWorkspaceId());
    const userById = new Map(userRows.map((u) => [u.id, u]));
    const members: Member[] = memberRows.map((m) => {
      const u = userById.get(m.userId);
      const avatar = u && u.avatar.length > 0 ? u.avatar : undefined;
      const avatarFallback = u && u.avatarFallback.length > 0 ? u.avatarFallback : '#6366F1';
      return { id: m.userId, name: u?.name ?? u?.email ?? 'Member', email: u?.email ?? '', avatar, avatarFallback, role: asRole(m.roleKey) };
    });

    const ticketCountBySprint = new Map<string, number>();
    for (const t of ticketRows) { if (t.sprintId) ticketCountBySprint.set(t.sprintId, (ticketCountBySprint.get(t.sprintId) ?? 0) + 1); }

    //? Events + suggestions store ticket ObjectIds, but the frontend keys tickets by
    //? their DEV-#### `key` (Ticket.id in the snapshot). Map ObjectId → key so
    //? open-ticket / activity-tab filters resolve; unknown ids pass through.
    const ticketKeyById = new Map(ticketRows.map((t) => [t.id, t.key]));

    //? Cost/usage tracking (#16): aggregate the real SpendRecord rows into the Usage read + a
    //? per-ticket token total for the board cost-chip (replaces the seed dummies + `costLabel` mock).
    const usage = aggregateUsage(spendRows, ticketKeyById, Date.now());
    const usageByKey = new Map(usage.byTicket.map((u) => [u.ticketKey, u]));
    //? Flow insights (#5): cycle time / throughput / cost-per-ticket from the tickets + usage.
    const insights = computeInsights(ticketRows.map((t) => ({ status: t.status, archived: t.archived, createdAt: t.createdAt, updatedAt: t.updatedAt })), usage, Date.now());
    //? Delivery analytics (ADR 0047): the fuller fold (cycle p50/p85, weekly throughput, stuck, tokens-by-label).
    const analytics = computeAnalytics(ticketRows.map((t) => ({ key: t.key, status: t.status, archived: t.archived, labels: t.labels, createdAt: t.createdAt, updatedAt: t.updatedAt })), usage, Date.now());

    //? #16 — the primary (first enabled) cap for the compact spend display (back-compat single-cap field).
    const primaryBudget = budgetRows.find((b) => b.enabled) ?? budgetRows[0];
    const budget = primaryBudget ? { spent: primaryBudget.spent, cap: primaryBudget.cap, alertPct: primaryBudget.alertPct, currency: '€' } : null;
    //? #103 — ALL caps (multi-cap editor): id/label/enforcement/enabled per row. Enforcement is ADVISORY
    //? (visibility-first) — the pause-on-exceeded wiring is the coupled #99 product decision.
    const budgets = budgetRows.map((b): WorkspaceBudget => ({ spent: b.spent, cap: b.cap, alertPct: b.alertPct, currency: '€', id: b.id, label: b.label, enforcement: b.enforcement === 'pauseAll' ? 'pauseAll' : 'pauseNew', enabled: b.enabled, windowStartAt: b.windowStartAt.toISOString() }));
    //? #105/#19 — engine occupancy (global Redis-backed) for the board busy/queued chip.
    const [activeNow, queuedNow] = await Promise.all([activeCountReadOnly(Date.now()), queueLength()]);
    const capacity = { active: activeNow, queued: queuedNow, limit: capacityLimit() };

    //? Content platform (ADR 0069): the in-flight content pieces + the media €-budget status. Content
    //? models scope by explicit `workspaceId` (not tenantDb — feature-model pattern, ADR 0050).
    const contentWsId = currentWorkspaceId();
    //? #129 — include archived pieces too (the client filters the board to non-archived + shows an
    //? Archived view with Restore); analytics/insights already exclude archived internally.
    const contentPieceRows = await prisma.contentProject.findMany({ where: { workspaceId: contentWsId }, orderBy: { updatedAt: 'desc' }, take: 100 });
    //? U4 folds: content-analytics (over pieces + media spend + publish jobs), the style library (this
    //? workspace's + the global defaults), and channels + their brand voice.
    const [mediaSpendRows, publishJobRows, styleRows, channelRows, contentAssetRows, publishConnRows, mediaJobRows, referenceRows, shortLinkRows] = await Promise.all([
      prisma.mediaSpend.findMany({ where: { workspaceId: contentWsId } }),
      prisma.publishJob.findMany({ where: { workspaceId: contentWsId } }),
      prisma.stylePreset.findMany({ where: { OR: [{ workspaceId: contentWsId }, { workspaceId: null }] }, orderBy: { createdAt: 'asc' } }),
      prisma.channel.findMany({ where: { workspaceId: contentWsId }, orderBy: { createdAt: 'asc' } }),
      prisma.contentAsset.findMany({ where: { workspaceId: contentWsId }, orderBy: { createdAt: 'asc' } }),
      //? A4: '__publish' (no trailing _) also captures the '__publishhealth_' markers; A7 adds the
      //? '__platformcred_' app credentials (KEYS only — the values never leave the server). Each parser
      //? ignores the other prefixes.
      prisma.envVar.findMany({ where: { workspaceId: contentWsId, OR: [{ key: { startsWith: '__publish' } }, { key: { startsWith: '__platformcred_' } }] }, select: { key: true } }),
      prisma.mediaJob.findMany({ where: { workspaceId: contentWsId } }),
      prisma.referenceExample.findMany({ where: { workspaceId: contentWsId }, orderBy: { createdAt: 'asc' } }),
      prisma.shortLink.findMany({ where: { workspaceId: contentWsId }, orderBy: { clicks: 'desc' } }),
    ]);
    //? CI — the read-only comment inbox (bounded newest-first cache; explicit workspaceId scoping).
    const socialCommentRows = await prisma.socialComment.findMany({ where: { workspaceId: contentWsId }, orderBy: { publishedAt: 'desc' }, take: 100 });
    const unreadComments = await prisma.socialComment.count({ where: { workspaceId: contentWsId, read: false } });
    //? Join each asset to its MediaJob for the live queue/timer fields (queuePosition, startedAt).
    const jobById = new Map(mediaJobRows.map((j) => [j.id, j]));
    //? FIX-C/#140: which publish platforms have a stored OAuth connection (EnvVar `__publish_<platform>` or
    //? `__publish_<platform>_<accountId>`), grouped into per-platform ACCOUNTS. Parsed via parseTokenKey (the
    //? old `slice('__publish_'.length)` folded the accountId into the platform → mis-parse).
    const accountsByPlatform = new Map<string, (string | null)[]>();
    for (const r of publishConnRows) {
      const parsed = parseTokenKey(r.key);
      if (!parsed) continue;
      const list = accountsByPlatform.get(parsed.platform) ?? [];
      list.push(parsed.accountId);
      accountsByPlatform.set(parsed.platform, list);
    }
    //? GAP_SCAN A4 — accounts whose token refresh failed are marked unhealthy; surface that as
    //? `needsReconnect` so the settings UI can show a reconnect CTA instead of a generic publish failure.
    const unhealthy = new Set<string>();
    for (const r of publishConnRows) {
      const h = parseHealthKey(r.key);
      if (h) unhealthy.add(`${h.platform}::${h.accountId ?? ''}`);
    }
    //? GAP_SCAN A5 — fold the publish-job history back onto the channels: one at-a-glance answer to
    //? "are all my channels still posting?", instead of noticing a dead channel a week later.
    const channelHealth = buildChannelHealth(
      channelRows.map((c) => ({ id: c.id, name: c.name, platform: c.platform, defaultAccountId: c.defaultAccountId ?? null })),
      publishJobRows.map((j) => ({ platform: j.platform, accountId: j.accountId ?? null, status: j.status, error: j.error ?? null, updatedAt: j.updatedAt })),
      new Set([...unhealthy].map((k) => { const [platform, account] = k.split('::'); return accountKey(platform ?? '', account === '' ? null : account); })),
    );
    //? GAP_SCAN A7 — WHERE each platform's app credentials come from ('workspace' | 'env' | 'none').
    //? Write-only by design: the values themselves never leave the server.
    const credKeys = new Set(publishConnRows.map((r) => r.key));
    const platformCredentials = (['youtube', 'tiktok'] as const).map((platform) => ({
      platform,
      source: credentialSource(
        { clientId: credKeys.has(credentialKey(platform, 'id')) ? 'set' : '', clientSecret: credKeys.has(credentialKey(platform, 'secret')) ? 'set' : '' },
        envCredentials(platform),
      ),
    }));
    const publishTargets = ['youtube', 'tiktok'].map((platform) => {
      const accts = accountsByPlatform.get(platform) ?? [];
      return {
        platform, connected: accts.length > 0,
        accounts: accts.map((accountId) => ({ accountId, ...(unhealthy.has(`${platform}::${accountId ?? ''}`) ? { needsReconnect: true } : {}) })),
      };
    });
    //? U-fix B: group the produced media assets per piece so the detail page can show + download them.
    //? `stub` = the asset was produced in dummy mode (no key) — the registry marks it in `metadata.stub`.
    //? S2: which platforms each asset is currently published on (status 'done') — drives the unpublish control.
    const publishedByAsset = new Map<string, string[]>();
    for (const j of publishJobRows) {
      if (j.status !== 'done') continue;
      const list = publishedByAsset.get(j.assetId) ?? [];
      if (!list.includes(j.platform)) list.push(j.platform);
      publishedByAsset.set(j.assetId, list);
    }
    //? #143 — the honest per-job status per asset (all statuses, not just done) so the piece page can
    //? render done/scheduled/error/stub chips with the external link (was only aggregate counts).
    const publishJobsByAsset = new Map<string, { platform: string; status: string; externalUrl?: string; scheduledAt?: string; error?: string; attempts?: number }[]>();
    for (const j of publishJobRows) {
      const list = publishJobsByAsset.get(j.assetId) ?? [];
      list.push({ platform: j.platform, status: j.status, ...(j.externalUrl ? { externalUrl: j.externalUrl } : {}), ...(j.scheduledAt ? { scheduledAt: j.scheduledAt.toISOString() } : {}), ...(j.error ? { error: j.error } : {}), ...(j.attempts > 0 ? { attempts: j.attempts } : {}) });
      publishJobsByAsset.set(j.assetId, list);
    }
    const assetsByPiece = new Map<string, ContentAssetSummary[]>();
    for (const a of contentAssetRows) {
      const summary = toContentAssetSummary(a, a.mediaJobId ? jobById.get(a.mediaJobId) : null);
      const pub = publishedByAsset.get(a.id);
      if (pub && pub.length > 0) summary.publishedOn = pub;
      const jobs = publishJobsByAsset.get(a.id);
      if (jobs && jobs.length > 0) summary.publishJobs = jobs;
      const list = assetsByPiece.get(a.contentProjectId) ?? [];
      list.push(summary);
      assetsByPiece.set(a.contentProjectId, list);
    }
    //? Q1: per-piece media spend (from MediaSpend rows) so the detail page shows what THIS piece has cost.
    const spentByPiece = new Map<string, number>();
    for (const s of mediaSpendRows) { if (s.contentProjectId) spentByPiece.set(s.contentProjectId, (spentByPiece.get(s.contentProjectId) ?? 0) + s.costCents); }
    //? V1: the ordered video-timeline scenes per piece (for the timeline editor + the multi-clip render).
    const videoSceneRows = await prisma.videoScene.findMany({ where: { workspaceId: contentWsId, contentProjectId: { in: contentPieceRows.map((c) => c.id) } }, orderBy: { order: 'asc' } });
    const scenesByPiece = new Map<string, VideoSceneSummary[]>();
    for (const s of videoSceneRows) {
      const list = scenesByPiece.get(s.contentProjectId) ?? [];
      list.push(toVideoSceneSummary(s));
      scenesByPiece.set(s.contentProjectId, list);
    }
    const contentSnapshot: ContentSnapshot = {
      //? Shared assembly (toContentPieceSummary) so a live per-piece delta (broadcastContentPieceDelta) can
      //? never produce a different shape than this first-load projection.
      pieces: contentPieceRows.map((c) => toContentPieceSummary(c, assetsByPiece.get(c.id) ?? [], scenesByPiece.get(c.id) ?? [], spentByPiece.get(c.id) ?? 0)),
      mediaBudget: await getMediaBudgetStatus(prisma, contentWsId),
      analytics: computeContentAnalytics(
        contentPieceRows.map((c) => ({ stageId: c.stageId, status: c.status, format: c.format, archived: c.archived })),
        mediaSpendRows.map((s) => ({ feature: s.feature, costCents: s.costCents })),
        publishJobRows.map((j) => ({ status: j.status })),
      ),
      styles: styleRows.map((s) => ({ id: s.id, key: s.key, label: s.label, feature: s.feature, builtin: s.builtin, systemPrompt: s.systemPrompt, previewAssetUrl: s.previewAssetUrl, previewKind: s.previewKind })),
      references: referenceRows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, description: r.description, assetUrl: r.assetUrl, tags: r.tags })),
      channels: channelRows.map((c) => ({ id: c.id, name: c.name, platform: c.platform, handle: c.handle, brandVoice: c.brandVoice ?? '', defaultStyleId: c.defaultStyleId ?? null, aiDisclosureDefault: c.aiDisclosureDefault, defaultAccountId: c.defaultAccountId ?? null, autopilot: c.autopilot })),
      publishTargets,
      channelHealth,
      platformCredentials,
      //? GAP_SCAN G4 — the workspace-wide asset library (starred first): the same index C2's document
      //? picker reads, so a brand mascot is reusable everywhere instead of siloed under one piece.
      assetLibrary: await listLibrary(prisma, contentWsId, { limit: 60 }),
      mediaCosts: mediaCostTable(),
      //? H2/H3 (ads) — the workspace's trackable links (clicks desc, so the top A/B variant leads).
      shortLinks: shortLinkRows.map((l) => ({ id: l.id, contentProjectId: l.contentProjectId, slug: l.slug, targetUrl: l.targetUrl, variant: l.variant, clicks: l.clicks })),
      //? P3 — per-feature media model overrides (from the __media_model_<feature> EnvVars).
      mediaModels: envRows.filter((e) => e.key.startsWith('__media_model_')).map((e) => ({ feature: e.key.slice('__media_model_'.length), model: e.value })),
      //? Workspace-wide media generation defaults (from the __media_cheap / __media_scene_continuity /
      //? __media_voice_id EnvVars). Presence-only booleans; the voice id is a public identifier (safe to echo).
      mediaPrefs: {
        cheap: envRows.some((e) => e.key === '__media_cheap' && e.value === '1'),
        sceneContinuity: envRows.some((e) => e.key === '__media_scene_continuity' && e.value === 'on'),
        voiceId: envRows.find((e) => e.key === '__media_voice_id')?.value ?? '',
      },
      //? CI — the read-only comment inbox.
      comments: socialCommentRows.map((c) => ({ id: c.id, platform: c.platform, channelId: c.channelId ?? null, contentProjectId: c.contentProjectId ?? null, author: c.author, text: c.text, publishedAt: c.publishedAt.getTime(), read: c.read })),
      unreadComments,
      trash: await listTrash(prisma, contentWsId),
      storage: await workspaceStorage(prisma, contentWsId),
    };

    //? Project-owned context follows the selected project. Null-project sources and the ADR 0034
    //? design-system remain workspace-wide; sibling project docs/capabilities never enter this snapshot.
    const visibleSourceRows = sourceRows.filter((source) => source.source === 'design-system' || source.projectId === null || source.projectId === activeProjectId);
    const docs: InfoDoc[] = visibleSourceRows.filter((source) => source.mode === 'context-doc').map((source) => toInfoDoc(source));
    const skills: SkillEntry[] = aiSkillRows
      .filter((skill) => skill.skillType === 'capability' && (skill.projectId === null || skill.projectId === activeProjectId))
      .map((skill) => ({
        id: skill.id, name: skill.name, kind: asSkillKind(skill.kind), status: skill.status ?? '', model: skill.model ?? undefined, on: skill.enabled, description: skill.description ?? undefined, usedByStages: skill.usedByStages,
      }));

    //? ADR 0007 — the connected AIs (rows, never keys) plus the catalog the add-form renders from.
    //? Deliberately no endpoint in either: which host answers is infrastructure, not a user setting.
    const aiConnections = await listConnections(activeWorkspaceId);
    const aiProviderCatalog = AI_PROVIDER_LIST.map((meta) => ({
      id: meta.id, label: meta.label, kind: meta.kind, models: meta.models,
      defaultModel: meta.defaultModel, keyUrl: meta.keyUrl,
    }));

    //? Register-flow step A: the ACTIVE project's linked-repo status (on-disk bare
    //? clone), keyed off its stored (clean) gitUrl. R3-b — the physical repo is now per-project,
    //? so the snapshot shows the ACTIVE project's repo status (empty when no project is selected).
    const projectRow = projectRows.find((p) => p.id === activeProjectId) ?? null;
    const repo = activeProjectId ? await repoStatus(activeWorkspaceId, activeProjectId, projectRow?.gitUrl ?? undefined) : { linked: false };
    //? The active workspace's git strategy (normalized; DEFAULT when the field is unset).
    const activeWs = workspaceRows.find((w) => w.id === activeWorkspaceId);
    const gitConfig = normalizeGitConfig(activeWs?.gitConfig ?? null);
    const workspacePaused = activeWs?.paused === true;
    //? Setup readiness (UX) — the "is this actually set up?" booleans, from signals already loaded above:
    //? repo status, connected publish accounts, and the stored provider-key EnvVar KEYS (presence only, never
    //? decrypted). Host-level probes (docker/CLI) are folded in cached inside buildReadiness.
    const providerKeys = new Set(envRows.filter((e) => e.key.startsWith('__provider_key_')).map((e) => e.key));
    const readiness = await buildReadiness(Date.now(), {
      repoLinked: repo.linked,
      publishingConnected: publishTargets.some((t) => t.connected),
      providerKeys,
    });
    //? The caller's RESOLVED capabilities in this workspace — the raw role key (not `asRole`-flattened, so a
    //? custom role resolves to its own perms) mapped to its `WorkspaceRole.perms`. Mirrors the server's
    //? `hasCapability` (perms[cap] === true) so a "fix it" button only shows when the user actually may.
    const myRoleKey = roleByWs.get(activeWorkspaceId) ?? 'member';
    const myPerms = roleRows.find((r) => r.key === myRoleKey)?.perms ?? [];

    return {
      workspaces, activeWorkspaceId,
      projects: projectRows.map((p): ProjectSummary => {
        const forge = forgeConnectionByProject.get(p.id);
        return {
          id: p.id,
          name: p.name,
          ...(p.gitUrl ? { gitUrl: p.gitUrl } : {}),
          ...(forge?.mode === 'github' || forge?.mode === 'gitlab' ? { forgeMode: forge.mode } : {}),
          ...(forge?.status ? { forgeStatus: forge.status } : {}),
          ...(forge?.repoPath ? { forgeRepoPath: forge.repoPath } : {}),
          ...(p.baseImageRef ? { baseImageRef: p.baseImageRef } : {}),
          ...(p.stack ? { stack: p.stack } : {}),
          //? ADR 0313 — the runtime commands the settings form edits. Absent until now, so that form
          //? could never show what was saved.
          ...(p.devCommand ? { devCommand: p.devCommand } : {}),
          //? ADR 0317 — the runtime process list + which one owns the preview URL.
          runProcesses: p.runProcesses.map((proc) => ({ id: proc.id, name: proc.name, cwd: proc.cwd, env: proc.env.map((e) => ({ key: e.key, value: e.value })), commands: proc.commands })),
          ...(p.previewProcessId ? { previewProcessId: p.previewProcessId } : {}),
          ...(p.prodCommand ? { prodCommand: p.prodCommand } : {}),
          ...(p.allowCustomBase ? { allowCustomBase: true } : {}),
        };
      }),
      activeProjectId,
      services: serviceRows.map((s): ServiceSummary => ({ id: s.id, projectId: s.projectId, name: s.name, path: s.path })),
      serviceStacks: serviceStackRows.map((s): ServiceStackSummary => ({ id: s.id, name: s.name, status: s.status, services: s.services })),
      dbConnections: dbConnectionRows.map((c): DbConnectionSummary => ({ id: c.id, projectId: c.projectId, name: c.name, kind: c.kind, envKind: c.envKind })),
      migrations: migrationRows.map((m): MigrationSummary => ({ id: m.id, projectId: m.projectId, name: m.name, envKind: m.envKind, status: m.status, ...(m.error ? { error: m.error } : {}), createdAt: m.createdAt.toISOString() })),
      environments: environmentRows.map((e): EnvironmentSummary => ({
        id: e.id, projectId: e.projectId, ...(e.serviceId ? { serviceId: e.serviceId } : {}), kind: e.kind, route: e.route, status: e.status,
        url: `${baseDomain() === 'localhost' ? 'http' : 'https'}://${e.route}/`,
        ...(e.lastError ? { lastError: e.lastError } : {}), ...(e.lastDeployedAt ? { lastDeployedAt: e.lastDeployedAt.toISOString() } : {}),
        //? F27 — the deploy history this environment already recorded, finally readable.
        deploys: (deployHistoryRows.get(e.id) ?? []).map((d) => ({
          id: d.id, commit: d.commit, branch: d.branch, status: d.status,
          ...(d.error ? { error: d.error } : {}), at: d.createdAt.toISOString(),
        })),
      })),
      buildArtifacts: buildArtifactRows.map((b): BuildArtifactSummary => ({
        id: b.id, projectId: b.projectId, kind: b.kind, status: b.status, sizeBytes: b.sizeBytes,
        ...(b.status === 'ready' ? { downloadUrl: `/downloads/build/${b.downloadToken}` } : {}),
        ...(b.error ? { error: b.error } : {}), createdAt: b.createdAt.toISOString(),
        //? #64 — the deploy-hook result (null until the export attempts it).
        ...(b.deployHookFired === null ? {} : { deployHookFired: b.deployHookFired }),
        ...(b.deployHookOk === null ? {} : { deployHookOk: b.deployHookOk }),
        ...(b.deployHookStatus === null ? {} : { deployHookStatus: b.deployHookStatus }),
      })),
      templates: listTemplates(),
      members, budget, budgets, capacity, docs, skills, aiConnections, aiProviderCatalog,
      //? `locked` must mirror what the Conductor will actually accept. It only marked `owner`, while
      //? `role-update` rejects EVERY built-in role (`if (existingRole.builtIn) return { ok: false,
      //? error: 'role.builtInImmutable' }`) — so the Admin and Member cells rendered clickable, with
      //? hover states, and every click was discarded server-side with no cell change and no error.
      roles: roleRows.map((r) => ({ key: r.key, name: r.label, locked: r.key === 'owner' || r.builtIn, perms: r.perms })),
      stages: stageRows.map((s): PipelineStage => ({ id: s.key, kind: asKind(s.kind), name: s.name, order: s.order, aiEnabled: s.aiEnabled, wipLimit: s.wipLimit ?? undefined })),
      stageConfigs: stageRows.map((s) => toStageConfig(s)),
      //? P1 — per-workspace AI provider overrides (from the __ai_provider_<feature> EnvVars).
      aiOverrides: envRows.filter((e) => e.key.startsWith('__ai_provider_')).map((e) => ({ feature: e.key.slice('__ai_provider_'.length), providerId: e.value })),
      //? E5 — user-defined custom AI tasks.
      customTasks: customTaskRows.map((t) => ({ id: t.id, name: t.name, promptTemplate: t.promptTemplate, lastOutput: t.lastOutput, lastRunAt: t.lastRunAt ? t.lastRunAt.getTime() : null })),
      //? O5 — reusable output specs.
      outputTemplates: outputTemplateRows.map((t) => ({ id: t.id, name: t.name, format: t.format, watermarkPosition: t.watermarkPosition })),
      //? SK1 — instruction skills only; workflow capabilities use the sibling `skills` projection.
      aiSkills: aiSkillRows.filter((s) => s.skillType === 'instruction').map((s) => ({ id: s.id, slug: s.slug, name: s.name, instruction: s.instruction, examples: s.examples, applyPoints: s.applyPoints, builtin: s.builtin })),
      //? DOC1 — the Documents module (assets JSON → typed list; unknown shapes dropped).
      documentTemplates,
      documents: documentRows.map((d) => ({
        id: d.id, title: d.title, kind: d.kind, content: d.content, aiDraft: d.aiDraft, aiDraftLabel: d.aiDraftLabel,
        assets: (Array.isArray(d.assets) ? d.assets : []).flatMap((a) => {
          if (a === null || typeof a !== 'object') return [];
          const rec = a as { url?: unknown; kind?: unknown; label?: unknown; stub?: unknown; extractStatus?: unknown };
          if (typeof rec.url !== 'string') return [];
          //? extractStatus surfaces the upload-parse state (pending/ok/failed) for a badge; extractedText is
          //? deliberately NOT sent to the client (it can be huge — the server uses it only for grounding).
          return [{ kind: typeof rec.kind === 'string' ? rec.kind : 'file', url: rec.url, label: typeof rec.label === 'string' ? rec.label : '', ...(rec.stub === true ? { stub: true } : {}), ...(typeof rec.extractStatus === 'string' ? { extractStatus: rec.extractStatus } : {}) }];
        }),
        revisions: revisionsByDoc.get(d.id) ?? [],
        updatedAt: d.updatedAt.getTime(),
        ...(d.archived ? { archived: true } : {}),
      })),
      tickets: ticketRows.map((t) => {
        const mapped = toTicket(t);
        //? Real per-ticket cost chip (#16): "<tokens> tok" when the ticket has run turns, else no chip.
        const u = usageByKey.get(mapped.id);
        if (u && u.tokensIn + u.tokensOut > 0) mapped.costLabel = `${String(u.tokensIn + u.tokensOut)} tok · ${String(u.turns)}×`;
        return mapped;
      }),
      usage, insights, analytics,
      //? Content platform (ADR 0069): the content-lane pieces + media €-budget status.
      content: contentSnapshot,
      triggers: triggerRows.map((t): WorkspaceTrigger => ({
        id: t.id, workspaceId: t.workspaceId, enabled: t.enabled, name: t.name, on: asTriggerOn(t.on), action: asTriggerAction(t.action),
        match: t.match, params: t.params, requiresApproval: t.requiresApproval,
        ...(t.cron ? { cron: t.cron } : {}), ...(t.dedupeKey ? { dedupeKey: t.dedupeKey } : {}), ...(t.debounceMs === null ? {} : { debounceMs: t.debounceMs }),
        ...(t.lastFiredAt ? { lastFiredAt: t.lastFiredAt.toISOString() } : {}),
      })),
      agentRoles: listAgentRoles(),
      aiRuns: listAiRuns(activeWorkspaceId),
      studioBriefs: studioBriefRows.map((b): StudioBrief => ({
        id: b.id, workspaceId: b.workspaceId, name: b.name, productName: b.productName, audience: b.audience, tone: b.tone, goals: b.goals,
        ...(b.projectId ? { projectId: b.projectId } : {}), ...(b.notes ? { notes: b.notes } : {}), createdAt: b.createdAt.toISOString(),
      })),
      studioArtifacts: studioArtifactRows.map((a): StudioArtifact => ({
        id: a.id, workspaceId: a.workspaceId, briefId: a.briefId, kind: asArtifactKind(a.kind), role: a.role === 'marketer' ? 'marketer' : 'designer',
        title: a.title, content: a.content, status: asArtifactStatus(a.status),
        ...(a.providerId ? { providerId: a.providerId } : {}), ...(a.error ? { error: a.error } : {}), createdAt: a.createdAt.toISOString(),
        ...(a.refine !== null && a.refine.length > 0 ? { refine: a.refine } : {}),
      })),
      studioBrand: studioBrandRow === null ? null : {
        workspaceId: studioBrandRow.workspaceId, name: studioBrandRow.name,
        palette: (Array.isArray(studioBrandRow.palette) ? studioBrandRow.palette : []).map((p) => ({ name: jsonStr(p, 'name'), hex: jsonStr(p, 'hex') })).filter((p) => p.hex.length > 0),
        typography: { heading: jsonStr(studioBrandRow.typography, 'heading'), body: jsonStr(studioBrandRow.typography, 'body') },
        voice: studioBrandRow.voice, taglines: studioBrandRow.taglines, logoIdeas: studioBrandRow.logoIdeas,
        //? ADR 0310 — provenance travels with the record so the panel can say where the brand came
        //? from on every device, not only the browser that promoted it.
        ...(studioBrandRow.lastSetFrom === null ? {} : { lastSetFrom: studioBrandRow.lastSetFrom }),
        ...(studioBrandRow.lastSetAt === null ? {} : { lastSetAt: studioBrandRow.lastSetAt.toISOString() }),
      },
      designArtifacts: designArtifactRows.map((d) => ({
        id: d.id, kind: d.kind, name: d.name, description: d.description ?? '', content: d.content, source: d.source, active: d.active, createdAt: d.createdAt.toISOString(),
      })),
      interviewFindings: interviewFindingRows.map((finding) => ({
        id: finding.id, area: finding.area, severity: finding.severity, title: finding.title, summary: finding.summary, status: finding.status,
        ticketId: finding.ticketId ? (ticketKeyById.get(finding.ticketId) ?? null) : null,
        createdAt: finding.createdAt.toISOString(),
      })),
      uiReviews: uiReviewRows.map((review) => ({
        id: review.id, projectId: review.projectId ?? null, page: review.page ?? null, problems: review.problems,
        screenshots: review.screenshots, notes: review.notes ?? null, createdAt: review.createdAt.toISOString(),
      })),
      ticketArtifactLinks: artifactLinkRows.flatMap((link) => {
        const ticketKey = ticketKeyById.get(link.ticketId);
        if (!ticketKey) return [];
        const name = link.artifactKind === 'design'
          ? (designArtifactRows.find((artifact) => artifact.id === link.artifactId)?.name ?? '—')
          : (link.artifactKind === 'studio'
            ? (studioArtifactRows.find((artifact) => artifact.id === link.artifactId)?.title ?? '—')
            : 'UI review');
        return [{ id: link.id, ticketId: ticketKey, artifactId: link.artifactId, artifactKind: link.artifactKind, name, label: link.label ?? null }];
      }),
      sprints: sprintRows.map((sp): Sprint => ({ id: sp.id, name: sp.name, start: sp.startAt ? sp.startAt.toISOString().slice(0, 10) : null, end: sp.endAt ? sp.endAt.toISOString().slice(0, 10) : null, active: sp.active, ticketCount: ticketCountBySprint.get(sp.id) ?? 0, daysLeft: sp.endAt ? Math.max(0, Math.ceil((sp.endAt.getTime() - Date.now()) / 86_400_000)) : null })),
      suggestions: suggestionRows.map((s): AiSuggestion => ({ id: s.id, type: asSugType(s.type), title: s.title, body: s.body, ticketIds: s.ticketIds.map((id) => ticketKeyById.get(id) ?? id), ...(s.patch === null ? {} : { patch: s.patch }) })),
      //? Internal `__` rows stay server-only; secret EnvVars are write-only metadata. The mapper
      //? deliberately emits neither plaintext nor ciphertext, including on legacy rows.
      envVars: envRows.map((envRow) => toEnvVar(envRow)).filter((envVar): envVar is EnvVar => envVar !== null),
      integrations: integrationRows.map((it): IntegrationTool => ({ id: it.id, name: it.name, type: it.type, fields: it.fields.map((f) => ({ id: f.id, label: f.label, placeholder: f.placeholder ?? undefined, envVarId: f.envVarId })), mcp: it.mcp })),
      invites: inviteRows.map((inv): InviteEntry => ({ id: inv.id, email: inv.email, role: asRole(inv.roleKey), sentAt: inv.createdAt.toISOString(), expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null })),
      //? Events store ticket ObjectIds, but the frontend keys tickets by their
      //? DEV-#### `key` — map ObjectId → key so open-ticket / activity-tab filters
      //? resolve (unknown ids pass through).
      events: eventRows.map((ev): ActivityEvent => ({ time: formatTime(ev.createdAt), actor: ev.actor, ticketId: ticketKeyById.get(ev.ticketId) ?? ev.ticketId, type: asEvType(ev.type), text: ev.text })),
      notifications: notificationRows.map((n): NotificationItem => ({
        id: n.id, type: asNotifType(n.type), title: n.title, body: n.body, ticketId: n.ticketId ?? undefined,
        deepLink: asDeepLink(n.deepLink), time: formatTime(n.createdAt), read: n.read,
      })),
      notes: noteRows.map((n): TicketNote => ({
        id: n.id, ticketId: n.ticketId ? (ticketKeyById.get(n.ticketId) ?? n.ticketId) : '',
        author: n.authorId ?? '', body: n.body, time: formatTime(n.createdAt),
      })),
      readiness,
      myPerms,
      myRoleKey,
      repo,
      gitConfig,
      workspacePaused,
      //? #111 — reverse the newest-first read window to chronological for the chat pane.
      chat: chatRows.toReversed().map((c): ChatMessage => ({ id: c.id, role: c.role === 'user' ? 'user' : 'ai', text: c.text })),
      //? #76 — the caller's persisted SSH keys (account-global).
      sshKeys: sshKeyRows.map((k): SshKeyEntry => ({ id: k.id, name: k.name, type: k.type, fingerprint: k.fingerprint, added: formatTime(k.createdAt), lastUsed: k.lastUsedAt ? formatTime(k.lastUsedAt) : '—', userId: k.userId })),
      myInvites,
      pats,
    };
  });
}
