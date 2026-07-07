//? Integration test for F3.2 (TikTok + future-ready IG/LinkedIn, ADR 0066). Real Conductor + Mongo. TikTok
//? posts via the same B-23 gate (dummy). Instagram + LinkedIn are registered as FUTURE (not posted). The
//? platform abstraction is asserted directly + end-to-end.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { BUILT_PLATFORMS, FUTURE_PLATFORMS } = await import('../../server/content/publish');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

//? The abstraction: youtube + tiktok built; instagram + linkedin future-ready.
assert(BUILT_PLATFORMS.includes('youtube') && BUILT_PLATFORMS.includes('tiktok'), 'YouTube + TikTok are built platforms');
assert(FUTURE_PLATFORMS.includes('instagram') && FUTURE_PLATFORMS.includes('linkedin'), 'Instagram + LinkedIn are future-ready (registered, not built)');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f32-${String(stamp)}@youcomm.nl`, name: 'CP F32' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F32 WS' }, userId: owner.id, clientRequestId: `f32-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f32-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: cproj?.id ?? '', title: 'Clip' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'video', url: 'stub://video/x', status: 'ready' } });

  //? Publish to TikTok via the gate.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-request-publish', target: {}, payload: { contentProjectId: piece.id, assetId: asset.id, platform: 'tiktok' }, userId: owner.id, clientRequestId: `f32-rp-${String(stamp)}` });
  const suggestion = await poll(() => prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'publish' } }));
  eq(await prisma.publishJob.count({ where: { workspaceId: wsId } }), 0, 'nothing posted before accept');
  await enqueueControlAction({ workspaceId: wsId, op: 'accept-suggestion', target: { suggestionId: suggestion?.id }, payload: {}, userId: owner.id, clientRequestId: `f32-ac-${String(stamp)}` });
  const job = await poll(() => prisma.publishJob.findFirst({ where: { workspaceId: wsId, platform: 'tiktok' } }));
  //? Honesty fix: no connection → status 'stub' (a dummy), not a fake 'done'.
  assert(job !== null && job.status === 'stub', 'accepting a not-connected TikTok post is honestly marked stub');
  assert((job?.externalUrl ?? '').startsWith('stub://tiktok/'), 'the TikTok dummy post returns a stub:// url');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/publishTiktok.test.mts');
