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

import { runInTenant, currentWorkspaceId } from '../tenant/tenantContext';
import { tenantDb } from '../tenant/tenantDb';
import { listAgentRoles } from '../automation/agentRoles';
import { listAiRuns } from '../ai/activity';
import { formatTime, toContentAssetSummary, toInfoDoc, toTicket } from './mappers';
import { questionPrompt } from '../../src/workspaces/_functions/structuredQuestion';
import { repoStatus } from '../git/repoStore';
import { baseDomain } from '../proxy';
import { listTemplates } from '../scaffold/templates';
import { decryptSecret } from '../crypto/secretBox';
import { normalizeGitConfig, DEFAULT_GIT_CONFIG, type GitConfig } from '../git/branchStrategy';
import { aggregateUsage, type WorkspaceUsage } from '../spend/record';
import { computeInsights, type WorkspaceInsights } from '../obs/insights';
import { computeAnalytics } from '../obs/analytics';
import { computeContentAnalytics } from '../content/contentAnalytics';
import type {
  ActivityEvent, AiSuggestion, CommandMode, EnvVar, InfoDoc, IntegrationTool, InviteEntry, Member,
  ModelRule, MyInvite, NetworkMode, NotificationItem, PermRole, PipelineStage, PipelineStageCfg, Role,
  SkillEntry, Sprint, StageCommandCfg, StageEffort, StageEnvVar, StageKind, StageModelTier,
  RepoInfo, StageProcessCfg, StageStatusCfg, StageToolCfg, Ticket, TicketNote, ToolTier, Workspace, WorkspaceBudget,
  WorkspaceTrigger, TriggerEventKind, TriggerActionKind,
  StudioBrief, StudioArtifact, StudioArtifactKind, StudioBrandLibrary,
  ProjectSummary, ServiceSummary, ServiceStackSummary, DbConnectionSummary, MigrationSummary, EnvironmentSummary, BuildArtifactSummary, WorkspaceAnalytics, AnswerQueueItem, ContentSnapshot, ContentAssetSummary, VideoSceneSummary,
} from '../../src/workspaces/_data/types';
import { getMediaBudgetStatus } from '../media/budget';
import { mediaCostTable } from '../media/registry';

//? Priority rank for the answer-queue ordering (ADR 0048 — urgent first).
const PRIORITY_RANK: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

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
const asSugType = (s: string): AiSuggestion['type'] => (s === 'link-tickets' || s === 'create-epic' || s === 'config-review' || s === 'automation' ? s : 'maintenance');
const asEvType = (s: string): ActivityEvent['type'] => (s === 'command' || s === 'file-change' || s === 'status-change' || s === 'mr' || s === 'comment' || s === 'ci' ? s : 'ai-message');
const asSkillKind = (s: string | null): SkillEntry['kind'] => (s === 'frozen' ? 'frozen' : 'live');
const asNotifType = (s: string): NotificationItem['type'] => (s === 'needs-input' || s === 'merge' || s === 'ai-suggestion' || s === 'assignment' ? s : 'container-failure');
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
    id: s.key, kind: asKind(s.kind), name: s.name, order: s.order, aiEnabled: s.aiEnabled,
    customInstructions: s.customInstructions, promptTemplate: s.promptTemplate, definitionOfDone: s.definitionOfDone,
    systemPrompt: s.systemPrompt, roleKey: s.roleKey, userEditable: s.userEditable, gateForApproval: s.gateForApproval,
    skillKeys: s.skillKeys, sourceIds: s.sourceIds,
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
  workspaces: (Pick<Workspace, 'id' | 'name' | 'slug' | 'ownerId' | 'role' | 'forgeType'>)[];
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
  //? E5 — user-defined custom AI tasks (name + template + last output).
  customTasks: { id: string; name: string; promptTemplate: string; lastOutput: string | null; lastRunAt: number | null }[];
  //? O5 — reusable output specs (name + render format + watermark position).
  outputTemplates: { id: string; name: string; format: string; watermarkPosition: string }[];
  sprints: Sprint[];
  suggestions: AiSuggestion[];
  budget: WorkspaceBudget | null;
  docs: InfoDoc[];
  skills: SkillEntry[];
  roles: PermRole[];
  envVars: EnvVar[];
  integrations: IntegrationTool[];
  invites: InviteEntry[];
  events: ActivityEvent[];
  notifications: NotificationItem[];
  notes: TicketNote[];
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
  answerQueue: AnswerQueueItem[];
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
  //? Ticket ↔ artifact links (ADR 0034): design/Studio artifacts a ticket implements (keyed by DEV-#### key).
  ticketArtifactLinks: { id: string; ticketId: string; artifactId: string; artifactKind: string; name: string; label: string | null }[];
  //? Cross-workspace: invitations addressed to THIS user's email (onboarding). Always
  //? present — even for a user with zero workspaces (the no-workspace early return).
  myInvites: MyInvite[];
}

