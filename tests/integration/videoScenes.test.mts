//? Integration test for V1 (IDEA_TO_OUTCOME) — the video-timeline scene model + the content-save-scenes op.
//? Real Conductor + Mongo. Saving from the timeline editor replaces the piece's ordered scene list (upsert by
//? id: existing scenes keep their id, new ones are created, dropped ones removed). The multi-clip render (V2)
//? reads these ordered. B-23: the Conductor is the writer.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `vs-${String(stamp)}@youcomm.nl`, name: 'VS' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'VS WS' }, userId: owner.id, clientRequestId: `vs-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  const wsId = ws?.id ?? '';
  workspaceId = ws?.id ?? null;

  //? A content piece to attach scenes to.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { title: 'Scene test', brief: 'a 60s multi-scene video', format: 'faceless' }, userId: owner.id, clientRequestId: `vs-piece-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Scene test' } }));
  const pieceId = piece?.id ?? '';
  assert(pieceId.length > 0, 'the content piece was created');

  //? 1) save an ordered list of 2 scenes.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-save-scenes', target: {}, payload: { contentProjectId: pieceId, scenes: [
    { videoAssetId: 'clipA', durationMs: 15_000, transitionIn: 'cut' },
    { imageAssetId: 'imgB', durationMs: 8000, startTrimMs: 500, transitionIn: 'xfade', prompt: 'the reveal' },
  ] }, userId: owner.id, clientRequestId: `vs-save1-${String(stamp)}` });
  const first = await poll(async () => { const s = await prisma.videoScene.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId }, orderBy: { order: 'asc' } }); return s.length === 2 ? s : null; });
  assert(first !== null && first.length === 2, 'two scenes were saved');
  eq(first?.[0]?.order, 0, 'scene 0 keeps order 0');
  eq(first?.[0]?.videoAssetId, 'clipA', 'scene 0 is the video clip');
  eq(first?.[0]?.durationMs, 15_000, 'scene 0 duration persisted');
  eq(first?.[1]?.transitionIn, 'xfade', 'scene 1 transition persisted');
  eq(first?.[1]?.startTrimMs, 500, 'scene 1 trim-in persisted');
  const keptId = first?.[0]?.id ?? '';

  //? 2) re-save: keep scene 0 (by id) with a new duration, DROP scene 1, ADD a new scene → upsert semantics.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-save-scenes', target: {}, payload: { contentProjectId: pieceId, scenes: [
    { id: keptId, videoAssetId: 'clipA', durationMs: 12_000, transitionIn: 'cut' },
    { videoAssetId: 'clipC', durationMs: 10_000, transitionIn: 'fade' },
  ] }, userId: owner.id, clientRequestId: `vs-save2-${String(stamp)}` });
  const second = await poll(async () => { const s = await prisma.videoScene.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId }, orderBy: { order: 'asc' } }); return (s.length === 2 && s[0]?.durationMs === 12_000) ? s : null; });
  assert(second !== null && second.length === 2, 'the list still has 2 scenes after the re-save (one dropped, one added)');
  eq(second?.[0]?.id, keptId, 'scene 0 kept its id (upsert, not recreate) — lineage-safe');
  eq(second?.[0]?.durationMs, 12_000, 'scene 0 duration was updated');
  eq(second?.[1]?.videoAssetId, 'clipC', 'the new scene was appended at order 1');
  assert(!second?.some((s) => s.videoAssetId === 'imgB' || s.imageAssetId === 'imgB'), 'the dropped scene is gone');

  //? 3) it surfaces in the read snapshot for the editor.
  const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  const snapPiece = snap.content.pieces.find((p) => p.id === pieceId);
  eq(snapPiece?.scenes.length, 2, 'the snapshot exposes the 2 scenes to the timeline editor');
  eq(snapPiece?.scenes[0]?.transitionIn, 'cut', 'the snapshot carries the scene fields');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/videoScenes.test.mts');
