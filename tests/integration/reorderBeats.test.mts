//? Test for FREEDOM_PROGRAM E3 (video timeline backend) — content-reorder-beats. Verifies the op persists a new
//? beat ORDER + per-beat DURATION (trim), and that the render plan (buildFfmpegPlan over the reordered beats,
//? which the assembly reads orderBy order) reflects the new sequence + on-screen times. Real Conductor + Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { buildFfmpegPlan } = await import('../../server/content/render.ts');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rb-${String(stamp)}@youcomm.nl`, name: 'RB' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'RB WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'Piece' } });
  const script = await prisma.script.create({ data: { workspaceId: wsId, contentProjectId: piece.id, body: 'x' } });
  const b0 = await prisma.beat.create({ data: { workspaceId: wsId, scriptId: script.id, contentProjectId: piece.id, order: 0, text: 'A', imageAssetId: null, durationMs: 3000 } });
  const b1 = await prisma.beat.create({ data: { workspaceId: wsId, scriptId: script.id, contentProjectId: piece.id, order: 1, text: 'B', imageAssetId: null, durationMs: 3000 } });

  // reorder (swap) + trim b1 to 1s
  await enqueueControlAction({ workspaceId: wsId, op: 'content-reorder-beats', target: {}, payload: { contentProjectId: piece.id, beats: [{ beatId: b0.id, order: 1 }, { beatId: b1.id, order: 0, durationMs: 1000 }] }, userId: owner.id, clientRequestId: `rb-1-${String(stamp)}` });

  const beats = await prisma.beat.findMany({ where: { workspaceId: wsId, scriptId: script.id }, orderBy: { order: 'asc' } });
  eq(beats[0].id, b1.id, 'B is now first (reordered)');
  eq(beats[0].durationMs, 1000, 'B was trimmed to 1s');
  eq(beats[1].id, b0.id, 'A is now second');

  // the render plan reflects the new sequence + durations
  const plan = buildFfmpegPlan(beats.map((b) => ({ imageFile: `${b.text}.png`, durationMs: b.durationMs ?? 3000 })), null, 'l.txt', 'o.mp4');
  assert(plan.concatList.indexOf("file 'B.png'") < plan.concatList.indexOf("file 'A.png'"), 'the plan lists B before A');
  assert(plan.concatList.includes('duration 1.00'), 'the plan honours the 1s trim');

  // a duration below the floor is clamped
  await enqueueControlAction({ workspaceId: wsId, op: 'content-reorder-beats', target: {}, payload: { contentProjectId: piece.id, beats: [{ beatId: b1.id, durationMs: 50 }] }, userId: owner.id, clientRequestId: `rb-2-${String(stamp)}` });
  eq((await prisma.beat.findUnique({ where: { id: b1.id } }))?.durationMs, 500, 'a too-short trim is clamped to the 500ms floor');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/reorderBeats.test.mts');
