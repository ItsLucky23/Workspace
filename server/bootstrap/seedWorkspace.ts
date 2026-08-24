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
  MEMBERS, NOTIFICATIONS, PROJECTS, SPRINTS, STAGE_CONFIGS, TICKETS,
  ticketAssignee, ticketCreator,
} from '../../src/workspaces/_data/seed';
import { isModuleEnabled } from '../../src/workspaces/_data/modules';
import { createDefaultPipeline, type PipelinePreset } from './defaultPipeline';
import { findPack, seedPack } from './workspacePacks';
import { createStarterLibrary } from './starterLibrary';
import { ensureWorkspaceBuiltins, scheduleWorkspaceBuiltinIndexing } from './workspaceBuiltins';
import { rebuildDesignSystemDoc } from '../designer/designSystemDoc';
import { encryptSecret } from '../crypto/secretBox';

const OWNER_PERMS = [true, true, true, true, true, true, true, true];
const ADMIN_PERMS = [true, true, true, true, true, false, false, false];
const MEMBER_PERMS = [true, false, false, false, false, false, false, false];

//? The prototype's "ME" (owner) member — replaced by the real logged-in user.
const OWNER_SEED_ID = 'mathijs';

//? A stable, url-safe slug from a free-text workspace name (suffixed by the owner
//? id in the caller to keep it unique across users).
function slugify(name: string): string {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '').slice(0, 40) || 'workspace';
}

