//? Integration test for multi-project / multi-service (ADR 0035, item A1). Runs against
//? the REAL Conductor + Mongo. Asserts a workspace can hold N projects (each with its own
//? seeded pipeline), that `resolveProjectId` prefers an explicit id and falls back to the
//? first, that quick-add lands a ticket in the TARGET project (not always the first), that
//? the snapshot scopes tickets/stages to the active project, and that services attach to a
//? project + surface in that project's snapshot.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { resolveProjectId } = await import('../../server/orchestrator/projectResolve');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `mp-test-${String(stamp)}@youcomm.nl`, name: 'MP Test' } });
let workspaceId: string | null = null;

try {
  // ---- workspace → project #1 (single-project baseline) --------------------------
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'MP Test WS' }, userId: owner.id, clientRequestId: `mp-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  assert(ws !== null, 'create-workspace creates a Workspace');
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj1 = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  assert(proj1 !== null, 'the workspace has a first project');
  await poll(() => prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, projectId: proj1?.id ?? '', key: 'unrefined' } }));

  // ---- resolveProjectId: no arg → the first project ------------------------------
  eq(await resolveProjectId(prisma, wsId), proj1?.id, 'resolveProjectId() falls back to the first project');
  eq(await resolveProjectId(prisma, wsId, '000000000000000000000000'), proj1?.id, 'resolveProjectId(valid-shape but absent id) falls back to the first project');
  eq(await resolveProjectId(prisma, wsId, 'malformed-not-hex'), proj1?.id, 'resolveProjectId(malformed id) falls back — no Prisma throw');

  // ---- project-create → a SECOND project with its own pipeline -------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Backend API' }, userId: owner.id, clientRequestId: `mp-pc-${String(stamp)}` });
  const proj2 = await poll(async () => {
    const rows = await prisma.project.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: 'asc' } });
    return rows.length === 2 ? rows[1] : null;
  });
  assert(proj2 !== null, 'project-create adds a second project to the same workspace');
  const proj2Id = proj2?.id ?? '';
  const p2Unrefined = await poll(() => prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, projectId: proj2Id, key: 'unrefined' } }));
  assert(p2Unrefined !== null, 'the second project gets its OWN seeded pipeline (unrefined stage)');
  eq(await resolveProjectId(prisma, wsId, proj2Id), proj2Id, 'resolveProjectId(valid id) returns that project');

  // ---- quick-add scoping: a ticket lands in the TARGET project -------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'P2 Ticket', projectId: proj2Id }, userId: owner.id, clientRequestId: `mp-t2-${String(stamp)}` });
  const t2 = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'P2 Ticket' } }));
  assert(t2 !== null, 'quick-add writes the ticket');
  eq(t2?.projectId, proj2Id, 'quick-add with a projectId lands the ticket in that project (not the first)');

  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'P1 Ticket' }, userId: owner.id, clientRequestId: `mp-t1-${String(stamp)}` });
  const t1 = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'P1 Ticket' } }));
  eq(t1?.projectId, proj1?.id, 'quick-add without a projectId falls back to the first project');

  // ---- snapshot scoping: each project sees only its own tickets/stages -----------
  const snapP2 = await buildSnapshot(prisma, owner.id, wsId, proj2Id);
  eq(snapP2.activeProjectId, proj2Id, 'snapshot(projectId) selects that project');
  eq(snapP2.projects.length, 2, 'snapshot lists all workspace projects');
  assert(snapP2.tickets.some((t) => t.title === 'P2 Ticket') && !snapP2.tickets.some((t) => t.title === 'P1 Ticket'), 'snapshot tickets are scoped to the active project');

  const snapP1 = await buildSnapshot(prisma, owner.id, wsId, proj1?.id);
  assert(snapP1.tickets.some((t) => t.title === 'P1 Ticket') && !snapP1.tickets.some((t) => t.title === 'P2 Ticket'), "the first project's snapshot shows only its ticket");

  // ---- service-create → a build unit on project #2 -------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'service-create', target: { projectId: proj2Id }, payload: { name: 'api', path: 'apps/api' }, userId: owner.id, clientRequestId: `mp-sc-${String(stamp)}` });
  const svc = await poll(() => prisma.service.findFirst({ where: { workspaceId: wsId, projectId: proj2Id, name: 'api' } }));
  assert(svc !== null, 'service-create attaches a service to the project');
  const snapP2b = await buildSnapshot(prisma, owner.id, wsId, proj2Id);
  assert(snapP2b.services.some((s) => s.name === 'api' && s.path === 'apps/api'), "the project's snapshot lists its services");
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/multiProject.test.mts');
