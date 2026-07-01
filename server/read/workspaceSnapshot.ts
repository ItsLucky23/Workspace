//? Workspaces — the read snapshot (the server side of `useWorkspaceData()`).
//?
//? Aggregates one workspace's tenant-scoped rows into the exact frontend types the
//? screens render (MIGRATION §4), narrowing DB strings to the typed unions so the
//? client gets fully-typed data (no `unknown[]`). Reads go through `tenantDb` inside
//? `runInTenant(workspaceId)`; the cross-workspace bits (which workspaces a user
//? belongs to, User join) use the plain client. `PipelineStage.key` → frontend `id`.
//?
//? Scope note: `stages` carries the board META (id/kind/name/order/aiEnabled/wipLimit)
//? — the full per-stage editor config stays on `_data/seed` for now (the config-edit
//? persistence slice lands later); the board/backlog/tickets/members render live.

import type { PrismaClient } from '@prisma/client';

import { runInTenant } from '../tenant/tenantContext';
import { tenantDb } from '../tenant/tenantDb';
import type {
  ActivityEvent, AiSuggestion, EnvVar, InfoDoc, IntegrationTool, InviteEntry, Member, PermRole,
  PipelineStage, Role, SkillEntry, Sprint, StageKind, Ticket, TicketStatus, Workspace, WorkspaceBudget,
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

export interface WorkspaceSnapshot {
  workspaces: (Pick<Workspace, 'id' | 'name' | 'slug' | 'ownerId' | 'role'>)[];
  activeWorkspaceId: string | null;
  members: Member[];
  tickets: Ticket[];
  stages: PipelineStage[];
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
}

const EMPTY: Omit<WorkspaceSnapshot, 'workspaces' | 'activeWorkspaceId'> = {
  members: [], tickets: [], stages: [], sprints: [], suggestions: [], budget: null,
  docs: [], skills: [], roles: [], envVars: [], integrations: [], invites: [], events: [],
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
    const [memberRows, roleRows, stageRows, ticketRows, sprintRows, suggestionRows, budgetRows, sourceRows, envRows, integrationRows, inviteRows, eventRows] = await Promise.all([
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
      events: eventRows.map((ev): ActivityEvent => ({ time: '', actor: ev.actor, ticketId: ev.ticketId, type: asEvType(ev.type), text: ev.text })),
    };
  });
}
