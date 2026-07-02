//? Integration test for quick-add WITH a sprintId (the backlog per-sprint / global
//? "New ticket" path — point 3). Runs against the REAL Conductor + Mongo: a quick-add
//? carrying a sprintId must land the ticket in that sprint (at the unrefined stage),
//? and a quick-add without a sprintId must leave it un-sprinted (backlog).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

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
const owner = await prisma.user.create({ data: { email: `qas-${String(stamp)}@youcomm.nl`, name: 'QAS Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'QAS WS');
  workspaceId = created.workspaceId;
  const sprint = await prisma.sprint.create({ data: { workspaceId, name: 'Sprint X', active: false } });

  // quick-add WITH a sprintId → lands in that sprint at unrefined
  await enqueueControlAction({ workspaceId, op: 'quick-add', target: {}, payload: { title: 'In sprint', sprintId: sprint.id }, userId: owner.id, clientRequestId: `qas-${String(stamp)}` });
  const inSprint = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', title: 'In sprint' } }));
  assert(inSprint !== null, 'quick-add with a sprintId created the ticket');
  eq(inSprint?.sprintId, sprint.id, 'the ticket is placed in the given sprint');
  eq(inSprint?.stageId, 'unrefined', 'the ticket still enters at the unrefined stage');

  // quick-add WITHOUT a sprintId → un-sprinted (backlog)
  await enqueueControlAction({ workspaceId, op: 'quick-add', target: {}, payload: { title: 'No sprint' }, userId: owner.id, clientRequestId: `qas2-${String(stamp)}` });
  const noSprint = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: workspaceId ?? '', title: 'No sprint' } }));
  assert(noSprint !== null, 'quick-add without a sprintId created the ticket');
  eq(noSprint?.sprintId, null, 'a sprintless quick-add lands in the backlog (sprintId null)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/quickAddSprint.test.mts');
