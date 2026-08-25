//? Integration test for FREEDOM_PROGRAM Q4 — the workspace-wide AI instruction. Verifies the
//? save-ai-instruction control-op persists Workspace.aiInstruction (the value runAiCompletion prepends to
//? every completion's system prompt). Real Conductor + Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `aii-${String(stamp)}@youcomm.nl`, name: 'AII' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'AII WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  eq((await prisma.workspace.findUnique({ where: { id: wsId } }))?.aiInstruction, '', 'aiInstruction starts empty');

  await enqueueControlAction({ workspaceId: wsId, op: 'save-ai-instruction', target: {}, payload: { aiInstruction: 'Always be concise. Never invent statistics.', outputLanguage: 'Dutch', assistantTokenBudget: 70000.9, handoffInstruction: 'Focus on open decisions.' }, userId: owner.id, clientRequestId: `aii-1-${String(stamp)}` });
  const w1 = await prisma.workspace.findUnique({ where: { id: wsId } });
  eq(w1?.aiInstruction, 'Always be concise. Never invent statistics.', 'the AI instruction persisted');
  eq(w1?.outputLanguage, 'Dutch', 'K4 — the output language persisted');
  eq(w1?.assistantTokenBudget, 70000, 'the per-workspace token budget persisted (floored to an int)');
  eq(w1?.handoffInstruction, 'Focus on open decisions.', 'the custom handoff instruction persisted');

  await enqueueControlAction({ workspaceId: wsId, op: 'save-ai-instruction', target: {}, payload: { aiInstruction: '', outputLanguage: '', assistantTokenBudget: 0, handoffInstruction: '' }, userId: owner.id, clientRequestId: `aii-2-${String(stamp)}` });
  const w2 = await prisma.workspace.findUnique({ where: { id: wsId } });
  eq(w2?.aiInstruction, '', 'clearing the instruction persists empty');
  eq(w2?.outputLanguage, '', 'clearing the language persists empty (auto)');
  eq(w2?.assistantTokenBudget, null, 'a zero budget clears back to null (= env default)');
  eq(w2?.handoffInstruction, '', 'clearing the handoff instruction persists empty (= built-in template)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/aiInstruction.test.mts');