//? Create a BLANK-but-functional workspace: the owner's roles + membership, a
//? project, the default pipeline stages (so the board has columns + quick-add's
//? `unrefined` stage exists) and a disabled default budget. NO demo tickets/members
//? — this is the real onboarding "create a workspace" path (the Conductor calls it
//? for the `create-workspace` op). The pipeline comes from `createDefaultPipeline`
//? (server-owned, no `src/` import) so it seeds real stages in a PROD bundle too —
//? this is the lesson-0002 fix (the old `STAGE_CONFIGS` loop stubbed to a no-op in prod).
export async function createBlankWorkspace(prisma: PrismaClient, ownerId: string, name: string, enabledSections?: string[], presetKey: PipelinePreset = 'professional', packId?: string, skipStarterSeed?: boolean, requestedWorkspaceId?: string): Promise<{ workspaceId: string }> {
  const short = ownerId.slice(-6);
  //? Module gating (workspaces/_data/modules.ts): the caller passes the RESOLVED
  //? section-id list from the chosen module presets. Absent/empty ⇒ legacy all-on.
  const sections = enabledSections ?? [];
  const devEnabled = isModuleEnabled(sections.length > 0 ? sections : undefined, 'development');
  const ws = await prisma.workspace.create({
    data: { ...(requestedWorkspaceId ? { id: requestedWorkspaceId } : {}), name, slug: `${slugify(name)}-${short}`, ownerId, timezone: 'Europe/Amsterdam', presetKey, enabledSections: sections },
  });
  const workspaceId = ws.id;

  await prisma.workspaceRole.createMany({
    data: [
      { workspaceId, key: 'owner', label: 'Owner', perms: OWNER_PERMS, builtIn: true },
      { workspaceId, key: 'admin', label: 'Admin', perms: ADMIN_PERMS, builtIn: true },
      { workspaceId, key: 'member', label: 'Member', perms: MEMBER_PERMS, builtIn: true },
    ],
  });
  await prisma.workspaceMember.create({ data: { workspaceId, userId: ownerId, roleKey: 'owner' } });

  const project = await prisma.project.create({ data: { workspaceId, name, gitlabPath: '' } });
  //? Server-owned default pipeline (lesson-0002 FIXED): no `src/` import, so this
  //? seeds real stages in a production bundle too (the old `STAGE_CONFIGS` loop
  //? stubbed to a no-op in prod → blank board).
  //? G5 — the chosen tier decides how many stages the board starts with (dead `presetKey` made real).
  await createDefaultPipeline(prisma, workspaceId, project.id, presetKey);
  //? Seed the curated starter-guidance library (all disabled; the user toggles them on from
  //? the Workflow settings — the "nudge, not a blank page" for their own AI workflows).
  await createStarterLibrary(prisma, workspaceId, project.id);

  await prisma.workspaceBudget.create({
    data: { workspaceId, label: 'Monthly', cap: 0, alertPct: 80, enforcement: 'pauseNew', periodWindow: 'calendar-month', spent: 0, enabled: false },
  });

  //? Light starter seed (item 11): ONE active sprint + TWO example tickets owned by
  //? the creator, so a brand-new board + pipeline + backlog aren't empty on first
  //? open. This deliberately replaces the old heavy demo (20 tickets / 6 fake
  //? members) — that lives in `seedDemoWorkspace` and is dev/test-only. Only seeded
  //? when the Development module is on: a content/design-only workspace has no board,
  //? so it must NOT be greeted with a "Connect your GitLab project" ticket. `skipStarterSeed`
  //? (default false — every existing caller keeps this seed) opts out for callers whose new
  //? workspace already carries its own real content (e.g. an import), where these two
  //? examples would land as phantom tickets alongside the real ones.
  if (devEnabled && !skipStarterSeed) {
    const sprint = await prisma.sprint.create({ data: { workspaceId, projectId: project.id, name: 'Sprint 1', active: true } });
    const starterTickets = [
      { title: 'Welcome to your workspace 👋', description: 'This is an example ticket. Drag it across the pipeline, assign it, or archive it — your call.' },
      { title: 'Connect your GitLab project', description: 'Add your repository under Settings → GitLab so the pipeline can work on real issues and merge requests.' },
    ];
    let number = 1;
    for (const t of starterTickets) {
      await prisma.ticket.create({
        data: {
          workspaceId, projectId: project.id, key: `DEV-${String(number)}`, number,
          title: t.title, description: t.description, stageId: 'unrefined', status: 'idle',
          labels: [], creatorId: ownerId, sprintId: sprint.id,
        },
      });
      number += 1;
    }
  }

  //? Builtin skills + curated Designer gallery are authoritative bootstrap writes. Existing tenants receive
  //? the same rows through the internal leader backfill; snapshots never seed.
  const builtins = await ensureWorkspaceBuiltins(prisma, workspaceId);

  //? Seed the design-system context-doc so the coding agent knows the named looks (apple, material, …) from
  //? day one — even before the user touches the Designer. Best-effort; never fails workspace creation.
  await rebuildDesignSystemDoc(prisma, workspaceId).catch(() => null);

  //? #19 — a PACK seeds what makes the workspace immediately usable (skills, a channel, starter documents,
  //? a first ticket). Deliberately LAST: the default starter tickets above restart numbering at DEV-1, so
  //? seeding the pack earlier collided with them and its ticket silently vanished (caught in the browser).
  //? `seedPack` continues from the highest existing number. Best-effort — a pack must never fail creation.
  const pack = packId === undefined ? null : findPack(packId);
  if (pack) await seedPack(prisma, workspaceId, project.id, ownerId, pack);

  //? Derived embeddings start on the next event-loop turn, after any global Conductor writer context ended.
  void scheduleWorkspaceBuiltinIndexing(prisma, workspaceId, builtins.designArtifactsToIndex);
  return { workspaceId };
}

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

  const seedProject = PROJECTS[0];
  if (!seedProject) throw new Error('seedDemoWorkspace: PROJECTS[0] is missing');
  const project = await prisma.project.create({ data: { workspaceId, name: seedProject.name, gitlabPath: seedProject.gitlabPath } });

  //? Demo seed constants use stable legacy ids for cross-references. Persist env vars
  //? first, then translate IntegrationField.envVarId to the real Mongo ObjectIds.
  const envVarIdMap = new Map<string, string>();
  for (const e of ENV_VARS) {
    const row = await prisma.envVar.create({ data: { workspaceId, key: e.key, value: e.secret ? encryptSecret(e.value) : e.value, secret: e.secret } });
    envVarIdMap.set(e.id, row.id);
  }

  //? IntegrationTool ids are Mongo-generated too. Translate each field ref before
  //? persisting and retain legacy tool id → real id for the stage configs below.
  const integrationToolIdMap = new Map<string, string>();
  for (const it of INTEGRATION_TOOLS) {
    const fields = it.fields.map((field) => {
      if (field.envVarId === null) return field;
      const envVarId = envVarIdMap.get(field.envVarId);
      if (!envVarId) throw new Error(`seedDemoWorkspace: EnvVar '${field.envVarId}' is missing`);
      return { ...field, envVarId };
    });
    const row = await prisma.integrationTool.create({ data: { workspaceId, name: it.name, type: it.type, fields, mcp: it.mcp } });
    integrationToolIdMap.set(it.id, row.id);
  }

  //? Pipeline stages — translate StageToolCfg.toolId to the real IntegrationTool ids.
  //? `key` remains the stable stage slug tickets reference.
  for (const s of STAGE_CONFIGS) {
    const tools = s.tools.map((tool) => {
      const toolId = integrationToolIdMap.get(tool.toolId);
      if (!toolId) throw new Error(`seedDemoWorkspace: IntegrationTool '${tool.toolId}' is missing`);
      return { ...tool, toolId };
    });
    await prisma.pipelineStage.create({
      data: {
        workspaceId, projectId: project.id, key: s.id, kind: s.kind, name: s.name, order: s.order,
        aiEnabled: s.aiEnabled, wipLimit: s.wipLimit ?? null,
        roleKey: s.kind === 'code' ? 'code' : s.kind, systemPrompt: '',
        customInstructions: s.customInstructions, handoverPrompt: s.handoverPrompt,
        sourceIds: s.sourceIds,
        commands: s.commands, tools, statuses: s.statuses, processes: s.processes,
        visibleStageIds: s.visibleStageIds, modelCfg: s.modelCfg, hooks: s.hooks,
      },
    });
  }

  //? Sprints (skip the virtual 'backlog' sprint).
  const sprintIdMap: Record<string, string> = {};
  for (const sp of SPRINTS) {
    if (sp.id === 'backlog') continue;
    const row = await prisma.sprint.create({ data: { workspaceId, projectId: project.id, name: sp.name, active: sp.active } });
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

  //? Notifications — bell items for the owner; ticket keys mapped to real ObjectIds.
  for (const n of NOTIFICATIONS) {
    await prisma.notification.create({
      data: {
        workspaceId, userId: ownerId, type: n.type, title: n.title, body: n.body,
        ticketId: n.ticketId ? (ticketKeyToId[n.ticketId] ?? null) : null,
        read: n.read,
      },
    });
  }

  await prisma.workspaceBudget.create({
    data: { workspaceId, label: 'Monthly', cap: BUDGET.cap, alertPct: BUDGET.alertPct, enforcement: 'pauseNew', periodWindow: 'calendar-month', spent: BUDGET.spent, enabled: true },
  });

  //? Context documents are InfoSource rows. (The old demo "capability skills" — fake RAG/graph
  //? telemetry no real workspace could ever have — are gone with the capability-skill layer.)
  for (const d of DOCS) {
    await prisma.infoSource.create({
      data: { workspaceId, projectId: project.id, mode: 'context-doc', name: d.name, source: d.source, summary: d.summary, note: d.note, content: d.content, enabled: true },
    });
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

  const builtins = await ensureWorkspaceBuiltins(prisma, workspaceId);
  void scheduleWorkspaceBuiltinIndexing(prisma, workspaceId, builtins.designArtifactsToIndex);
  return { workspaceId };
}
