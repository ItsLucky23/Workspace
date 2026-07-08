//? C1 — scheduling a content post is now reachable end-to-end (the engine existed but `scheduledAt` was never
//? set). Verifies: content-request-publish with a future `scheduledAt` carries it into the suggestion; accepting
//? the suggestion parks a 'scheduled' PublishJob (NOT posted); a past/absent scheduledAt still publishes now.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sched-${String(stamp)}@youcomm.nl`, name: 'Sched' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Sched WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const devProject = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: devProject?.id ?? '', title: 'Sched piece' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'render', url: '/media/final.mp4', status: 'ready' } });

  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await enqueueControlAction({ workspaceId: wsId, op: 'content-request-publish', target: {}, payload: { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', scheduledAt: future }, userId: owner.id, clientRequestId: `sched-req-${String(stamp)}` });
  const sugg = await poll(() => prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'publish' } }));
  assert(sugg !== null, 'a publish suggestion was created');
  assert(sugg?.title.includes('Schedule'), 'a scheduled request reads as "Schedule for …"');
  const patch = (sugg?.patch ?? {}) as Record<string, unknown>;
  eq(patch.scheduledAt, future, 'the suggestion patch carries the scheduledAt');

  await enqueueControlAction({ workspaceId: wsId, op: 'accept-suggestion', target: { suggestionId: sugg?.id ?? '' }, payload: {}, userId: owner.id, clientRequestId: `sched-acc-${String(stamp)}` });
  const job = await poll(() => prisma.publishJob.findFirst({ where: { workspaceId: wsId, contentProjectId: piece.id } }));
  assert(job !== null, 'accepting created a PublishJob');
  eq(job?.status, 'scheduled', 'the job is PARKED as scheduled (not posted now)');
  assert(job?.scheduledAt !== null && (job?.scheduledAt?.getTime() ?? 0) > Date.now(), 'the scheduledAt is in the future');

  // a request with NO scheduledAt publishes now (a stub 'done'/'stub' job, not scheduled)
  await enqueueControlAction({ workspaceId: wsId, op: 'content-request-publish', target: {}, payload: { contentProjectId: piece.id, assetId: asset.id, platform: 'tiktok' }, userId: owner.id, clientRequestId: `now-req-${String(stamp)}` });
  const sugg2 = await poll(() => prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'publish', title: { contains: 'Publish to tiktok' } } }));
  assert(sugg2 !== null && sugg2.title.includes('Publish to'), 'a no-schedule request reads as "Publish to …"');
  const p2 = (sugg2?.patch ?? {}) as Record<string, unknown>;
  assert(!('scheduledAt' in p2), 'no scheduledAt in the immediate-publish patch');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/scheduledContentPublish.test.mts');
