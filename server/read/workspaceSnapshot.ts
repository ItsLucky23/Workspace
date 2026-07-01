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

import type { PrismaClient } from '@prisma/client';

import { runInTenant } from '../tenant/tenantContext';
import { tenantDb } from '../tenant/tenantDb';
import type {
  ActivityEvent, AiSuggestion, CommandMode, EnvVar, InfoDoc, IntegrationTool, InviteEntry, Member,
  ModelRule, NetworkMode, NotificationItem, PermRole, PipelineStage, PipelineStageCfg, Role,
  SkillEntry, Sprint, StageCommandCfg, StageEffort, StageEnvVar, StageKind, StageModelTier,
  StageProcessCfg, StageStatusCfg, StageToolCfg, Ticket, TicketStatus, ToolTier, Workspace, WorkspaceBudget,
} from '../../src/workspaces/_data/types';

//? DB-string → typed-union narrowers (ternary narrowing, no `as`): in the true
//? branch of the `===` chain TS narrows the string to the compared literals.
const asRole = (key: string): Role => (key === 'owner' || key === 'admin' ? key : 'member');
const asStatus = (s: string): TicketStatus => (s === 'needs-input' || s === 'busy' || s === 'done' || s === 'paused' || s === 'stuck' ? s : 'idle');
const asKind = (s: string): StageKind => (s === 'refine' || s === 'plan' || s === 'test' || s === 'review' || s === 'final' ? s : 'code');
const asSugType = (s: string): AiSuggestion['type'] => (s === 'link-tickets' || s === 'create-epic' || s === 'config-review' || s === 'automation' ? s : 'maintenance');
const asEvType = (s: string): ActivityEvent['type'] => (s === 'command' || s === 'file-change' || s === 'status-change' || s === 'mr' || s === 'comment' ? s : 'ai-message');
const asDocSource = (s: string | null): InfoDoc['source'] => (s === 'generated' || s === 'uploaded' ? s : 'git');
const asSkillKind = (s: string | null): SkillEntry['kind'] => (s === 'frozen' ? 'frozen' : 'live');
const asNotifType = (s: string): NotificationItem['type'] => (s === 'needs-input' || s === 'merge' || s === 'ai-suggestion' ? s : 'container-failure');
const asCommandMode = (s: string): CommandMode => (s === 'allow' || s === 'deny' ? s : 'ask');
const asToolTier = (s: string): ToolTier => (s === 'rw' ? s : 'ro');
const asStatusKind = (s: string): StageStatusCfg['kind'] => (s === 'base' ? s : 'custom');
const asNetworkMode = (s: string): NetworkMode => (s === 'blacklist' ? s : 'whitelist');
const asModelTier = (s: string): StageModelTier => (s === 'haiku' || s === 'opus' ? s : 'sonnet');
const asEffort = (s: string): StageEffort => (s === 'low' || s === 'high' || s === 'xhigh' || s === 'max' ? s : 'medium');

//? Formats a `Date` to a short local `HH:MM` string for feed/notification timestamps.
const formatTime = (d: Date): string => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

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
}

const EMPTY: Omit<WorkspaceSnapshot, 'workspaces' | 'activeWorkspaceId'> = {
  members: [], tickets: [], stages: [], stageConfigs: [], sprints: [], suggestions: [], budget: null,
  docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [], notifications: [],
};

