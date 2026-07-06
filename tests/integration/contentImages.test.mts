//? Integration test for F1.4 (per-beat images, ADR 0049). Real Conductor + Mongo. content-gen-images
//? generates one image per storyboard beat (image-gen stub, no key), in the chosen style, links each on
//? its beat, and debits the €-budget per image. Self-cleans.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { ensureDefaultStyles } = await import('../../server/content/styles');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f14-${String(stamp)}@youcomm.nl`, name: 'CP F14' } });
let workspaceId: string | null = null;

try {
  await ensureDefaultStyles(prisma);
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F14 WS' }, userId: owner.id, clientRequestId: `f14-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 1000, enabled: true }, userId: owner.id, clientRequestId: `f14-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f14-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Dino explainer', brief: 'a story about dinosaurs', format: 'faceless' }, userId: owner.id, clientRequestId: `f14-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Dino explainer' } }));
  const pieceId = piece?.id ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-script', target: {}, payload: { contentProjectId: pieceId }, userId: owner.id, clientRequestId: `f14-gs-${String(stamp)}` });
  await poll(() => prisma.script.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId } }));

  //? Generate one image per beat in the 'realistisch' style.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-images', target: {}, payload: { contentProjectId: pieceId, styleKey: 'realistisch', extraInstructions: 'warm tones' }, userId: owner.id, clientRequestId: `f14-gi-${String(stamp)}` });
  await poll(async () => (await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'image' } })) === 4 ? true : null);

  const images = await prisma.contentAsset.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'image' } });
  eq(images.length, 4, 'one image asset per beat (4)');
  assert(images.every((a) => (a.url ?? '').startsWith('stub://image/')), 'each image is a valid-shaped stub');
  const meta0 = (images[0]?.metadata ?? {}) as { style?: string };
  eq(meta0.style, 'realistisch', 'the chosen style is applied to the image gen');

  const beats = await prisma.beat.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId } });
  assert(beats.every((b) => b.imageAssetId), 'every beat is linked to its image');

  const jobs = await prisma.mediaJob.findMany({ where: { workspaceId: wsId, contentProjectId: pieceId, feature: 'image-gen' } });
  eq(jobs.length, 4, 'a MediaJob per image');
  assert(jobs.every((j) => j.providerId === 'fal' && j.resultAssetId), 'each image MediaJob routed to fal + links its asset');

  const budget = await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } });
  eq(budget?.spentCents, 16, 'the budget debited 4 images × 4c = 16c');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/contentImages.test.mts');
