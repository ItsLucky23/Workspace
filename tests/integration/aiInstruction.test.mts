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

  await enqueueControlAction({ workspaceId: wsId, op: 'save-ai-instruction', target: {}, payload: { aiInstruction: 'Always be concise. Never invent statistics.', outputLanguage: 'Dutch', geminiModel: 'gemini-2.5-pro', geminiTemperature: '0.4', geminiBaseUrl: 'https://my-proxy.test/v1' }, userId: owner.id, clientRequestId: `aii-1-${String(stamp)}` });
  const w1 = await prisma.workspace.findUnique({ where: { id: wsId } });
  eq(w1?.aiInstruction, 'Always be concise. Never invent statistics.', 'the AI instruction persisted');
  eq(w1?.outputLanguage, 'Dutch', 'K4 — the output language persisted');
  eq(w1?.geminiModel, 'gemini-2.5-pro', 'P2 — the Gemini model persisted');
  eq(w1?.geminiTemperature, '0.4', 'P2 — the Gemini temperature persisted');
  eq(w1?.geminiBaseUrl, 'https://my-proxy.test/v1', 'X4 — the Gemini base URL persisted');

  await enqueueControlAction({ workspaceId: wsId, op: 'save-ai-instruction', target: {}, payload: { aiInstruction: '', outputLanguage: '' }, userId: owner.id, clientRequestId: `aii-2-${String(stamp)}` });
  const w2 = await prisma.workspace.findUnique({ where: { id: wsId } });
  eq(w2?.aiInstruction, '', 'clearing the instruction persists empty');
  eq(w2?.outputLanguage, '', 'clearing the language persists empty (auto)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/aiInstruction.test.mts');