const EMPTY: Omit<WorkspaceSnapshot, 'workspaces' | 'activeWorkspaceId' | 'activeProjectId' | 'myInvites'> = {
  projects: [], services: [], serviceStacks: [], dbConnections: [], migrations: [], environments: [], buildArtifacts: [], templates: listTemplates(),
  members: [], tickets: [], stages: [], stageConfigs: [], aiOverrides: [], customTasks: [], outputTemplates: [], sprints: [], suggestions: [], budget: null,
  docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [], notifications: [], notes: [], repo: { linked: false }, gitConfig: DEFAULT_GIT_CONFIG, workspacePaused: false,
  usage: { byTicket: [], activity: [], totalTokens: 0, totalTurns: 0, byAi: [] },
  insights: { avgCycleHours: 0, throughput7d: 0, avgTokensPerTicket: 0, doneCount: 0, openCount: 0 },
  analytics: { cycleP50Hours: 0, cycleP85Hours: 0, throughputByWeek: [], stuckCount: 0, doneCount: 0, openCount: 0, tokensByLabel: [], totalTokens: 0 },
  answerQueue: [],
  content: { pieces: [], mediaBudget: { enabled: false, capCents: 0, spentCents: 0, alertPct: 80, overAlert: false }, analytics: { totalPieces: 0, doneCount: 0, publishedCount: 0, byStage: [], byFormat: [], totalCostCents: 0, costByFeature: [] }, styles: [], references: [], channels: [], publishTargets: [], mediaCosts: [], mediaModels: [], shortLinks: [] },
  triggers: [],
  agentRoles: [],
  aiRuns: [],
  studioBriefs: [],
  studioArtifacts: [],
  studioBrand: null,
  designArtifacts: [],
  interviewFindings: [],
  ticketArtifactLinks: [],
};

