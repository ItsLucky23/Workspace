//? Integration test — a per-workspace Gemini credential makes the gemini-api text backend available.
//? F-001 (fix-round 2026-08-22) made the AiConnection the ONE owner of the text key: the old
//? `__provider_key_gemini` EnvVar (save-media-provider) is no longer read by the text path, so availability
//? comes purely from a connected backend. Real Conductor + Mongo; the default test world has no WS_GEMINI_API_KEY
//? env, so nothing but the connection can make it available.

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { aiProviderById } = await import('../../server/ai/registry');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `gwk-${String(stamp)}@youcomm.nl`, name: 'GWK' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'GWK WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const gemini = aiProviderById('gemini-api');
  assert(gemini !== undefined, 'gemini-api is a catalog backend');
  if (!gemini) throw new Error('gemini-api missing');

  assert((await gemini.available()) === false, 'no env key + no workspace → gemini unavailable');
  assert((await gemini.available(wsId)) === false, 'no connection yet → still unavailable for the workspace');

  //? The legacy media-provider store does NOT feed the text backend any more (single owner = AiConnection).
  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { providerId: 'gemini', apiKey: 'gemini-secret-123' }, userId: owner.id, clientRequestId: `gwk-k-${String(stamp)}` });
  assert((await gemini.available(wsId)) === false, 'a legacy __provider_key_gemini EnvVar alone does not make the text backend available');

  // connect the backend the supported way
  await enqueueControlAction({ workspaceId: wsId, op: 'ai-connection-add', target: {}, payload: { providerId: 'gemini-api', model: 'gemini-2.5-flash', apiKey: 'gemini-secret-123' }, userId: owner.id, clientRequestId: `gwk-c-${String(stamp)}` });
  const row = await prisma.aiConnection.findFirst({ where: { workspaceId: wsId, providerId: 'gemini-api' } });
  assert(row !== null && (row.apiKey ?? '').length > 0 && !(row?.apiKey ?? '').includes('gemini-secret-123'), 'the connection key is stored ENCRYPTED');

  assert((await gemini.available(wsId)) === true, 'a connected gemini-api backend is available for the workspace');
  assert((await gemini.available()) === false, 'without a workspace it is still unavailable (no env key)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/geminiWorkspaceKey.test.mts');
