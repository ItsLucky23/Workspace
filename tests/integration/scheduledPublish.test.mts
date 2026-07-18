//? Integration test for FREEDOM_PROGRAM O3 — post scheduling. Verifies publishAsset parks a future post as a
//? 'scheduled' PublishJob, overlapping scheduler calls claim/upload it exactly once, terminal-write failure
//? leaves it claimed, upload failure becomes error, and immediate results preserve their selected account.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { tryCatch } = await import('@luckystack/core');
const { publishAsset, runScheduledPublish } = await import('../../server/content/publish');
const { saveConnection } = await import('../../server/content/publishOAuth');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

//? Injected platform URL keeps the test offline while exercising real-post lineage.
let scheduledUploadCount = 0;
const uploadTransport = { upload: async () => {
  scheduledUploadCount += 1;
  await Promise.resolve();
  return { externalUrl: 'https://youtube.com/watch?v=SCHEDULED1' };
} };

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
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'scheduled-token' });

  // schedule a future post → parked, not posted
  const sched = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', scheduledAt: future }, { now: T0, uploadTransport });
  assert(sched.ok && sched.scheduled === true, 'a future post is parked as scheduled');
  const job = await prisma.publishJob.findUnique({ where: { id: sched.publishJobId ?? '' } });
  eq(job?.status, 'scheduled', 'the job is scheduled, not done');
  assert(job?.externalUrl == null, 'nothing was posted yet');

  // not due yet → nothing fires
  eq((await runScheduledPublish(prisma, T0 + 30 * 60 * 1000, { uploadTransport })).fired, 0, 'before scheduledAt → nothing fires');

  // reschedule further out, then a sweep past the ORIGINAL time still doesn't fire
  await prisma.publishJob.update({ where: { id: job?.id ?? '' }, data: { scheduledAt: new Date(T0 + 3 * 60 * 60 * 1000) } });
  eq((await runScheduledPublish(prisma, T0 + 90 * 60 * 1000, { uploadTransport })).fired, 0, 'reschedule defers past the original time');

  // now past the rescheduled time → two overlapping schedulers still claim + upload exactly once
  const concurrentRuns = await Promise.all([
    runScheduledPublish(prisma, T0 + 4 * 60 * 60 * 1000, { uploadTransport }),
    runScheduledPublish(prisma, T0 + 4 * 60 * 60 * 1000, { uploadTransport }),
  ]);
  eq(concurrentRuns.reduce((total, result) => total + result.fired, 0), 1, 'parallel schedulers report one persisted fire');
  eq(scheduledUploadCount, 1, 'parallel schedulers invoke the external upload exactly once');
  const firedJob = await prisma.publishJob.findUnique({ where: { id: job?.id ?? '' } });
  eq(firedJob?.status, 'done', 'the fired job resolved as a real post');
  eq(firedJob?.externalId, 'SCHEDULED1', 'the injected upload URL is recorded with its external id');

  // GAP_SCAN A3 — a connected upload failure now RETRIES with backoff, and only the last attempt is terminal.
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'failure-token' }, 'scheduled-failure');
  const failedSchedule = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', accountId: 'scheduled-failure', scheduledAt: new Date(T0 + 5 * 60 * 60 * 1000) }, { now: T0 });
  const failingTransport = { upload: async () => null };
  const FAIL_T = T0 + 6 * 60 * 60 * 1000;
  const failedRun = await runScheduledPublish(prisma, FAIL_T, { uploadTransport: failingTransport });
  eq(failedRun.fired, 0, 'an upload failure is not counted as fired');
  const afterTry1 = await prisma.publishJob.findUnique({ where: { id: failedSchedule.publishJobId ?? '' } });
  eq(afterTry1?.status, 'scheduled', 'A3: the first failure re-schedules instead of dying');
  eq(afterTry1?.attempts, 1, 'A3: the first failure records attempt 1');
  eq(afterTry1?.error, 'publish.retrying:1/3', 'A3: the retry state is explicit, not a fake success');
  assert((afterTry1?.scheduledAt?.getTime() ?? 0) > FAIL_T, 'A3: the retry is parked in the future (backoff)');

  //? Second attempt — advance past the backoff window.
  await runScheduledPublish(prisma, (afterTry1?.scheduledAt?.getTime() ?? FAIL_T) + 1000, { uploadTransport: failingTransport });
  const afterTry2 = await prisma.publishJob.findUnique({ where: { id: failedSchedule.publishJobId ?? '' } });
  eq(afterTry2?.attempts, 2, 'A3: the second failure records attempt 2');
  eq(afterTry2?.status, 'scheduled', 'A3: attempt 2 still retries');

  //? Third attempt exhausts MAX_PUBLISH_ATTEMPTS → terminal error (and A2 notifies).
  await runScheduledPublish(prisma, (afterTry2?.scheduledAt?.getTime() ?? FAIL_T) + 1000, { uploadTransport: failingTransport });
  const failedScheduledJob = await prisma.publishJob.findUnique({ where: { id: failedSchedule.publishJobId ?? '' } });
  eq(failedScheduledJob?.status, 'error', 'A3: the last attempt persists a terminal error');
  eq(failedScheduledJob?.error, 'publish.uploadFailed', 'an upload failure keeps its explicit error code');
  eq(failedScheduledJob?.attempts, 3, 'A3: attempts stop at the bound');
  eq(failedScheduledJob?.accountId, 'scheduled-failure', 'an upload failure preserves the selected account');
  //? A2 — the terminal failure is no longer silent.
  const failNotif = await prisma.notification.findFirst({ where: { workspaceId: wsId, type: 'publish-failure' } });
  assert(failNotif !== null, 'A2: a terminal publish failure notifies the owner');

  // terminal persistence failure propagates and leaves the atomic claim in processing; a later sweep cannot repost it
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'persistence-token' }, 'scheduled-persistence');
  const persistenceSchedule = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', accountId: 'scheduled-persistence', scheduledAt: new Date(T0 + 7 * 60 * 60 * 1000) }, { now: T0 });
  let persistenceUploadCount = 0;
  const persistenceTransport = { upload: async () => {
    persistenceUploadCount += 1;
    return { externalUrl: 'https://youtube.com/watch?v=PERSISTENCE1' };
  } };
  const terminalWriteFailurePrisma = prisma.$extends({
    query: {
      publishJob: {
        update: async ({ args, query }) => {
          if (args.data.status === 'done' || args.data.status === 'stub') throw new Error('injected terminal write failure');
          return query(args);
        },
      },
    },
  });
  const [terminalWriteError] = await tryCatch(() => runScheduledPublish(terminalWriteFailurePrisma, T0 + 8 * 60 * 60 * 1000, { uploadTransport: persistenceTransport }));
  assert(Boolean(terminalWriteError), 'terminal persistence failure propagates instead of being swallowed');
  eq((await prisma.publishJob.findUnique({ where: { id: persistenceSchedule.publishJobId ?? '' } }))?.status, 'processing', 'terminal persistence failure leaves the job claimed');
  eq((await runScheduledPublish(prisma, T0 + 9 * 60 * 60 * 1000, { uploadTransport: persistenceTransport })).fired, 0, 'a claimed job is not scheduled again');
  eq(persistenceUploadCount, 1, 'terminal persistence failure cannot trigger a duplicate external upload');

  // immediate done/stub/error jobs all retain the account selected by the accepted publish request
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'immediate-real-token' }, 'immediate-real');
  const immediateReal = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', accountId: 'immediate-real' }, { now: T0, uploadTransport: { upload: async () => ({ externalUrl: 'https://youtube.com/watch?v=IMMEDIATE1' }) } });
  const immediateRealJob = await prisma.publishJob.findUnique({ where: { id: immediateReal.publishJobId ?? '' } });
  eq(immediateRealJob?.status, 'done', 'an immediate connected publish persists done');
  eq(immediateRealJob?.accountId, 'immediate-real', 'an immediate done job preserves the selected account');

  const immediateStub = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'tiktok', accountId: 'immediate-stub' }, { now: T0, uploadTransport });
  assert(!immediateStub.ok && immediateStub.stub === true && immediateStub.scheduled !== true, 'an unscheduled publish resolves immediately as a stub without a connection');
  const immediateStubJob = await prisma.publishJob.findUnique({ where: { id: immediateStub.publishJobId ?? '' } });
  eq(immediateStubJob?.status, 'stub', 'the immediate disconnected job persists stub');
  eq(immediateStubJob?.accountId, 'immediate-stub', 'an immediate stub job preserves the selected account');

  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'immediate-error-token' }, 'immediate-error');
  const immediateError = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', accountId: 'immediate-error' }, { now: T0, uploadTransport: { upload: async () => null } });
  const immediateErrorJob = await prisma.publishJob.findUnique({ where: { id: immediateError.publishJobId ?? '' } });
  eq(immediateErrorJob?.status, 'error', 'an immediate failed upload persists error');
  eq(immediateErrorJob?.accountId, 'immediate-error', 'an immediate error job preserves the selected account');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/scheduledPublish.test.mts');
