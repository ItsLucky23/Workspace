//? Integration test for F2.2 (short-form clips, ADR 0049). Real Conductor + Mongo. content-gen-shortform
//? makes a hook-driven vertical video (video-gen stub), metered, with a hook + captions. Budget-block path.

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
const owner = await prisma.user.create({ data: { email: `cp-f22-${String(stamp)}@youcomm.nl`, name: 'CP F22' } });
let workspaceId: string | null = null;

try {
  await ensureDefaultStyles(prisma);
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F22 WS' }, userId: owner.id, clientRequestId: `f22-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 1000, enabled: true }, userId: owner.id, clientRequestId: `f22-eb-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f22-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-create', target: {}, payload: { projectId: cproj?.id, title: 'Promo clip', format: 'short' }, userId: owner.id, clientRequestId: `f22-cc-${String(stamp)}` });
  const piece = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'Promo clip' } }));
  const pieceId = piece?.id ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-shortform', target: {}, payload: { contentProjectId: pieceId, prompt: 'our new app launches today', styleKey: 'cinematic' }, userId: owner.id, clientRequestId: `f22-gs-${String(stamp)}` });
  const clip = await poll(() => prisma.contentAsset.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'video' } }));
  assert(clip !== null, 'content-gen-shortform produced a video clip');
  assert((clip?.url ?? '').startsWith('stub://video/'), 'the clip is a valid-shaped stub video');
  const meta = (clip?.metadata ?? {}) as { hook?: string; captions?: unknown[]; format?: string; style?: string };
  assert((meta.hook ?? '').length > 0, 'a hook was generated');
  assert((meta.captions?.length ?? 0) > 0, 'captions were generated');
  eq(meta.format, 'short', 'the clip is tagged short-form');
  eq(meta.style, 'cinematic', 'the chosen style was applied');

  const job = await prisma.mediaJob.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceId, feature: 'video-gen' } });
  eq(job?.providerId, 'fal', 'video-gen routed to fal');
  eq((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.spentCents, 40, 'the video stub cost (40c) debited the budget');

  //? BLOCK path.
  await enqueueControlAction({ workspaceId: wsId, op: 'edit-media-budget', target: {}, payload: { capCents: 40, enabled: true }, userId: owner.id, clientRequestId: `f22-eb2-${String(stamp)}` });
  await poll(async () => ((await prisma.mediaBudget.findUnique({ where: { workspaceId: wsId } }))?.capCents === 40 ? true : null));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-gen-shortform', target: {}, payload: { contentProjectId: pieceId, prompt: 'second clip' }, userId: owner.id, clientRequestId: `f22-gs2-${String(stamp)}` });
  await wait(300);
  eq(await prisma.contentAsset.count({ where: { workspaceId: wsId, contentProjectId: pieceId, kind: 'video' } }), 1, 'a clip over the budget cap is blocked (still 1)');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/shortForm.test.mts');
