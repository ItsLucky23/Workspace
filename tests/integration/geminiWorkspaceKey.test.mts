//? Integration test for FREEDOM_PROGRAM Q5 — the Gemini dead-key fix. A per-workspace Gemini key (stored via
//? save-media-provider as `__provider_key_gemini`) now makes the gemini-api text provider available + is used
//? by it (was dead: stored but consumed by nothing). Real Conductor + Mongo; the default test world has no
//? GEMINI_API_KEY env, so availability comes purely from the stored workspace key.

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { geminiApiProvider } = await import('../../server/ai/providers/geminiApi');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `gwk-${String(stamp)}@youcomm.nl`, name: 'GWK' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'GWK WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  assert((await geminiApiProvider.available()) === false, 'no env key + no workspace → gemini unavailable');
  assert((await geminiApiProvider.available(wsId)) === false, 'no stored key yet → still unavailable for the workspace');

  // store a per-workspace Gemini key via the settings control-op
  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { providerId: 'gemini', apiKey: 'gemini-secret-123' }, userId: owner.id, clientRequestId: `gwk-k-${String(stamp)}` });
  const row = await prisma.envVar.findFirst({ where: { workspaceId: wsId, key: '__provider_key_gemini' } });
  assert(row?.secret === true && !(row.value).includes('gemini-secret-123'), 'the Gemini key is stored ENCRYPTED');

  assert((await geminiApiProvider.available(wsId)) === true, 'the stored workspace Gemini key makes the provider available (dead-key fixed)');
  assert((await geminiApiProvider.available()) === false, 'without a workspace it is still unavailable (no env key)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/geminiWorkspaceKey.test.mts');
