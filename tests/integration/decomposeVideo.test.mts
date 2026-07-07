//? Integration test for V3 (IDEA_TO_OUTCOME) — content-decompose-video. Real Conductor + Mongo. From a piece's
//? script beats, the op generates a continuity-linked video scene per beat (stub video without a key) and
//? creates the VideoScenes the multi-clip render (V2) stitches. B-23: the Conductor is the writer.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 12_000, stepMs = 80): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `dv-${String(stamp)}@youcomm.nl`, name: 'DV' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'DV WS' }, userId: owner.id, clientRequestId: `dv-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  const wsId = ws?.id ?? '';
  workspaceId = ws?.id ?? null;

  await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { title: 'Decompose test', brief: 'a 60s multi-scene launch video', format: 'faceless' }, userId: owner.id, clientRequestId: `dv-piece-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Decompose test' } }));
  const pieceId = piece?.id ?? '';

  //? Seed a script + 3 beats directly (the script-gen stub shape is tested elsewhere; here we test decompose).
  const script = await prisma.script.create({ data: { workspaceId: wsId, contentProjectId: pieceId, body: 'the launch story' } });
  await prisma.beat.createMany({ data: [
    { workspaceId: wsId, scriptId: script.id, contentProjectId: pieceId, order: 0, text: 'open', visualPrompt: 'a sunrise' },
    { workspaceId: wsId, scriptId: script.id, contentProjectId: pieceId, order: 1, text: 'reveal', visualPrompt: 'the product' },
    { workspaceId: wsId, scriptId: script.id, contentProjectId: pieceId, order: 2, text: 'close', visualPrompt: 'a logo' },
  ] });

  //? Decompose → a video scene per beat.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-decompose-video', target: {}, payload: { contentProjectId: pieceId, sceneDurationMs: 15_000 }, userId: owner.id, clientRequestId: `dv-dec-${String(stamp)}` });
  const scenes = await poll(async () => { const s = await prisma.videoScene.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId }, orderBy: { order: 'asc' } }); return s.length === 3 ? s : null; });
  assert(scenes !== null && scenes.length === 3, 'a scene was created per beat');
  eq(scenes?.[0]?.transitionIn, 'cut', 'the first scene is a hard cut');
  eq(scenes?.[1]?.transitionIn, 'xfade', 'later scenes crossfade in (flow together)');
  eq(scenes?.[2]?.transitionIn, 'xfade', 'the last scene crossfades in too');
  eq(scenes?.[0]?.durationMs, 15_000, 'the requested per-scene duration was applied');
  assert(Boolean(scenes?.every((s) => (s.videoAssetId ?? '').length > 0)), 'every scene links a generated video asset (stub without a key)');
  assert((scenes?.[1]?.prompt ?? '').includes('Continues seamlessly'), 'scene 2 carries the continuity prompt');
  assert(!((scenes?.[0]?.prompt ?? '').includes('Continues seamlessly')), 'scene 1 has no continuity hint');

  //? Re-decompose REPLACES (not appends).
  await enqueueControlAction({ workspaceId: wsId, op: 'content-decompose-video', target: {}, payload: { contentProjectId: pieceId }, userId: owner.id, clientRequestId: `dv-dec2-${String(stamp)}` });
  const again = await poll(async () => { const s = await prisma.videoScene.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId } }); return s.length > 0 ? s : null; });
  eq(again?.length, 3, 're-decomposing replaces the scenes (still 3, not 6)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/decomposeVideo.test.mts');
