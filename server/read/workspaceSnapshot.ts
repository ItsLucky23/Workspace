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

import { runInTenant } from '../tenant/tenantContext';
import { tenantDb } from '../tenant/tenantDb';
import { formatTime, toInfoDoc, toTicket } from './mappers';
import { repoStatus } from '../git/repoStore';
import { decryptSecret } from '../crypto/secretBox';
import { normalizeGitConfig, DEFAULT_GIT_CONFIG, type GitConfig } from '../git/branchStrategy';
import { aggregateUsage, type WorkspaceUsage } from '../spend/record';
import { computeInsights, type WorkspaceInsights } from '../obs/insights';
import type {
  ActivityEvent, AiSuggestion, CommandMode, EnvVar, InfoDoc, IntegrationTool, InviteEntry, Member,
  ModelRule, MyInvite, NetworkMode, NotificationItem, PermRole, PipelineStage, PipelineStageCfg, Role,
  SkillEntry, Sprint, StageCommandCfg, StageEffort, StageEnvVar, StageKind, StageModelTier,
  RepoInfo, StageProcessCfg, StageStatusCfg, StageToolCfg, Ticket, TicketNote, ToolTier, Workspace, WorkspaceBudget,
} from '../../src/workspaces/_data/types';

//? DB-string → typed-union narrowers (ternary narrowing, no `as`): in the true
//? branch of the `===` chain TS narrows the string to the compared literals.
const asRole = (key: string): Role => (key === 'owner' || key === 'admin' ? key : 'member');
const asKind = (s: string): StageKind => (s === 'refine' || s === 'plan' || s === 'test' || s === 'review' || s === 'final' ? s : 'code');
const asSugType = (s: string): AiSuggestion['type'] => (s === 'link-tickets' || s === 'create-epic' || s === 'config-review' || s === 'automation' ? s : 'maintenance');
const asEvType = (s: string): ActivityEvent['type'] => (s === 'command' || s === 'file-change' || s === 'status-change' || s === 'mr' || s === 'comment' ? s : 'ai-message');
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
  workspaces: (Pick<Workspace, 'id' | 'name' | 'slug' | 'ownerId' | 'role'>)[];
  activeWorkspaceId: string | null;
  members: Member[];
  tickets: Ticket[];
  stages: PipelineStage[];
  stageConfigs: PipelineStageCfg[];
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
  //? Cross-workspace: invitations addressed to THIS user's email (onboarding). Always
  //? present — even for a user with zero workspaces (the no-workspace early return).
  myInvites: MyInvite[];
}

const EMPTY: Omit<WorkspaceSnapshot, 'workspaces' | 'activeWorkspaceId' | 'myInvites'> = {
  members: [], tickets: [], stages: [], stageConfigs: [], sprints: [], suggestions: [], budget: null,
  docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [], notifications: [], notes: [], repo: { linked: false }, gitConfig: DEFAULT_GIT_CONFIG, workspacePaused: false,
  usage: { byTicket: [], activity: [], totalTokens: 0, totalTurns: 0 },
  insights: { avgCycleHours: 0, throughput7d: 0, avgTokensPerTicket: 0, doneCount: 0, openCount: 0 },
};

