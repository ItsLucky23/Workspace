//? Workspaces — first-run demo seeding.
//?
//? Maps the prototype's `_data/seed` constants (workspace/project/pipeline/tickets/
//? members/sprints/…) onto real Prisma rows for a given owner (MIGRATION §5.2). The
//? demo TICKETS/MEMBERS are dev/demo only; the owner is the real logged-in user, the
//? other members become demo `User` rows so the member list + assignees populate.
//? Idempotency: demo member emails are suffixed with the owner id so re-seeding for a
//? different login never collides on `@@unique([email, provider])`.

import type { PrismaClient } from '@prisma/client';

import {
  AI_SUGGESTIONS, BUDGET, DOCS, ENV_VARS, EVENTS, INTEGRATION_TOOLS, INVITES,
  MEMBERS, PROJECTS, SKILLS, SPRINTS, STAGE_CONFIGS, TICKETS,
  ticketAssignee, ticketCreator,
} from '../../src/workspaces/_data/seed';

const OWNER_PERMS = [true, true, true, true, true, true, true, true];
const ADMIN_PERMS = [true, true, true, true, true, false, false, false];
const MEMBER_PERMS = [true, false, false, false, false, false, false, false];

//? The prototype's "ME" (owner) member — replaced by the real logged-in user.
const OWNER_SEED_ID = 'mathijs';

