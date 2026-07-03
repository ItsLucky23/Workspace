//? Integration test for the bulk board control-ops (server/orchestrator/conductor.ts):
//? bulk-move / bulk-status / bulk-assign / bulk-archive. Runs against the REAL Conductor
//? + Mongo: create a workspace, quick-add a few tickets, then run each bulk op over their
//? DEV-#### keys and assert the write persisted. The bulk-* ops all take
//? `target.ticketIds` (an array of ticket KEYS) + an op-specific `payload` value.

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
const owner = await prisma.user.create({ data: { email: `bulk-${String(stamp)}@youcomm.nl`, name: 'Bulk Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Bulk WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  //? Quick-add three tickets (each enters at `unrefined`); collect their DEV-#### keys.
  const keys: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const title = `Bulk ticket ${String(i)} ${String(stamp)}`;
    await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title }, userId: owner.id, clientRequestId: `bulk-add-${String(i)}-${String(stamp)}` });
    const t = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title } }));
    assert(t !== null, `quick-add created ticket ${String(i)}`);
    if (t?.key) keys.push(t.key);
  }
  eq(keys.length, 3, 'collected all three ticket keys');

  //? bulk-move → assert every ticket's stageId flipped to the target stage.
  await enqueueControlAction({ workspaceId: wsId, op: 'bulk-move', target: { ticketIds: keys }, payload: { stageId: 'refined' }, userId: owner.id, clientRequestId: `bulk-move-${String(stamp)}` });
  const moved = await poll(async () => {
    const rows = await prisma.ticket.findMany({ where: { workspaceId: wsId, key: { in: keys } } });
    return rows.length === 3 && rows.every((r) => r.stageId === 'refined') ? rows : null;
  });
  assert(moved !== null, 'bulk-move set stageId=refined on all tickets');

  //? bulk-status → assert every ticket's status flipped.
  await enqueueControlAction({ workspaceId: wsId, op: 'bulk-status', target: { ticketIds: keys }, payload: { status: 'paused' }, userId: owner.id, clientRequestId: `bulk-status-${String(stamp)}` });
  const statused = await poll(async () => {
    const rows = await prisma.ticket.findMany({ where: { workspaceId: wsId, key: { in: keys } } });
    return rows.length === 3 && rows.every((r) => r.status === 'paused') ? rows : null;
  });
  assert(statused !== null, 'bulk-status set status=paused on all tickets');

  //? bulk-assign → assign to the owner (self, so no notification side effect); assert assigneeId.
  await enqueueControlAction({ workspaceId: wsId, op: 'bulk-assign', target: { ticketIds: keys }, payload: { assigneeId: owner.id }, userId: owner.id, clientRequestId: `bulk-assign-${String(stamp)}` });
  const assigned = await poll(async () => {
    const rows = await prisma.ticket.findMany({ where: { workspaceId: wsId, key: { in: keys } } });
    return rows.length === 3 && rows.every((r) => r.assigneeId === owner.id) ? rows : null;
  });
  assert(assigned !== null, 'bulk-assign set assigneeId on all tickets');

  //? bulk-archive → assert archived=true on all tickets.
  await enqueueControlAction({ workspaceId: wsId, op: 'bulk-archive', target: { ticketIds: keys }, payload: {}, userId: owner.id, clientRequestId: `bulk-archive-${String(stamp)}` });
  const archived = await poll(async () => {
    const rows = await prisma.ticket.findMany({ where: { workspaceId: wsId, key: { in: keys } } });
    return rows.length === 3 && rows.every((r) => r.archived === true) ? rows : null;
  });
  assert(archived !== null, 'bulk-archive set archived=true on all tickets');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/bulkOps.test.mts');