export async function buildSnapshot(prisma: PrismaClient, userId: string, wantWorkspaceId?: string): Promise<WorkspaceSnapshot> {
  const memberships = await prisma.workspaceMember.findMany({ where: { userId } });
  const wsIds = memberships.map((m) => m.workspaceId);
  const workspaceRows = wsIds.length > 0 ? await prisma.workspace.findMany({ where: { id: { in: wsIds } } }) : [];
  const roleByWs = new Map(memberships.map((m) => [m.workspaceId, m.roleKey]));
  const workspaces = workspaceRows.map((w) => ({ id: w.id, name: w.name, slug: w.slug, ownerId: w.ownerId, role: asRole(roleByWs.get(w.id) ?? 'member') }));

  const activeWorkspaceId = wantWorkspaceId && wsIds.includes(wantWorkspaceId) ? wantWorkspaceId : (wsIds[0] ?? null);
  if (!activeWorkspaceId) return { workspaces, activeWorkspaceId: null, ...EMPTY };

  return runInTenant(activeWorkspaceId, async () => {
    const [memberRows, roleRows, stageRows, ticketRows, sprintRows, suggestionRows, budgetRows, sourceRows, envRows, integrationRows, inviteRows, eventRows, notificationRows] = await Promise.all([
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
      tenantDb.ticketEvent.findMany({ orderBy: { seq: 'desc' }, take: 50 }),
      tenantDb.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
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

    const budget = budgetRows[0] ? { spent: budgetRows[0].spent, cap: budgetRows[0].cap, alertPct: budgetRows[0].alertPct, currency: '€' } : null;

    const docs: InfoDoc[] = sourceRows.filter((s) => s.mode === 'context-doc').map((s) => ({
      id: s.id, name: s.name, source: asDocSource(s.source), updated: '', note: s.note ?? '', summary: s.summary ?? '', usedByStages: s.usedByStages, content: s.content ?? '',
    }));
    const skills: SkillEntry[] = sourceRows.filter((s) => s.mode === 'skill').map((s) => ({
      id: s.id, name: s.name, kind: asSkillKind(s.kind), status: s.summary ?? '', model: s.model ?? undefined, on: s.enabled, description: s.summary ?? undefined, usedByStages: s.usedByStages,
    }));

    return {
      workspaces, activeWorkspaceId, members, budget, docs, skills,
      roles: roleRows.map((r) => ({ key: r.key, name: r.label, locked: r.key === 'owner', perms: r.perms })),
      stages: stageRows.map((s): PipelineStage => ({ id: s.key, kind: asKind(s.kind), name: s.name, order: s.order, aiEnabled: s.aiEnabled, wipLimit: s.wipLimit ?? undefined })),
      stageConfigs: stageRows.map((s): PipelineStageCfg => ({
        id: s.key, kind: asKind(s.kind), name: s.name, order: s.order, aiEnabled: s.aiEnabled,
        customInstructions: s.customInstructions, promptTemplate: s.promptTemplate,
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
      })),
      tickets: ticketRows.map((t): Ticket => ({
        id: t.key, workspaceId: t.workspaceId, projectId: t.projectId, title: t.title, description: t.description ?? undefined,
        stageId: t.stageId, status: asStatus(t.status), labels: t.labels, creatorId: t.creatorId ?? undefined, assigneeId: t.assigneeId ?? undefined,
        viewers: [], hasTerminal: false, branch: t.branch ?? undefined, mr: t.mrUrl ?? undefined, issue: t.issueUrl ?? undefined,
        sprintId: t.sprintId ?? undefined, carryOver: t.carryOver ?? undefined, needsInput: t.needsInput ?? undefined, archived: t.archived,
      })),
      sprints: sprintRows.map((sp): Sprint => ({ id: sp.id, name: sp.name, start: null, end: null, active: sp.active, ticketCount: ticketCountBySprint.get(sp.id) ?? 0, daysLeft: null })),
      suggestions: suggestionRows.map((s): AiSuggestion => ({ id: s.id, type: asSugType(s.type), title: s.title, body: s.body, ticketIds: s.ticketIds })),
      envVars: envRows.map((e): EnvVar => ({ id: e.id, key: e.key, value: e.value, secret: e.secret })),
      integrations: integrationRows.map((it): IntegrationTool => ({ id: it.id, name: it.name, type: it.type, fields: it.fields.map((f) => ({ id: f.id, label: f.label, placeholder: f.placeholder ?? undefined, envVarId: f.envVarId })), mcp: it.mcp })),
      invites: inviteRows.map((inv): InviteEntry => ({ id: inv.id, email: inv.email, role: asRole(inv.roleKey), sent: 'pending' })),
      events: eventRows.map((ev): ActivityEvent => ({ time: formatTime(ev.createdAt), actor: ev.actor, ticketId: ev.ticketId, type: asEvType(ev.type), text: ev.text })),
      notifications: notificationRows.map((n): NotificationItem => ({
        id: n.id, type: asNotifType(n.type), title: n.title, body: n.body, ticketId: n.ticketId ?? undefined,
        deepLink: asDeepLink(n.deepLink), time: formatTime(n.createdAt), read: n.read,
      })),
    };
  });
}
