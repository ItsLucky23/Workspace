//? Integration test for FREEDOM_PROGRAM P3 — per-request + per-workspace media model choice. Verifies
//? composeFalInput uses a per-request `params.model` (and strips it from the input body), and the extended
//? save-media-provider op stores a per-feature `__media_model_<feature>` override that loadWorkspaceMediaConfig
//? reads back ('default' clears it). Real Conductor + Mongo; composeFalInput is pure.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { composeFalInput } = await import('../../server/media/providers/fal');
const { loadWorkspaceMediaConfig } = await import('../../server/media/workspaceKeys');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `mmo-${String(stamp)}@youcomm.nl`, name: 'MMO' } });
let workspaceId: string | null = null;

try {
  // (a) per-request model override picks the fal model + is stripped from the input
  const withModel = composeFalInput({ feature: 'image-gen', prompt: 'a cube', params: { model: 'fal-ai/custom-fast-model', num_images: 1 } });
  eq(withModel.model, 'fal-ai/custom-fast-model', 'params.model picks the fal model id');
  assert(!('model' in withModel.input), 'model is stripped from the input body (a routing param)');
  eq(withModel.input.num_images, 1, 'other params still flow into the input');
  const noModel = composeFalInput({ feature: 'image-gen', prompt: 'a cube' });
  assert(noModel.model.length > 0 && noModel.model !== 'fal-ai/custom-fast-model', 'no override → the built-in default model');

  // (b) per-workspace model override persists + loads
  const created = await createBlankWorkspace(prisma, owner.id, 'MMO WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { feature: 'model-3d', model: 'fal-ai/some-low-poly-3d' }, userId: owner.id, clientRequestId: `mmo-1-${String(stamp)}` });
  const cfg = await loadWorkspaceMediaConfig(prisma, wsId);
  eq(cfg.models['model-3d'], 'fal-ai/some-low-poly-3d', 'the per-workspace model override is loaded');

  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { feature: 'model-3d', model: 'default' }, userId: owner.id, clientRequestId: `mmo-2-${String(stamp)}` });
  const cleared = await loadWorkspaceMediaConfig(prisma, wsId);
  assert(cleared.models['model-3d'] === undefined, "'default' clears the model override");
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/mediaModelOverride.test.mts');
