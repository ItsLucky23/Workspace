//? Integration test for F3.1 (publish-gate + YouTube, ADR 0065). Real Conductor + Mongo. content-request-
//? publish creates a publish SUGGESTION (no post yet — the B-23 gate); only accepting it posts (dummy, no
//? key) via the YouTube adapter → a PublishJob. Also: a future-ready platform (linkedin) is not posted.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cp-f31-${String(stamp)}@youcomm.nl`, name: 'CP F31' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'CP F31 WS' }, userId: owner.id, clientRequestId: `f31-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Channel', projectType: 'content' }, userId: owner.id, clientRequestId: `f31-pc-${String(stamp)}` });
  const cproj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, projectType: 'content' } }));
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: cproj?.id ?? '', title: 'To publish' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'render', url: 'stub://render/x', status: 'ready' } });

  //? Request publish → a SUGGESTION, NOT a post (the gate).
  await enqueueControlAction({ workspaceId: wsId, op: 'content-request-publish', target: {}, payload: { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube' }, userId: owner.id, clientRequestId: `f31-rp-${String(stamp)}` });
  const suggestion = await poll(() => prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'publish' } }));
  assert(suggestion !== null, 'content-request-publish created a publish suggestion (the gate)');
  eq(await prisma.publishJob.count({ where: { workspaceId: wsId } }), 0, 'NOTHING is posted before the user accepts (B-23)');

  //? Accept → the Conductor posts (dummy YouTube).
  await enqueueControlAction({ workspaceId: wsId, op: 'accept-suggestion', target: { suggestionId: suggestion?.id }, payload: {}, userId: owner.id, clientRequestId: `f31-ac-${String(stamp)}` });
  const job = await poll(() => prisma.publishJob.findFirst({ where: { workspaceId: wsId, platform: 'youtube' } }));
  assert(job !== null, 'accepting the suggestion posts to YouTube (Conductor is the writer)');
  eq(job?.status, 'done', 'the publish job is done');
  assert((job?.externalUrl ?? '').startsWith('stub://youtube/'), 'the dummy post returns a valid-shaped external url');
  eq((await prisma.workspaceSuggestion.findUnique({ where: { id: suggestion?.id ?? '' } }))?.status, 'accepted', 'the suggestion is marked accepted');

  //? A future-ready platform (linkedin) is NOT built → recorded as an error, not posted.
  await enqueueControlAction({ workspaceId: wsId, op: 'content-request-publish', target: {}, payload: { contentProjectId: piece.id, assetId: asset.id, platform: 'linkedin' }, userId: owner.id, clientRequestId: `f31-rp2-${String(stamp)}` });
  const s2 = await poll(() => prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'publish', title: 'Publish to linkedin' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'accept-suggestion', target: { suggestionId: s2?.id }, payload: {}, userId: owner.id, clientRequestId: `f31-ac2-${String(stamp)}` });
  const liJob = await poll(() => prisma.publishJob.findFirst({ where: { workspaceId: wsId, platform: 'linkedin' } }));
  eq(liJob?.status, 'error', 'a future-ready platform (linkedin) is not posted');
  eq(liJob?.error, 'platform.notBuilt', 'it records platform.notBuilt');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/publish.test.mts');
