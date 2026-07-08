//? M4 — a custom media style (with its preview) round-trips through export → parse → import, so a user can
//? copy/share styles and keep the look. Real Mongo; cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { exportStyleSet, parseStyleSet, importStyleSet, listStyles } = await import('../../server/content/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sx-${String(stamp)}@youcomm.nl`, name: 'SX' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'SX WS' }, userId: owner.id, clientRequestId: `sx-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? Save a custom video style WITH a preview.
  await enqueueControlAction({ workspaceId: wsId, op: 'save-style', target: {}, payload: { feature: 'video-gen', key: 'stick-man', label: 'Stick-man', systemPrompt: 'stick-man figures', previewAssetUrl: '/media/p.mp4', previewKind: 'video' }, userId: owner.id, clientRequestId: `sx-1-${String(stamp)}` });
  await poll(() => prisma.stylePreset.findFirst({ where: { workspaceId: wsId, key: 'stick-man' } }));

  //? Export → the entry carries the preview.
  const exported = await exportStyleSet(prisma, wsId);
  const entry = exported.find((e) => e.key === 'stick-man');
  assert(entry !== undefined, 'the custom style is exported');
  eq(entry?.previewAssetUrl, '/media/p.mp4', 'the export carries the preview asset');

  //? Parse (round-trip through JSON) preserves the preview.
  const roundTripped = parseStyleSet(JSON.parse(JSON.stringify(exported)) as unknown);
  const rt = roundTripped.find((e) => e.key === 'stick-man');
  eq(rt?.previewAssetUrl, '/media/p.mp4', 'parse preserves the preview');

  //? Delete it, then import the parsed set back → the preview is restored.
  await prisma.stylePreset.deleteMany({ where: { workspaceId: wsId, key: 'stick-man' } });
  const written = await importStyleSet(prisma, wsId, roundTripped);
  assert(written >= 1, 'the style-set imports');
  const styles = await listStyles(prisma, wsId, 'video-gen');
  const back = styles.find((s) => s.key === 'stick-man');
  eq(back?.previewAssetUrl, '/media/p.mp4', 'the imported style kept its preview (full round-trip)');
  console.log(`[sx] ✓ style export→parse→import round-trip preserves the preview`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await prisma.stylePreset.deleteMany({ where: { workspaceId } }).catch(() => null);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/styleImportExport.test.mts');