export async function buildSnapshot(prisma: PrismaClient, userId: string, wantWorkspaceId?: string): Promise<WorkspaceSnapshot> {
  const memberships = await prisma.workspaceMember.findMany({ where: { userId } });
  const wsIds = memberships.map((m) => m.workspaceId);
  const workspaceRows = wsIds.length > 0 ? await prisma.workspace.findMany({ where: { id: { in: wsIds } } }) : [];
  const roleByWs = new Map(memberships.map((m) => [m.workspaceId, m.roleKey]));
  const workspaces = workspaceRows.map((w) => ({ id: w.id, name: w.name, slug: w.slug, ownerId: w.ownerId, role: asRole(roleByWs.get(w.id) ?? 'member') }));

  //? Cross-workspace, by-email (NOT tenant-scoped): the pending invitations this user
  //? can accept from the onboarding. Uses the plain client — a user with no workspace
  //? has no tenant to scope to, and an invite lives in the INVITING workspace.
  const userRow = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const inviteRowsForMe = userRow?.email ? await prisma.invite.findMany({ where: { email: userRow.email, status: 'pending' } }) : [];
  const inviteWsIds = [...new Set(inviteRowsForMe.map((i) => i.workspaceId))];
  const inviteWsRows = inviteWsIds.length > 0 ? await prisma.workspace.findMany({ where: { id: { in: inviteWsIds } }, select: { id: true, name: true } }) : [];
  const inviteWsName = new Map(inviteWsRows.map((w) => [w.id, w.name]));
  const myInvites: MyInvite[] = inviteRowsForMe.map((i) => ({ token: i.token, workspaceName: inviteWsName.get(i.workspaceId) ?? '—', role: asRole(i.roleKey) }));

  const activeWorkspaceId = wantWorkspaceId && wsIds.includes(wantWorkspaceId) ? wantWorkspaceId : (wsIds[0] ?? null);
  if (!activeWorkspaceId) return { workspaces, activeWorkspaceId: null, ...EMPTY, myInvites };

  return runInTenant(activeWorkspaceId, async () => {
    const [memberRows, roleRows, stageRows, ticketRows, sprintRows, suggestionRows, budgetRows, sourceRows, envRows, integrationRows, inviteRows, eventRows, notificationRows, noteRows, spendRows] = await Promise.all([
      tenantDb.workspaceMember.findMany(),
      tenantDb.workspaceRole.findMany(),
      tenantDb.pipelineStage.findMany({ orderBy: { order: 'asc' } }),
      tenantDb.ticket.findMany(),
      tenantDb.sprint.findMany(),
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
      tenantDb.spendRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 5000, select: { ticketId: true, tokensIn: true, tokensOut: true, createdAt: true } }),
    ]);

    const userRows = await prisma.user.findMany({ where: { id: { in: memberRows.map((m) => m.userId) } } });
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

    const budget = budgetRows[0] ? { spent: budgetRows[0].spent, cap: budgetRows[0].cap, alertPct: budgetRows[0].alertPct, currency: '€' } : null;

    const docs: InfoDoc[] = sourceRows.filter((s) => s.mode === 'context-doc').map((s) => toInfoDoc(s));
    const skills: SkillEntry[] = sourceRows.filter((s) => s.mode === 'skill').map((s) => ({
      id: s.id, name: s.name, kind: asSkillKind(s.kind), status: s.summary ?? '', model: s.model ?? undefined, on: s.enabled, description: s.summary ?? undefined, usedByStages: s.usedByStages,
    }));

    //? Register-flow step A: the linked-repo status (on-disk bare clone under
    //? data/workspaces/<id>/), keyed off the project's stored (clean) gitUrl.
    const projectRow = await tenantDb.project.findFirst();
    const repo = await repoStatus(activeWorkspaceId, projectRow?.gitUrl ?? undefined);
    //? The active workspace's git strategy (normalized; DEFAULT when the field is unset).
    const activeWs = workspaceRows.find((w) => w.id === activeWorkspaceId);
    const gitConfig = normalizeGitConfig(activeWs?.gitConfig ?? null);
    const workspacePaused = activeWs?.paused === true;

    return {
      workspaces, activeWorkspaceId, members, budget, docs, skills,
      roles: roleRows.map((r) => ({ key: r.key, name: r.label, locked: r.key === 'owner', perms: r.perms })),
      stages: stageRows.map((s): PipelineStage => ({ id: s.key, kind: asKind(s.kind), name: s.name, order: s.order, aiEnabled: s.aiEnabled, wipLimit: s.wipLimit ?? undefined })),
      stageConfigs: stageRows.map((s) => toStageConfig(s)),
      tickets: ticketRows.map((t) => {
        const mapped = toTicket(t);
        //? Real per-ticket cost chip (#16): "<tokens> tok" when the ticket has run turns, else no chip.
        const u = usageByKey.get(mapped.id);
        if (u && u.tokensIn + u.tokensOut > 0) mapped.costLabel = `${String(u.tokensIn + u.tokensOut)} tok · ${String(u.turns)}×`;
        return mapped;
      }),
      usage, insights,
      sprints: sprintRows.map((sp): Sprint => ({ id: sp.id, name: sp.name, start: null, end: null, active: sp.active, ticketCount: ticketCountBySprint.get(sp.id) ?? 0, daysLeft: null })),
      suggestions: suggestionRows.map((s): AiSuggestion => ({ id: s.id, type: asSugType(s.type), title: s.title, body: s.body, ticketIds: s.ticketIds.map((id) => ticketKeyById.get(id) ?? id) })),
      envVars: envRows.map((e): EnvVar => ({ id: e.id, key: e.key, value: e.secret ? (decryptSecret(e.value) ?? e.value) : e.value, secret: e.secret })),
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
