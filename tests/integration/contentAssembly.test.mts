//? Integration test for F1.5 (assembly + export, ADR 0049) — the END-TO-END content pipeline on dummy data.
//? Real Conductor + Mongo. A piece runs script → voice → images → assemble, producing a COMPLETE downloadable
//? render asset. Remotion renders locally (no metered API) → render cost 0. This is the Fase-1 DoD proof.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { ensureDefaultStyles } = await import('../../server/content/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 10_000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f15-${String(stamp)}@youcomm.nl`, name: 'CP F15' } });
let workspaceId: string | null = null;

try {
  await ensureDefaultStyles(prisma);
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F15 WS' }, userId: owner.id, clientRequestId: `f15-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 1000, enabled: true }, userId: owner.id, clientRequestId: `f15-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f15-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Dino explainer', brief: 'a story about dinosaurs', format: 'faceless' }, userId: owner.id, clientRequestId: `f15-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Dino explainer' } }));
  const pieceId = piece?.id ?? '';

  //? The whole pipeline: script → voice → images → assemble.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-script', target: {}, payload: { contentProjectId: pieceId }, userId: owner.id, clientRequestId: `f15-gs-${String(stamp)}` });
  await poll(() => prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-voice', target: {}, payload: { contentProjectId: pieceId }, userId: owner.id, clientRequestId: `f15-gv-${String(stamp)}` });
  await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'voice' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-images', target: {}, payload: { contentProjectId: pieceId, styleKey: 'realistisch' }, userId: owner.id, clientRequestId: `f15-gi-${String(stamp)}` });
  await poll(async () => (await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'image' } })) === 4 ? true : null);

  await enqueueControlAction({ workspaceId: wsId, op: 'content-assemble', target: {}, payload: { contentProjectId: pieceId }, userId: owner.id, clientRequestId: `f15-as-${String(stamp)}` });
  const render = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'render' } }));
  assert(render !== null, 'content-assemble produced a final render asset');
  assert((render?.url ?? '').startsWith('stub://render/'), 'the render is a valid-shaped complete output');
  const meta = (render?.metadata ?? {}) as { downloadable?: boolean; hasVoice?: boolean; hasAllImages?: boolean; beatCount?: number; totalMs?: number };
  assert(meta.downloadable === true, 'the final asset is marked downloadable');
  assert(meta.hasVoice === true, 'the render includes the voiceover');
  assert(meta.hasAllImages === true, 'the render includes an image for every beat');
  eq(meta.beatCount, 4, 'the render covers all 4 beats');
  assert((meta.totalMs ?? 0) > 0, 'the render has a total duration');

  const job = await prisma.renderJob.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId } });
  assert(job !== null && job.status === 'done', 'a RenderJob was recorded as done');
  eq(job?.resultAssetId, render?.id, 'the RenderJob links its result asset');
  eq(job?.costCents, 0, 'local Remotion render is not a metered cost');

  //? Budget = voice(2) + 4 images(16) = 18; the render adds nothing.
  const budget = await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } });
  eq(budget?.spentCents, 18, 'total metered spend = voice(2) + images(16); render is free');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentAssembly.test.mts');
