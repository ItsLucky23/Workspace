//? Integration test for F2.4 (avatar / talking-head, ADR 0049). Real Conductor + Mongo. content-gen-avatar
//? produces an avatar asset via the shared generateMediaAsset path (stub, metered). Budget-block path.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f24-${String(stamp)}@youcomm.nl`, name: 'CP F24' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F24 WS' }, userId: owner.id, clientRequestId: `f24-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 1000, enabled: true }, userId: owner.id, clientRequestId: `f24-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f24-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Talking head', format: 'avatar' }, userId: owner.id, clientRequestId: `f24-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Talking head' } }));
  const pieceId = piece?.id ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-avatar', target: {}, payload: { contentProjectId: pieceId, prompt: 'read the launch announcement' }, userId: owner.id, clientRequestId: `f24-ga-${String(stamp)}` });
  const avatar = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'avatar' } }));
  assert(avatar !== null, 'content-gen-avatar produced an avatar asset');
  assert((avatar?.url ?? '').startsWith('stub://avatar/'), 'the avatar is a valid-shaped stub');
  const job = await prisma.mediaJob.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, feature: 'avatar' } });
  eq(job?.providerId, 'fal', 'avatar routed to its provider');
  eq(job?.resultAssetId, avatar?.id, 'the MediaJob links its asset');
  eq((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.spentCents, 30, 'the avatar stub cost (30c) debited the budget');

  //? BLOCK path.
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 30, enabled: true }, userId: owner.id, clientRequestId: `f24-eb2-${String(stamp)}` });
  await poll(async () => ((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.capCents === 30 ? true : null));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-avatar', target: {}, payload: { contentProjectId: pieceId, prompt: 'second' }, userId: owner.id, clientRequestId: `f24-ga2-${String(stamp)}` });
  await wait(300);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'avatar' } }), 1, 'an avatar over the budget cap is blocked (still 1)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/avatar.test.mts');
