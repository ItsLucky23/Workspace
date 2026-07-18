//? Integration test for FREEDOM_PROGRAM Q6 — the stage persona/definition-of-done are now editable. Verifies
//? the save-stage-config control-op persists systemPrompt (the agent persona → --append-system-prompt) and
//? definitionOfDone (previously the op ignored definitionOfDone + the UI had no fields). Real Conductor + Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sp-${String(stamp)}@youcomm.nl`, name: 'SP' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'SP WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  const stage = await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId } });
  assert(stage != null, 'the default pipeline seeded at least one stage');
  const stageKey = stage?.key ?? '';

  await enqueueControlAction({
    workspaceId: wsId, op: 'save-stage-config', target: { stageId: stageKey, projectId: stage?.projectId ?? '' },
    payload: { id: stageKey, systemPrompt: 'You are a rigorous staff engineer.', definitionOfDone: 'All tests pass.' },
    userId: owner.id, clientRequestId: `sp-1-${String(stamp)}`,
  });

  const after = await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, projectId: stage?.projectId ?? '', key: stageKey } });
  eq(after?.systemPrompt, 'You are a rigorous staff engineer.', 'the stage persona (systemPrompt) persisted');
  eq(after?.definitionOfDone, 'All tests pass.', 'the definition of done persisted (op previously ignored it)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/stagePersona.test.mts');
