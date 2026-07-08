//? R1 — pipeline stage structural ops PERSIST through the REAL Conductor + Mongo (the editor previously mutated
//? React state only, so a refresh discarded add/remove/reorder). Verifies: stage-create appends a durable stage,
//? stage-reorder rewrites the `order` of existing stages, and stage-delete removes one — all surviving a re-read.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `stg-${String(stamp)}@youcomm.nl`, name: 'Stg' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Stg WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const before = await prisma.pipelineStage.findMany({ where: { workspaceId: wsId }, orderBy: { order: 'asc' }, select: { key: true, order: true } });
  assert(before.length >= 4, 'the default pipeline seeded stages');
  const maxOrder = Math.max(...before.map((s) => s.order));

  // 1) stage-create → a durable new stage appended at the end.
  await enqueueControlAction({ workspaceId: wsId, op: 'stage-create', target: {}, payload: { key: 'security', name: 'Security review', kind: 'review' }, userId: owner.id, clientRequestId: `stg-c-${String(stamp)}` });
  const newStage = await poll(() => prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, key: 'security' } }));
  assert(newStage !== null, 'the new stage persisted');
  eq(newStage?.name, 'Security review', 'the stage name was stored');
  assert((newStage?.order ?? 0) > maxOrder, 'the new stage is appended after the existing ones');

  // creating a duplicate key is rejected (no second row)
  await enqueueControlAction({ workspaceId: wsId, op: 'stage-create', target: {}, payload: { key: 'security', name: 'Dupe', kind: 'review' }, userId: owner.id, clientRequestId: `stg-dup-${String(stamp)}` });
  await wait(300);
  eq((await prisma.pipelineStage.count({ where: { workspaceId: wsId, key: 'security' } })), 1, 'a duplicate stage key is rejected');

  // 2) stage-reorder → the order is rewritten to the given sequence.
  const keys = (await prisma.pipelineStage.findMany({ where: { workspaceId: wsId }, orderBy: { order: 'asc' }, select: { key: true } })).map((s) => s.key);
  const reversed = [...keys].reverse();
  await enqueueControlAction({ workspaceId: wsId, op: 'stage-reorder', target: {}, payload: { order: reversed }, userId: owner.id, clientRequestId: `stg-r-${String(stamp)}` });
  const after = await poll(async () => {
    const rows = await prisma.pipelineStage.findMany({ where: { workspaceId: wsId }, orderBy: { order: 'asc' }, select: { key: true } });
    return rows.map((r) => r.key).join(',') === reversed.join(',') ? rows : null;
  });
  assert(after !== null, 'the stage order was persisted to the reversed sequence');

  // 3) stage-delete → the stage is removed.
  await enqueueControlAction({ workspaceId: wsId, op: 'stage-delete', target: { stageId: 'security' }, payload: {}, userId: owner.id, clientRequestId: `stg-d-${String(stamp)}` });
  const gone = await poll(async () => (await prisma.pipelineStage.count({ where: { workspaceId: wsId, key: 'security' } })) === 0 ? true : null);
  assert(gone === true, 'the deleted stage is removed');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/pipelineStages.test.mts');
