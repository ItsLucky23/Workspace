//? Integration test for F1.1 (generic content-pipeline, ADR 0049). Real Conductor + Mongo. A content piece
//? is created + advanced through the fixed content stages ENTIRELY via control-ops (B-23 — the Conductor is
//? the only writer of stageId/status). Also: project-create with projectType=content makes a content lane.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { CONTENT_STAGES } = await import('../../server/content/pipeline');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f11-${String(stamp)}@youcomm.nl`, name: 'CP F11' } });
let workspaceId: string | null = null;

try {
  eq(CONTENT_STAGES[0], 'idea', 'the content pipeline starts at idea');
  eq(CONTENT_STAGES.at(-1), 'publish', 'the content pipeline ends at publish');

  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F11 WS' }, userId: owner.id, clientRequestId: `f11-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? A content-lane project via project-create (projectType=content) → no board pipeline.
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'My Channel Project', projectType: 'content' }, userId: owner.id, clientRequestId: `f11-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  assert(cproj !== null, 'project-create made a content-lane project');
  eq(await prisma.pipelineStage.count({ where: { workspaceId: wsId, projectId: cproj?.id ?? '' } }), 0, 'a content project has no board pipeline stages');

  //? Create a content piece via the control-op.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Dino explainer', brief: 'a story about dinosaurs', format: 'faceless' }, userId: owner.id, clientRequestId: `f11-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Dino explainer' } }));
  assert(piece !== null, 'content-create made a content piece (Conductor is the writer)');
  eq(piece?.stageId, 'idea', 'the piece enters at the idea stage');
  const pieceId = piece?.id ?? '';

  //? Advance with no explicit target → the next stage.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-advance', target: {}, payload: { contentProjectId: pieceId }, userId: owner.id, clientRequestId: `f11-a1-${String(stamp)}` });
  eq((await poll(async () => (await prisma.contentProject.findUnique({ where: { id: pieceId } }))?.stageId === 'script' ? true : null)), true, 'content-advance moves idea → script');

  //? Advance with an explicit target stage.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-advance', target: {}, payload: { contentProjectId: pieceId, toStage: 'review' }, userId: owner.id, clientRequestId: `f11-a2-${String(stamp)}` });
  eq((await poll(async () => (await prisma.contentProject.findUnique({ where: { id: pieceId } }))?.stageId === 'review' ? true : null)), true, 'content-advance jumps to an explicit stage (review)');

  //? Advance to publish, then past publish → done.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-advance', target: {}, payload: { contentProjectId: pieceId, toStage: 'publish' }, userId: owner.id, clientRequestId: `f11-a3-${String(stamp)}` });
  await poll(async () => (await prisma.contentProject.findUnique({ where: { id: pieceId } }))?.stageId === 'publish' ? true : null);
  await enqueueControlAction({ workspaceId: wsId, op: 'content-advance', target: {}, payload: { contentProjectId: pieceId }, userId: owner.id, clientRequestId: `f11-a4-${String(stamp)}` });
  eq((await poll(async () => (await prisma.contentProject.findUnique({ where: { id: pieceId } }))?.status === 'done' ? true : null)), true, 'advancing past publish marks the piece done');

  //? Archive.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-archive', target: {}, payload: { contentProjectId: pieceId }, userId: owner.id, clientRequestId: `f11-ar-${String(stamp)}` });
  eq((await poll(async () => (await prisma.contentProject.findUnique({ where: { id: pieceId } }))?.archived === true ? true : null)), true, 'content-archive soft-archives the piece');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentPipeline.test.mts');
