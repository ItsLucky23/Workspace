//? M1 — a style carries a PREVIEW asset (thumbnail gallery). Real Mongo: the save-style op persists
//? previewAssetUrl/previewKind, the snapshot surfaces them on content.styles, and listStyles carries them.
//? Creates + cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { listStyles } = await import('../../server/content/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sp-${String(stamp)}@youcomm.nl`, name: 'SP' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'SP WS' }, userId: owner.id, clientRequestId: `sp-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? Save a video-gen style WITH a preview asset.
  await enqueueControlAction({ workspaceId: wsId, op: 'save-style', target: {}, payload: { feature: 'video-gen', key: 'stick-man', label: 'Stick-man', systemPrompt: 'stick-man figures', previewAssetUrl: '/media/preview-stickman.mp4', previewKind: 'video' }, userId: owner.id, clientRequestId: `sp-1-${String(stamp)}` });
  const saved = await poll(() => prisma.stylePreset.findFirst({ where: { workspaceId: wsId, key: 'stick-man' } }));
  assert(saved !== null, 'the style persisted');
  eq(saved?.previewAssetUrl, '/media/preview-stickman.mp4', 'the preview asset url persisted');
  eq(saved?.previewKind, 'video', 'the preview kind persisted');

  //? listStyles carries the preview (the picker/gallery input).
  const styles = await listStyles(prisma, wsId, 'video-gen');
  const s = styles.find((x) => x.key === 'stick-man');
  eq(s?.previewAssetUrl, '/media/preview-stickman.mp4', 'listStyles carries the preview asset');

  //? The snapshot surfaces the preview on content.styles.
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  const snapStyle = snap.content.styles.find((x) => x.key === 'stick-man');
  eq(snapStyle?.previewAssetUrl, '/media/preview-stickman.mp4', 'the snapshot carries the style preview');
  eq(snapStyle?.previewKind, 'video', 'the snapshot carries the preview kind');
  console.log(`[sp] ✓ style preview round-trips: ${snapStyle?.previewAssetUrl ?? ''}`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await prisma.stylePreset.deleteMany({ where: { workspaceId } }).catch(() => null);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/stylePreview.test.mts');
