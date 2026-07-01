//? Workspaces — the read snapshot (the server side of `useWorkspaceData()`).
//?
//? Aggregates one workspace's tenant-scoped rows into the shapes the prototype
//? screens render (MIGRATION §4). Reads go through `tenantDb` inside
//? `runInTenant(workspaceId)` so isolation is implicit; the cross-workspace bits
//? (which workspaces a user belongs to, User profile join) use the plain client.
//? The DB `PipelineStage.key` is mapped back to the frontend's stage `id` (slug).

import type { PrismaClient } from '@prisma/client';

import { runInTenant } from '../tenant/tenantContext';
import { tenantDb } from '../tenant/tenantDb';

type Role = 'owner' | 'admin' | 'member';
const asRole = (key: string): Role => (key === 'owner' || key === 'admin' ? key : 'member');

export interface WorkspaceSnapshot {
  workspaces: { id: string; name: string; slug: string; ownerId: string; role: Role }[];
  activeWorkspaceId: string | null;
  members: { id: string; name: string; email: string; avatar?: string; avatarFallback: string; role: Role }[];
  tickets: unknown[];
  stages: unknown[];
  sprints: unknown[];
  suggestions: unknown[];
  budget: { spent: number; cap: number; alertPct: number; currency: string } | null;
  sources: unknown[];
  roles: { name: string; locked?: boolean; perms: boolean[] }[];
  envVars: unknown[];
  integrations: unknown[];
  invites: unknown[];
  events: unknown[];
}

export async function buildSnapshot(prisma: PrismaClient, userId: string, wantWorkspaceId?: string): Promise<WorkspaceSnapshot> {
  //? Which workspaces does this user belong to? (cross-workspace — plain client).
  const memberships = await prisma.workspaceMember.findMany({ where: { userId } });
  const wsIds = memberships.map((m) => m.workspaceId);
  const workspaceRows = wsIds.length ? await prisma.workspace.findMany({ where: { id: { in: wsIds } } }) : [];
  const roleByWs = new Map(memberships.map((m) => [m.workspaceId, m.roleKey]));
  const workspaces = workspaceRows.map((w) => ({ id: w.id, name: w.name, slug: w.slug, ownerId: w.ownerId, role: asRole(roleByWs.get(w.id) ?? 'member') }));

  const activeWorkspaceId = wantWorkspaceId && wsIds.includes(wantWorkspaceId) ? wantWorkspaceId : (wsIds[0] ?? null);
  if (!activeWorkspaceId) {
    return { workspaces, activeWorkspaceId: null, members: [], tickets: [], stages: [], sprints: [], suggestions: [], budget: null, sources: [], roles: [], envVars: [], integrations: [], invites: [], events: [] };
  }

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

    //? Join User profiles for the member list (User is framework-global).
    const userRows = await prisma.user.findMany({ where: { id: { in: memberRows.map((m) => m.userId) } } });
    const userById = new Map(userRows.map((u) => [u.id, u]));
    const members = memberRows.map((m) => {
      const u = userById.get(m.userId);
      return { id: m.userId, name: u?.name ?? u?.email ?? 'Member', email: u?.email ?? '', avatar: u?.avatar || undefined, avatarFallback: u?.avatarFallback || '#6366F1', role: asRole(m.roleKey) };
    });

    const ticketCountBySprint = new Map<string, number>();
    for (const t of ticketRows) { if (t.sprintId) ticketCountBySprint.set(t.sprintId, (ticketCountBySprint.get(t.sprintId) ?? 0) + 1); }

    const budget = budgetRows[0] ? { spent: budgetRows[0].spent, cap: budgetRows[0].cap, alertPct: budgetRows[0].alertPct, currency: '€' } : null;

    return {
      workspaces, activeWorkspaceId,
      members,
      roles: roleRows.map((r) => ({ name: r.label, locked: r.key === 'owner', perms: r.perms })),
      stages: stageRows.map((s) => ({
        id: s.key, kind: s.kind, name: s.name, order: s.order, aiEnabled: s.aiEnabled, wipLimit: s.wipLimit ?? undefined,
        customInstructions: s.customInstructions, promptTemplate: s.promptTemplate, systemPrompt: s.systemPrompt, roleKey: s.roleKey,
        skillKeys: s.skillKeys, sourceIds: s.sourceIds, commands: s.commands, tools: s.tools, statuses: s.statuses,
        processes: s.processes, visibleStageIds: s.visibleStageIds, modelCfg: s.modelCfg, network: s.network, hooks: s.hooks,
      })),
      tickets: ticketRows.map((t) => ({
        id: t.key, workspaceId: t.workspaceId, projectId: t.projectId, title: t.title, description: t.description ?? undefined,
        stageId: t.stageId, status: t.status, labels: t.labels, creatorId: t.creatorId ?? undefined, assigneeId: t.assigneeId ?? undefined,
        viewers: [], hasTerminal: false, branch: t.branch ?? undefined, mr: t.mrUrl ?? undefined, issue: t.issueUrl ?? undefined,
        sprintId: t.sprintId ?? undefined, carryOver: t.carryOver ?? undefined, needsInput: t.needsInput ?? undefined, archived: t.archived,
      })),
      sprints: sprintRows.map((sp) => ({ id: sp.id, name: sp.name, start: null, end: null, active: sp.active, ticketCount: ticketCountBySprint.get(sp.id) ?? 0, daysLeft: null })),
      suggestions: suggestionRows.map((s) => ({ id: s.id, type: s.type, title: s.title, body: s.body, ticketIds: s.ticketIds })),
      budget,
      sources: sourceRows.map((s) => ({ id: s.id, name: s.name, mode: s.mode, source: s.source ?? undefined, summary: s.summary ?? '', note: s.note ?? '', content: s.content ?? '', kind: s.kind ?? undefined, on: s.enabled, usedByStages: s.usedByStages })),
      envVars: envRows.map((e) => ({ id: e.id, key: e.key, value: e.value, secret: e.secret })),
      integrations: integrationRows.map((it) => ({ id: it.id, name: it.name, type: it.type, fields: it.fields, mcp: it.mcp })),
      invites: inviteRows.map((inv) => ({ id: inv.id, email: inv.email, role: asRole(inv.roleKey), sent: 'pending' })),
      events: eventRows.map((ev) => ({ time: '', actor: ev.actor, ticketId: ev.ticketId, type: ev.type, text: ev.text })),
    };
  });
}