export async function buildSnapshot(prisma: PrismaClient, userId: string, wantWorkspaceId?: string, wantProjectId?: string): Promise<WorkspaceSnapshot> {
  const memberships = await prisma.workspaceMember.findMany({ where: { userId } });
  const wsIds = memberships.map((m) => m.workspaceId);
  const workspaceRows = wsIds.length > 0 ? await prisma.workspace.findMany({ where: { id: { in: wsIds } } }) : [];
  const roleByWs = new Map(memberships.map((m) => [m.workspaceId, m.roleKey]));
  const workspaces = workspaceRows.map((w) => ({ id: w.id, name: w.name, slug: w.slug, ownerId: w.ownerId, role: asRole(roleByWs.get(w.id) ?? 'member'), forgeType: w.forgeType, allowMergeOnRedCI: w.allowMergeOnRedCI, enabledSections: w.enabledSections, productContext: w.productContext, aiInstruction: w.aiInstruction, outputLanguage: w.outputLanguage, geminiModel: w.geminiModel, geminiTemperature: w.geminiTemperature, geminiBaseUrl: w.geminiBaseUrl, autonomyLevel: w.autonomyLevel }));

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
    //? Multi-project (ADR 0035): resolve the ACTIVE project first — the requested one
    //? if it belongs to this workspace, else the oldest (the single-project era's only
    //? project). board/pipeline/tickets/sprints are then scoped to it. A sentinel
    //? ObjectId scopes to "nothing" for the (defensive) zero-project workspace.
    const projectRows = await tenantDb.project.findMany({ orderBy: { createdAt: 'asc' } });
    const activeProjectId = wantProjectId && projectRows.some((p) => p.id === wantProjectId) ? wantProjectId : (projectRows[0]?.id ?? null);
    const projectScope = { projectId: activeProjectId ?? '000000000000000000000000' };
    const serviceRows = activeProjectId ? await tenantDb.service.findMany({ where: projectScope, orderBy: { createdAt: 'asc' } }) : [];
    const environmentRows = activeProjectId ? await tenantDb.environment.findMany({ where: projectScope, orderBy: { createdAt: 'asc' } }) : [];
    //? K1/K3 — provisioned service stacks (workspace-scoped, not per-project).
    const serviceStackRows = await tenantDb.serviceStack.findMany({ orderBy: { createdAt: 'asc' } });
    const buildArtifactRows = activeProjectId ? await tenantDb.buildArtifact.findMany({ where: projectScope, orderBy: { createdAt: 'desc' }, take: 20 }) : [];
    //? ADR 0043 — the active project's DB connections + migrations (for the DB panel). URLs stay server-only.
    const dbConnectionRows = activeProjectId ? await tenantDb.dbConnection.findMany({ where: projectScope, orderBy: { createdAt: 'asc' } }) : [];
    const migrationRows = activeProjectId ? await tenantDb.migration.findMany({ where: projectScope, orderBy: { createdAt: 'desc' }, take: 20 }) : [];

    const [memberRows, roleRows, stageRows, ticketRows, sprintRows, suggestionRows, budgetRows, sourceRows, envRows, integrationRows, inviteRows, eventRows, notificationRows, noteRows, spendRows, triggerRows, studioBriefRows, studioArtifactRows, studioBrandRow, designArtifactRows, interviewFindingRows, artifactLinkRows] = await Promise.all([
      tenantDb.workspaceMember.findMany(),
      tenantDb.workspaceRole.findMany(),
      tenantDb.pipelineStage.findMany({ where: projectScope, orderBy: { order: 'asc' } }),
      tenantDb.ticket.findMany({ where: projectScope }),
      tenantDb.sprint.findMany({ where: projectScope }),
      tenantDb.workspaceSuggestion.findMany({ where: { status: 'open' } }),
      tenantDb.workspaceBudget.findMany({ where: { enabled: true } }),
      tenantDb.infoSource.findMany(),
      tenantDb.envVar.findMany(),
      tenantDb.integrationTool.findMany(),
      tenantDb.invite.findMany({ where: { status: 'pending' } }),
      //? `seq` is monotonic PER TICKET, so it can't order a cross-ticket workspace
      //? feed (ticket A#5 would outrank the newer ticket B#4). Order by createdAt —
      //? the @@index([workspaceId, createdAt]) exists for exactly this feed.
      tenantDb.ticketEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      tenantDb.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      //? Ticket comments (WorkspaceNote) — the ticket-detail comment thread filters
      //? this by ticketId. Bounded recent window, newest first.
      tenantDb.workspaceNote.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
      //? Cost/usage tracking (#16): recent SpendRecord rows → the Usage read (per-ticket tokens +
      //? 7-day activity), replacing the seed dummies. Bounded newest-first window.
      tenantDb.spendRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 5000, select: { ticketId: true, tokensIn: true, tokensOut: true, createdAt: true, providerId: true, feature: true, costEstimate: true } }),
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
    ]);

    const userRows = await prisma.user.findMany({ where: { id: { in: memberRows.map((m) => m.userId) } } });
    //? E5 — the workspace's user-defined AI tasks (name + template + last output).
    const customTaskRows = await tenantDb.customAiTask.findMany({ orderBy: { createdAt: 'desc' } });
    //? O5 — the workspace's reusable output specs.
    const outputTemplateRows = await tenantDb.outputTemplate.findMany({ orderBy: { createdAt: 'desc' } });
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

    const budget = budgetRows[0] ? { spent: budgetRows[0].spent, cap: budgetRows[0].cap, alertPct: budgetRows[0].alertPct, currency: '€' } : null;

    //? Content platform (ADR 0069): the in-flight content pieces + the media €-budget status. Content
    //? models scope by explicit `workspaceId` (not tenantDb — feature-model pattern, ADR 0050).
    const contentWsId = currentWorkspaceId();
    const contentPieceRows = await prisma.contentProject.findMany({ where: { workspaceId: contentWsId, archived: false }, orderBy: { updatedAt: 'desc' }, take: 100 });
    //? U4 folds: content-analytics (over pieces + media spend + publish jobs), the style library (this
    //? workspace's + the global defaults), and channels + their brand voice.
    const [mediaSpendRows, publishJobRows, styleRows, channelRows, contentAssetRows, publishConnRows, mediaJobRows, referenceRows, shortLinkRows] = await Promise.all([
      prisma.mediaSpend.findMany({ where: { workspaceId: contentWsId } }),
      prisma.publishJob.findMany({ where: { workspaceId: contentWsId } }),
      prisma.stylePreset.findMany({ where: { OR: [{ workspaceId: contentWsId }, { workspaceId: null }] }, orderBy: { createdAt: 'asc' } }),
      prisma.channel.findMany({ where: { workspaceId: contentWsId }, orderBy: { createdAt: 'asc' } }),
      prisma.contentAsset.findMany({ where: { workspaceId: contentWsId }, orderBy: { createdAt: 'asc' } }),
      prisma.envVar.findMany({ where: { workspaceId: contentWsId, key: { startsWith: '__publish_' } }, select: { key: true } }),
      prisma.mediaJob.findMany({ where: { workspaceId: contentWsId } }),
      prisma.referenceExample.findMany({ where: { workspaceId: contentWsId }, orderBy: { createdAt: 'asc' } }),
      prisma.shortLink.findMany({ where: { workspaceId: contentWsId }, orderBy: { clicks: 'desc' } }),
    ]);
    //? Join each asset to its MediaJob for the live queue/timer fields (queuePosition, startedAt).
    const jobById = new Map(mediaJobRows.map((j) => [j.id, j]));
    //? FIX-C: which publish platforms have a stored OAuth connection (EnvVar `__publish_<platform>`), so the
    //? settings UI shows connect/connected + the piece-detail only offers publish to a connected target.
    const connectedPlatforms = new Set(publishConnRows.map((r) => r.key.slice('__publish_'.length)));
    const publishTargets = ['youtube', 'tiktok'].map((platform) => ({ platform, connected: connectedPlatforms.has(platform) }));
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
    const assetsByPiece = new Map<string, ContentAssetSummary[]>();
    for (const a of contentAssetRows) {
      const summary = toContentAssetSummary(a, a.mediaJobId ? jobById.get(a.mediaJobId) : null);
      const pub = publishedByAsset.get(a.id);
      if (pub && pub.length > 0) summary.publishedOn = pub;
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
      list.push({ id: s.id, order: s.order, videoAssetId: s.videoAssetId, imageAssetId: s.imageAssetId, startTrimMs: s.startTrimMs, endTrimMs: s.endTrimMs, durationMs: s.durationMs, transitionIn: s.transitionIn, prompt: s.prompt });
      scenesByPiece.set(s.contentProjectId, list);
    }
    const contentSnapshot: ContentSnapshot = {
      pieces: contentPieceRows.map((c) => {
        //? V5 — the piece's newest voice/music asset url for the audio-track waveform.
        const pieceAssets = assetsByPiece.get(c.id) ?? [];
        const urlOfKind = (k: string): string | null => { for (let i = pieceAssets.length - 1; i >= 0; i--) { const a = pieceAssets[i]; if (a?.kind === k && a.url.length > 0) return a.url; } return null; };
        return { id: c.id, title: c.title, format: c.format, stageId: c.stageId, status: c.status, channelId: c.channelId, assets: pieceAssets, scenes: scenesByPiece.get(c.id) ?? [], voiceVolume: c.voiceVolume, musicVolume: c.musicVolume, voiceUrl: urlOfKind('voice'), musicUrl: urlOfKind('music'), spentCents: spentByPiece.get(c.id) ?? 0 };
      }),
      mediaBudget: await getMediaBudgetStatus(prisma, contentWsId),
      analytics: computeContentAnalytics(
        contentPieceRows.map((c) => ({ stageId: c.stageId, status: c.status, format: c.format, archived: c.archived })),
        mediaSpendRows.map((s) => ({ feature: s.feature, costCents: s.costCents })),
        publishJobRows.map((j) => ({ status: j.status })),
      ),
      styles: styleRows.map((s) => ({ key: s.key, label: s.label, feature: s.feature, builtin: s.builtin, systemPrompt: s.systemPrompt, previewAssetUrl: s.previewAssetUrl, previewKind: s.previewKind })),
      references: referenceRows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, description: r.description, assetUrl: r.assetUrl, tags: r.tags })),
      channels: channelRows.map((c) => ({ id: c.id, name: c.name, platform: c.platform, handle: c.handle, brandVoice: c.brandVoice ?? '' })),
      publishTargets,
      mediaCosts: mediaCostTable(),
      //? H2/H3 (ads) — the workspace's trackable links (clicks desc, so the top A/B variant leads).
      shortLinks: shortLinkRows.map((l) => ({ id: l.id, contentProjectId: l.contentProjectId, slug: l.slug, targetUrl: l.targetUrl, variant: l.variant, clicks: l.clicks })),
      //? P3 — per-feature media model overrides (from the __media_model_<feature> EnvVars).
      mediaModels: envRows.filter((e) => e.key.startsWith('__media_model_')).map((e) => ({ feature: e.key.slice('__media_model_'.length), model: e.value })),
    };

    const docs: InfoDoc[] = sourceRows.filter((s) => s.mode === 'context-doc').map((s) => toInfoDoc(s));
    const skills: SkillEntry[] = sourceRows.filter((s) => s.mode === 'skill').map((s) => ({
      id: s.id, name: s.name, kind: asSkillKind(s.kind), status: s.summary ?? '', model: s.model ?? undefined, on: s.enabled, description: s.summary ?? undefined, usedByStages: s.usedByStages,
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

    return {
      workspaces, activeWorkspaceId,
      projects: projectRows.map((p): ProjectSummary => ({ id: p.id, name: p.name, ...(p.gitUrl ? { gitUrl: p.gitUrl } : {}), ...(p.baseImageRef ? { baseImageRef: p.baseImageRef } : {}), ...(p.stack ? { stack: p.stack } : {}) })),
      activeProjectId,
      services: serviceRows.map((s): ServiceSummary => ({ id: s.id, projectId: s.projectId, name: s.name, path: s.path })),
      serviceStacks: serviceStackRows.map((s): ServiceStackSummary => ({ id: s.id, name: s.name, status: s.status, services: s.services })),
      dbConnections: dbConnectionRows.map((c): DbConnectionSummary => ({ id: c.id, projectId: c.projectId, name: c.name, kind: c.kind, envKind: c.envKind })),
      migrations: migrationRows.map((m): MigrationSummary => ({ id: m.id, projectId: m.projectId, name: m.name, envKind: m.envKind, status: m.status, ...(m.error ? { error: m.error } : {}), createdAt: m.createdAt.toISOString() })),
      environments: environmentRows.map((e): EnvironmentSummary => ({
        id: e.id, projectId: e.projectId, ...(e.serviceId ? { serviceId: e.serviceId } : {}), kind: e.kind, route: e.route, status: e.status,
        url: `${baseDomain() === 'localhost' ? 'http' : 'https'}://${e.route}/`,
        ...(e.lastError ? { lastError: e.lastError } : {}), ...(e.lastDeployedAt ? { lastDeployedAt: e.lastDeployedAt.toISOString() } : {}),
      })),
      buildArtifacts: buildArtifactRows.map((b): BuildArtifactSummary => ({
        id: b.id, projectId: b.projectId, kind: b.kind, status: b.status, sizeBytes: b.sizeBytes,
        ...(b.status === 'ready' ? { downloadUrl: `/downloads/build/${b.downloadToken}` } : {}),
        ...(b.error ? { error: b.error } : {}), createdAt: b.createdAt.toISOString(),
      })),
      templates: listTemplates(),
      members, budget, docs, skills,
      roles: roleRows.map((r) => ({ key: r.key, name: r.label, locked: r.key === 'owner', perms: r.perms })),
      stages: stageRows.map((s): PipelineStage => ({ id: s.key, kind: asKind(s.kind), name: s.name, order: s.order, aiEnabled: s.aiEnabled, wipLimit: s.wipLimit ?? undefined })),
      stageConfigs: stageRows.map((s) => toStageConfig(s)),
      //? P1 — per-workspace AI provider overrides (from the __ai_provider_<feature> EnvVars).
      aiOverrides: envRows.filter((e) => e.key.startsWith('__ai_provider_')).map((e) => ({ feature: e.key.slice('__ai_provider_'.length), providerId: e.value })),
      //? E5 — user-defined custom AI tasks.
      customTasks: customTaskRows.map((t) => ({ id: t.id, name: t.name, promptTemplate: t.promptTemplate, lastOutput: t.lastOutput, lastRunAt: t.lastRunAt ? t.lastRunAt.getTime() : null })),
      //? O5 — reusable output specs.
      outputTemplates: outputTemplateRows.map((t) => ({ id: t.id, name: t.name, format: t.format, watermarkPosition: t.watermarkPosition })),
      tickets: ticketRows.map((t) => {
        const mapped = toTicket(t);
        //? Real per-ticket cost chip (#16): "<tokens> tok" when the ticket has run turns, else no chip.
        const u = usageByKey.get(mapped.id);
        if (u && u.tokensIn + u.tokensOut > 0) mapped.costLabel = `${String(u.tokensIn + u.tokensOut)} tok · ${String(u.turns)}×`;
        return mapped;
      }),
      usage, insights, analytics,
      //? Review ergonomics (ADR 0048): the cross-ticket answer-queue — every ticket parked on a question
      //? (needs-input), in one place the reviewer drains. Highest priority first.
      answerQueue: ticketRows
        .filter((t) => !t.archived && ((t.needsInput ?? '').length > 0 || t.status === 'needs-input'))
        .map((t): AnswerQueueItem => ({ ticketKey: t.key, title: t.title, question: questionPrompt(t.needsInput), priority: t.priority }))
        .toSorted((a, b) => (PRIORITY_RANK[b.priority] ?? 1) - (PRIORITY_RANK[a.priority] ?? 1)),
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
      })),
      studioBrand: studioBrandRow === null ? null : {
        workspaceId: studioBrandRow.workspaceId, name: studioBrandRow.name,
        palette: (Array.isArray(studioBrandRow.palette) ? studioBrandRow.palette : []).map((p) => ({ name: jsonStr(p, 'name'), hex: jsonStr(p, 'hex') })).filter((p) => p.hex.length > 0),
        typography: { heading: jsonStr(studioBrandRow.typography, 'heading'), body: jsonStr(studioBrandRow.typography, 'body') },
        voice: studioBrandRow.voice, taglines: studioBrandRow.taglines, logoIdeas: studioBrandRow.logoIdeas,
      },
      designArtifacts: designArtifactRows.map((d) => ({
        id: d.id, kind: d.kind, name: d.name, description: d.description ?? '', content: d.content, source: d.source, active: d.active, createdAt: d.createdAt.toISOString(),
      })),
      interviewFindings: interviewFindingRows.map((f) => ({
        id: f.id, area: f.area, severity: f.severity, title: f.title, summary: f.summary, status: f.status, ticketId: f.ticketId ?? null, createdAt: f.createdAt.toISOString(),
      })),
      ticketArtifactLinks: artifactLinkRows.map((l) => {
        const name = l.artifactKind === 'design'
          ? (designArtifactRows.find((d) => d.id === l.artifactId)?.name ?? '—')
          : (studioArtifactRows.find((s) => s.id === l.artifactId)?.title ?? '—');
        return { id: l.id, ticketId: ticketKeyById.get(l.ticketId) ?? l.ticketId, artifactId: l.artifactId, artifactKind: l.artifactKind, name, label: l.label ?? null };
      }),
      sprints: sprintRows.map((sp): Sprint => ({ id: sp.id, name: sp.name, start: sp.startAt ? sp.startAt.toISOString().slice(0, 10) : null, end: sp.endAt ? sp.endAt.toISOString().slice(0, 10) : null, active: sp.active, ticketCount: ticketCountBySprint.get(sp.id) ?? 0, daysLeft: sp.endAt ? Math.max(0, Math.ceil((sp.endAt.getTime() - Date.now()) / 86_400_000)) : null })),
      suggestions: suggestionRows.map((s): AiSuggestion => ({ id: s.id, type: asSugType(s.type), title: s.title, body: s.body, ticketIds: s.ticketIds.map((id) => ticketKeyById.get(id) ?? id) })),
      //? RS-B1 (SECURITY) — internal `__`-rows (provider keys, OAuth-token JSON, per-feature
      //? overrides) NEVER reach the client env list (mirrors serviceEnv.ts's container filter).
      //? The derived aiOverrides/mediaModels projections above expose only feature→id mappings.
      envVars: envRows.filter((e) => !e.key.startsWith('__')).map((e): EnvVar => ({ id: e.id, key: e.key, value: e.secret ? (decryptSecret(e.value) ?? e.value) : e.value, secret: e.secret })),
      integrations: integrationRows.map((it): IntegrationTool => ({ id: it.id, name: it.name, type: it.type, fields: it.fields.map((f) => ({ id: f.id, label: f.label, placeholder: f.placeholder ?? undefined, envVarId: f.envVarId })), mcp: it.mcp })),
      invites: inviteRows.map((inv): InviteEntry => ({ id: inv.id, email: inv.email, role: asRole(inv.roleKey), sent: 'pending' })),
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
      repo,
      gitConfig,
      workspacePaused,
      myInvites,
    };
  });
}
