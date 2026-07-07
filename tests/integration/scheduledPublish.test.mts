//? Integration test for FREEDOM_PROGRAM O3 — post scheduling. Verifies publishAsset parks a future post as a
//? 'scheduled' PublishJob (no upload yet), runScheduledPublish fires it only once due (injected clock), a
//? reschedule to a later time defers it, and an immediate publish still posts now. Real Mongo; a stub upload
//? transport keeps it offline + deterministic.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { publishAsset, runScheduledPublish } = await import('../../server/content/publish');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

//? A transport that never touches the network — asserts the "connected upload" path stays offline in tests.
const stubTransport = { upload: async () => ({ externalUrl: 'https://example.test/posted' }) };

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sch-${String(stamp)}@youcomm.nl`, name: 'SCH' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'SCH WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: wsId, title: 'Piece' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'video', url: '/media/v.mp4', status: 'ready' } });

  const T0 = 2_000_000_000_000;
  const future = new Date(T0 + 60 * 60 * 1000); // +1h

  // schedule a future post → parked, not posted
  const sched = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', scheduledAt: future }, { now: T0, uploadTransport: stubTransport });
  assert(sched.ok && sched.scheduled === true, 'a future post is parked as scheduled');
  const job = await prisma.publishJob.findUnique({ where: { id: sched.publishJobId ?? '' } });
  eq(job?.status, 'scheduled', 'the job is scheduled, not done');
  assert(job?.externalUrl == null, 'nothing was posted yet');

  // not due yet → nothing fires
  eq((await runScheduledPublish(prisma, T0 + 30 * 60 * 1000, { uploadTransport: stubTransport })).fired, 0, 'before scheduledAt → nothing fires');

  // reschedule further out, then a sweep past the ORIGINAL time still doesn't fire
  await prisma.publishJob.update({ where: { id: job?.id ?? '' }, data: { scheduledAt: new Date(T0 + 3 * 60 * 60 * 1000) } });
  eq((await runScheduledPublish(prisma, T0 + 90 * 60 * 1000, { uploadTransport: stubTransport })).fired, 0, 'reschedule defers past the original time');

  // now past the rescheduled time → fires
  eq((await runScheduledPublish(prisma, T0 + 4 * 60 * 60 * 1000, { uploadTransport: stubTransport })).fired, 1, 'past the rescheduled time → fires');
  eq((await prisma.publishJob.findUnique({ where: { id: job?.id ?? '' } }))?.status, 'done', 'the fired job is done');

  // an immediate publish (no scheduledAt) still posts now
  const imm = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'tiktok' }, { now: T0, uploadTransport: stubTransport });
  assert(imm.ok && imm.scheduled !== true, 'an unscheduled publish posts immediately');
  eq((await prisma.publishJob.findUnique({ where: { id: imm.publishJobId ?? '' } }))?.status, 'done', 'the immediate job is done');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/scheduledPublish.test.mts');