export async function seedDemoWorkspace(prisma: PrismaClient, ownerId: string): Promise<{ workspaceId: string }> {
  const short = ownerId.slice(-6);
  const ws = await prisma.workspace.create({
    data: { name: 'YouComm Core', slug: `youcomm-core-${short}`, ownerId, timezone: 'Europe/Amsterdam', presetKey: 'professional' },
  });
  const workspaceId = ws.id;

  await prisma.workspaceRole.createMany({
    data: [
      { workspaceId, key: 'owner', label: 'Owner', perms: OWNER_PERMS, builtIn: true },
      { workspaceId, key: 'admin', label: 'Admin', perms: ADMIN_PERMS, builtIn: true },
      { workspaceId, key: 'member', label: 'Member', perms: MEMBER_PERMS, builtIn: true },
    ],
  });

  //? Members: the owner = the real user; the rest become demo Users + memberships.
  const memberIdMap: Record<string, string> = {};
  for (const m of Object.values(MEMBERS)) {
    if (m.id === OWNER_SEED_ID) {
      memberIdMap[m.id] = ownerId;
      await prisma.workspaceMember.create({ data: { workspaceId, userId: ownerId, roleKey: 'owner' } });
    } else {
      const u = await prisma.user.create({ data: { email: `${m.id}+${short}@youcomm.nl`, name: m.name, avatarFallback: m.avatarFallback } });
      memberIdMap[m.id] = u.id;
      await prisma.workspaceMember.create({ data: { workspaceId, userId: u.id, roleKey: m.role } });
    }
  }

  const project = await prisma.project.create({ data: { workspaceId, name: PROJECTS[0].name, gitlabPath: PROJECTS[0].gitlabPath } });

  //? Pipeline stages — the composite config maps through 1:1 (the schema composite
  //? types mirror PipelineStageCfg). `key` is the stable slug tickets reference.
  for (const s of STAGE_CONFIGS) {
    await prisma.pipelineStage.create({
      data: {
        workspaceId, projectId: project.id, key: s.id, kind: s.kind, name: s.name, order: s.order,
        aiEnabled: s.aiEnabled, wipLimit: s.wipLimit ?? null,
        roleKey: s.kind === 'code' ? 'code' : s.kind, systemPrompt: '',
        customInstructions: s.customInstructions, promptTemplate: s.promptTemplate,
        skillKeys: s.skillKeys, sourceIds: s.sourceIds,
        commands: s.commands, tools: s.tools, statuses: s.statuses, processes: s.processes,
        visibleStageIds: s.visibleStageIds, modelCfg: s.modelCfg, network: s.network, hooks: s.hooks,
      },
    });
  }

  //? Sprints (skip the virtual 'backlog' sprint).
  const sprintIdMap: Record<string, string> = {};
  for (const sp of SPRINTS) {
    if (sp.id === 'backlog') continue;
    const row = await prisma.sprint.create({ data: { workspaceId, name: sp.name, active: sp.active } });
    sprintIdMap[sp.id] = row.id;
  }

  //? Tickets — key = "DEV-####"; creator/assignee mapped to real User ids.
  const ticketKeyToId: Record<string, string> = {};
  for (const t of TICKETS) {
    const number = Number.parseInt(t.id.replace('DEV-', ''), 10) || 0;
    const assigneeSeed = ticketAssignee(t);
    const row = await prisma.ticket.create({
      data: {
        workspaceId, projectId: project.id, key: t.id, number,
        title: t.title, description: t.description ?? null,
        stageId: t.stageId, status: t.status, labels: t.labels,
        creatorId: memberIdMap[ticketCreator(t)] ?? ownerId,
        assigneeId: assigneeSeed ? (memberIdMap[assigneeSeed] ?? null) : null,
        branch: t.branch ?? null, mrUrl: t.mr ?? null, issueUrl: t.issue ?? null,
        sprintId: t.sprintId ? (sprintIdMap[t.sprintId] ?? null) : null,
        carryOver: t.carryOver ?? null, needsInput: t.needsInput ?? null,
      },
    });
    ticketKeyToId[t.id] = row.id;
  }

  //? Suggestions — map the DEV-#### ticket keys to real ObjectIds.
  for (const sug of AI_SUGGESTIONS) {
    await prisma.workspaceSuggestion.create({
      data: {
        workspaceId, type: sug.type, title: sug.title, body: sug.body, status: 'open',
        ticketIds: sug.ticketIds.map((k) => ticketKeyToId[k]).filter((id): id is string => id !== undefined),
      },
    });
  }

  await prisma.workspaceBudget.create({
    data: { workspaceId, label: 'Monthly', cap: BUDGET.cap, alertPct: BUDGET.alertPct, enforcement: 'pauseNew', periodWindow: 'calendar-month', spent: BUDGET.spent, enabled: true },
  });

  //? Info sources — context-docs + skills unified into InfoSource.
  for (const d of DOCS) {
    await prisma.infoSource.create({
      data: { workspaceId, projectId: project.id, mode: 'context-doc', name: d.name, source: d.source, summary: d.summary, note: d.note, content: d.content, usedByStages: d.usedByStages ?? [], enabled: true },
    });
  }
  for (const sk of SKILLS) {
    await prisma.infoSource.create({
      data: { workspaceId, projectId: project.id, mode: 'skill', name: sk.name, summary: sk.description ?? null, kind: sk.kind, model: sk.model ?? null, usedByStages: sk.usedByStages ?? [], enabled: sk.on },
    });
  }

  for (const e of ENV_VARS) {
    await prisma.envVar.create({ data: { workspaceId, key: e.key, value: e.value, secret: e.secret } });
  }

  for (const it of INTEGRATION_TOOLS) {
    await prisma.integrationTool.create({ data: { workspaceId, name: it.name, type: it.type, fields: it.fields, mcp: it.mcp } });
  }

  for (const inv of INVITES) {
    await prisma.invite.create({ data: { workspaceId, email: inv.email, roleKey: inv.role, token: `seed-${inv.id}-${short}`, status: 'pending' } });
  }

  //? Ticket events — monotonic seq per ticket; map actor member ids.
  const seqByTicket: Record<string, number> = {};
  for (const ev of EVENTS) {
    const ticketId = ticketKeyToId[ev.ticketId];
    if (!ticketId) continue;
    const seq = (seqByTicket[ticketId] ?? 0) + 1;
    seqByTicket[ticketId] = seq;
    const actor = ev.actor === 'ai' || ev.actor === 'mr' ? ev.actor : (memberIdMap[ev.actor] ?? ev.actor);
    await prisma.ticketEvent.create({ data: { workspaceId, ticketId, seq, type: ev.type, actor, text: ev.text } });
  }

  return { workspaceId };
}
