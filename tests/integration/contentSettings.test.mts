//? Integration test for U3 — the media settings control-ops persist (via the Conductor, B-23). Verifies
//? save-media-provider stores an ENCRYPTED provider key + a per-feature provider override in the EnvVar
//? store, and edit-media-budget upserts the MediaBudget. Real Mongo; creates + cleans up its own data.

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

  // 1) save an encrypted provider key
  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { providerId: 'fal', apiKey: 'fal-secret-key' }, userId: owner.id, clientRequestId: `cset-k-${String(stamp)}` });
  const keyRow = await prisma.envVar.findFirst({ where: { workspaceId: wsId, key: '__provider_key_fal' } });
  assert(keyRow?.secret === true, 'the provider key EnvVar is marked secret');
  assert(!(keyRow?.value ?? '').includes('fal-secret-key'), 'the key is stored ENCRYPTED (not plaintext)');
  eq(decryptSecret(keyRow?.value ?? ''), 'fal-secret-key', 'the stored key decrypts back');

  // 2) save a per-feature provider override
  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { feature: 'image-gen', providerId: 'fal' }, userId: owner.id, clientRequestId: `cset-o-${String(stamp)}` });
  const overrideRow = await prisma.envVar.findFirst({ where: { workspaceId: wsId, key: '__media_provider_image-gen' } });
  eq(overrideRow?.value, 'fal', 'the per-feature provider override is stored');
  assert(overrideRow?.secret === false, 'the override is not a secret');

  // 3) updating the key upserts (no duplicate)
  await enqueueControlAction({ workspaceId: wsId, op: 'save-media-provider', target: {}, payload: { providerId: 'fal', apiKey: 'rotated-key' }, userId: owner.id, clientRequestId: `cset-k2-${String(stamp)}` });
  const keyRows = await prisma.envVar.findMany({ where: { workspaceId: wsId, key: '__provider_key_fal' } });
  eq(keyRows.length, 1, 'saving again upserts (no duplicate)');
  eq(decryptSecret(keyRows[0]?.value ?? ''), 'rotated-key', 'the key was rotated');

  // 4) media budget upserts
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 500, alertPct: 75, enabled: true }, userId: owner.id, clientRequestId: `cset-b-${String(stamp)}` });
  const budget = await prisma.mediaBudget.findFirst({ where: { workspaceId: wsId } });
  assert(budget?.enabled === true && budget.capCents === 500 && budget.alertPct === 75, 'the media budget persisted');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentSettings.test.mts');
