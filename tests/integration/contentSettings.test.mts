//? Integration test for U3 — the media settings control-ops persist (via the Conductor, B-23). Verifies
//? save-media-provider stores an ENCRYPTED provider key in the unified AiConnection store (Fase 5.2)
//? plus a per-feature provider override in the EnvVar store, and edit-media-budget upserts the
//? MediaBudget. Real Mongo; creates + cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { decryptSecret } = await import('../../server/crypto/secretBox');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cset-${String(stamp)}@youcomm.nl`, name: 'CSet Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'CSet WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  // 1) save an encrypted provider key — Fase 5.2: the key lands in the unified AiConnection store
  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { providerId: 'fal', apiKey: 'fal-secret-key' }, userId: owner.id, clientRequestId: `cset-k-${String(stamp)}` });
  const keyRow = await prisma.aiConnection.findFirst({ where: { workspaceId: wsId, providerId: 'fal' } });
  assert(keyRow !== null, 'the media key creates an AiConnection row (the unified store)');
  assert(!(keyRow?.apiKey ?? '').includes('fal-secret-key'), 'the key is stored ENCRYPTED (not plaintext)');
  eq(decryptSecret(keyRow?.apiKey ?? ''), 'fal-secret-key', 'the stored key decrypts back');
  const legacyRow = await prisma.envVar.findFirst({ where: { workspaceId: wsId, key: '__provider_key_fal' } });
  eq(legacyRow, null, 'no legacy __provider_key_fal EnvVar is written any more');

  // 2) save a per-feature provider override
  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { feature: 'image-gen', providerId: 'fal' }, userId: owner.id, clientRequestId: `cset-o-${String(stamp)}` });
  const overrideRow = await prisma.envVar.findFirst({ where: { workspaceId: wsId, key: '__media_provider_image-gen' } });
  eq(overrideRow?.value, 'fal', 'the per-feature provider override is stored');
  assert(overrideRow?.secret === false, 'the override is not a secret');

  // 3) updating the key upserts (no duplicate connection row)
  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { providerId: 'fal', apiKey: 'rotated-key' }, userId: owner.id, clientRequestId: `cset-k2-${String(stamp)}` });
  const keyRows = await prisma.aiConnection.findMany({ where: { workspaceId: wsId, providerId: 'fal' } });
  eq(keyRows.length, 1, 'saving again upserts (no duplicate)');
  eq(decryptSecret(keyRows[0]?.apiKey ?? ''), 'rotated-key', 'the key was rotated');

  // 4) media budget upserts
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 500, alertPct: 75, enabled: true }, userId: owner.id, clientRequestId: `cset-b-${String(stamp)}` });
  const budget = await prisma.mediaBudget.findFirst({ where: { workspaceId: wsId } });
  assert(budget?.enabled === true && budget.capCents === 500 && budget.alertPct === 75, 'the media budget persisted');

  // 5) Q3 — save a per-workspace style, upsert it, then delete it
  await enqueueControlAction({ workspaceId: wsId, op: 'save-style', target: {}, payload: { feature: 'image-gen', key: 'bold-min', label: 'Bold', systemPrompt: 'bold minimal look' }, userId: owner.id, clientRequestId: `cset-s1-${String(stamp)}` });
  const style = await prisma.stylePreset.findFirst({ where: { workspaceId: wsId, feature: 'image-gen', key: 'bold-min' } });
  assert(style?.systemPrompt === 'bold minimal look' && style.builtin === false, 'a per-workspace style is saved (not builtin)');
  await enqueueControlAction({ workspaceId: wsId, op: 'save-style', target: {}, payload: { feature: 'image-gen', key: 'bold-min', label: 'Bolder', systemPrompt: 'even bolder' }, userId: owner.id, clientRequestId: `cset-s2-${String(stamp)}` });
  const styleRows = await prisma.stylePreset.findMany({ where: { workspaceId: wsId, feature: 'image-gen', key: 'bold-min' } });
  eq(styleRows.length, 1, 'save-style upserts (no duplicate)');
  eq(styleRows[0]?.systemPrompt, 'even bolder', 'the style was updated');
  await enqueueControlAction({ workspaceId: wsId, op: 'delete-style', target: {}, payload: { feature: 'image-gen', key: 'bold-min' }, userId: owner.id, clientRequestId: `cset-sd-${String(stamp)}` });
  eq(await prisma.stylePreset.findFirst({ where: { workspaceId: wsId, feature: 'image-gen', key: 'bold-min' } }), null, 'delete-style removes the per-workspace style');

  // 6) Q2 — product context persists on the workspace
  await enqueueControlAction({ workspaceId: wsId, op: 'content-edit-product', target: {}, payload: { productContext: 'we sell shoes' }, userId: owner.id, clientRequestId: `cset-pc-${String(stamp)}` });
  eq((await prisma.workspace.findUnique({ where: { id: wsId } }))?.productContext, 'we sell shoes', 'product context persists on the workspace');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentSettings.test.mts');
