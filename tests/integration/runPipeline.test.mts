//? Integration test for O-C (IDEA_TO_OUTCOME) — content-run-pipeline. Real Conductor + Mongo. ONE op turns a
//? piece into a complete video: script → voice → scenes → assemble, without clicking each step. Everything
//? stubs without keys, but the STRUCTURE (script/voice/scenes/render) is real. B-23: the Conductor writes.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 20_000, stepMs = 120): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rp-${String(stamp)}@youcomm.nl`, name: 'RP' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'RP WS' }, userId: owner.id, clientRequestId: `rp-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  const wsId = ws?.id ?? '';
  workspaceId = ws?.id ?? null;

  await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { title: 'Pipeline test', brief: 'a launch hype video', format: 'faceless' }, userId: owner.id, clientRequestId: `rp-p-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Pipeline test' } }));
  const pieceId = piece?.id ?? '';

  //? ONE op runs the whole chain.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-run-pipeline', target: {}, payload: { contentProjectId: pieceId, mode: 'video' }, userId: owner.id, clientRequestId: `rp-run-${String(stamp)}` });

  //? The render asset is the LAST step → wait for it, then assert every stage produced its artifact.
  const render = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'render' } }));
  assert(render !== null, 'the pipeline produced a final render asset (assemble ran)');

  const script = await prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId } });
  assert(script !== null, 'a script was generated');
  const beats = await prisma.beat.count({ where: { workspaceId: wsId, scriptId: script?.id ?? '' } });
  assert(beats > 0, 'the script has storyboard beats');
  const voice = await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'voice' } });
  assert(voice > 0, 'a voiceover asset was generated');
  const scenes = await prisma.videoScene.count({ where: { workspaceId: wsId, contentProjectId: pieceId } });
  eq(scenes, beats, 'a video scene was decomposed per beat (video mode)');

  //? Re-running reuses the existing script (does not pile up a second one).
  await enqueueControlAction({ workspaceId: wsId, op: 'content-run-pipeline', target: {}, payload: { contentProjectId: pieceId, mode: 'video' }, userId: owner.id, clientRequestId: `rp-run2-${String(stamp)}` });
  await wait(1500);
  eq(await prisma.script.count({ where: { workspaceId: wsId, contentProjectId: pieceId } }), 1, 're-running the pipeline reuses the script (no duplicate)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/runPipeline.test.mts');
