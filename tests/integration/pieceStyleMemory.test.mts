//? Piece default-style — the piece REMEMBERS the style used, so a standalone timeline "decompose" (which
//? carries no style) stays on-style. Real Mongo + stub media (no keys). Proves: decompose-with-style persists
//? piece.styleKey; a later empty-payload decompose reuses it (fallback) and doesn't clear it. Cleans up.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 10000, stepMs = 80): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `pm-${String(stamp)}@youcomm.nl`, name: 'PM' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'PM WS' }, userId: owner.id, clientRequestId: `pm-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));

  await prisma.stylePreset.create({ data: { workspaceId: wsId, feature: 'video-gen', key: 'stick-man', label: 'Stick-man', systemPrompt: 'stick-man figures', builtin: false } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', title: 'Clip' } });
  const script = await prisma.script.create({ data: { workspaceId: wsId, contentProjectId: piece.id, body: 'b', providerId: 'stub' } });
  await prisma.beat.create({ data: { workspaceId: wsId, scriptId: script.id, contentProjectId: piece.id, order: 0, text: 'a rocket launches', visualPrompt: 'a rocket' } });
  await prisma.beat.create({ data: { workspaceId: wsId, scriptId: script.id, contentProjectId: piece.id, order: 1, text: 'the moon', visualPrompt: 'the moon' } });

  //? Decompose WITH a style → the piece remembers it.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-decompose-video', target: { contentProjectId: piece.id }, payload: { contentProjectId: piece.id, styleKey: 'stick-man' }, userId: owner.id, clientRequestId: `pm-d1-${String(stamp)}` });
  const remembered = await poll(async () => { const p = await prisma.contentProject.findUnique({ where: { id: piece.id }, select: { styleKey: true } }); return p?.styleKey === 'stick-man' ? p : null; });
  eq(remembered?.styleKey, 'stick-man', 'the piece remembered the style used in decompose');

  //? Decompose again with NO style (like the timeline editor) → the remembered style is NOT cleared (fallback).
  await enqueueControlAction({ workspaceId: wsId, op: 'content-decompose-video', target: { contentProjectId: piece.id }, payload: { contentProjectId: piece.id }, userId: owner.id, clientRequestId: `pm-d2-${String(stamp)}` });
  await wait(1200);
  const after = await prisma.contentProject.findUnique({ where: { id: piece.id }, select: { styleKey: true } });
  eq(after?.styleKey, 'stick-man', 'a style-less decompose keeps (falls back to) the remembered style');
  const scenes = await prisma.videoScene.count({ where: { workspaceId: wsId, contentProjectId: piece.id } });
  assert(scenes >= 1, 'the style-less decompose still produced scenes (using the remembered style)');
  console.log(`[pm] ✓ piece remembers style "${after?.styleKey ?? ''}"; ${String(scenes)} scenes`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/pieceStyleMemory.test.mts');
