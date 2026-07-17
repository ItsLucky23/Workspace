//? Integration test for F2.6 (3d-concepting, ADR 0049). Real Conductor + Mongo. content-gen-3d produces a
//? 3d-mesh asset via the shared generateMediaAsset path (stub, metered). 3d is concepting-grade + lowest prio.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f26-${String(stamp)}@youcomm.nl`, name: 'CP F26' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F26 WS' }, userId: owner.id, clientRequestId: `f26-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 1000, enabled: true }, userId: owner.id, clientRequestId: `f26-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f26-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Props', format: 'image' }, userId: owner.id, clientRequestId: `f26-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Props' } }));
  const pieceId = piece?.id ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-3d', target: {}, payload: { contentProjectId: pieceId, prompt: 'a low-poly treasure chest' }, userId: owner.id, clientRequestId: `f26-g3-${String(stamp)}` });
  const mesh = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'model-3d' } }));
  assert(mesh !== null, 'content-gen-3d produced a 3d-mesh asset');
  assert((mesh?.url ?? '').startsWith('stub://model-3d/'), 'the mesh is a valid-shaped stub');
  const job = await prisma.mediaJob.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, feature: 'model-3d' } });
  eq(job?.providerId, 'fal', '3d routed to its provider');
  eq(job?.resultAssetId, mesh?.id, 'the MediaJob links its asset');
  //? #133 — a PROMPT-driven 3d runs the image→3d chain: the source image (4c) + the mesh (20c).
  //? (A referenceUrl-driven call skips the image stage and debits only 20c.)
  eq((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.spentCents, 24, 'the prompt→image→3d chain debited image (4c) + mesh (20c)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/model3d.test.mts');
