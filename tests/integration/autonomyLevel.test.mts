//? Test for FREEDOM_PROGRAM A4 — autonomy dials. Verifies the pure resolveStageGate (full-auto skips the
//? gate, gate-every always gates, gate-key-stages honours the stage flag) and that the save-autonomy op
//? persists a valid level + falls back to the default on garbage. Real Conductor + Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { resolveStageGate } = await import('../../server/orchestrator/stageRunner.ts');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

// pure gate semantics
eq(resolveStageGate(true, 'full-auto'), false, 'full-auto skips a gated stage');
eq(resolveStageGate(false, 'full-auto'), false, 'full-auto skips an ungated stage');
eq(resolveStageGate(false, 'gate-every'), true, 'gate-every gates even an ungated stage');
eq(resolveStageGate(true, 'gate-every'), true, 'gate-every gates a gated stage');
eq(resolveStageGate(true, 'gate-key-stages'), true, 'gate-key-stages honours a gated stage');
eq(resolveStageGate(false, 'gate-key-stages'), false, 'gate-key-stages honours an ungated stage');
eq(resolveStageGate(true, undefined), true, 'no level → default (honour the stage flag)');
eq(resolveStageGate(false, 'nonsense'), false, 'unknown level → default');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `aut-${String(stamp)}@youcomm.nl`, name: 'AUT' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'AUT WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  eq((await prisma.workspace.findUnique({ where: { id: wsId } }))?.autonomyLevel, 'gate-key-stages', 'default autonomy level');

  await enqueueControlAction({ workspaceId: wsId, op: 'save-autonomy', target: {}, payload: { autonomyLevel: 'full-auto' }, userId: owner.id, clientRequestId: `aut-1-${String(stamp)}` });
  eq((await prisma.workspace.findUnique({ where: { id: wsId } }))?.autonomyLevel, 'full-auto', 'the level persisted');

  await enqueueControlAction({ workspaceId: wsId, op: 'save-autonomy', target: {}, payload: { autonomyLevel: 'garbage' }, userId: owner.id, clientRequestId: `aut-2-${String(stamp)}` });
  eq((await prisma.workspace.findUnique({ where: { id: wsId } }))?.autonomyLevel, 'gate-key-stages', 'an invalid level falls back to the default');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/autonomyLevel.test.mts');
