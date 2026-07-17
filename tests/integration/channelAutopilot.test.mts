//? Golf 4 (gap-fix, ADR 0269) through the REAL Conductor + Mongo: channel↔account-binding, the
//? autopilot consent-branch of content-request-publish, and per-channel winners scoping.
//? No real platform post ever happens (no OAuth connection → the honest stub path).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { recentWinnersLine } = await import('../../server/content/ideatorRole');
const { listAiRuns } = await import('../../server/ai/activity');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ap-${String(stamp)}@youcomm.nl`, name: 'AP' } });
let wsId = '';

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Autopilot WS');
  wsId = created.workspaceId;
  const project = await prisma.project.create({ data: { workspaceId: wsId, name: 'content', projectType: 'content', gitlabPath: '' } });

  //? Two channels: one autopilot (with account + disclosure), one manual.
  const auto = await prisma.channel.create({ data: { workspaceId: wsId, projectId: project.id, name: 'AP kanaal', platform: 'youtube', autopilot: true, aiDisclosureDefault: true, defaultAccountId: 'acct-yt-2' } });
  const manual = await prisma.channel.create({ data: { workspaceId: wsId, projectId: project.id, name: 'Handmatig', platform: 'youtube' } });

  const pieceAuto = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project.id, channelId: auto.id, title: 'AP piece', brief: 'x' } });
  const pieceManual = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project.id, channelId: manual.id, title: 'Manual piece', brief: 'x' } });
  const assetAuto = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: pieceAuto.id, kind: 'render', url: '/media/ap.mp4', status: 'ready' } });
  const assetManual = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: pieceManual.id, kind: 'render', url: '/media/m.mp4', status: 'ready' } });

  // ---- 1. autopilot channel: publish op posts DIRECTLY (no suggestion), stub-honest, disclosure applied ----
  await enqueueControlAction({ workspaceId: wsId, op: 'content-request-publish', target: {}, payload: { contentProjectId: pieceAuto.id, assetId: assetAuto.id, platform: 'youtube' }, userId: owner.id, clientRequestId: `ap-pub-${String(stamp)}` });
  const job = await poll(() => prisma.publishJob.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceAuto.id } }));
  assert(job !== null, 'autopilot published immediately (a PublishJob exists)');
  eq(job?.status, 'stub', 'no OAuth connection → the honest stub status (never a real post in tests)');
  eq(await prisma.workspaceSuggestion.count({ where: { workspaceId: wsId, type: 'publish' } }), 0, 'NO publish suggestion was created for the autopilot channel');
  const varRow = await prisma.contentProject.findFirst({ where: { workspaceId: wsId, id: pieceAuto.id }, select: { publishVariants: true } });
  const pv = varRow?.publishVariants;
  const yt = (pv !== null && typeof pv === 'object' && !Array.isArray(pv)) ? (pv as Record<string, unknown>).youtube : null;
  assert(yt !== null && typeof yt === 'object' && (yt as Record<string, unknown>).syntheticMedia === true, "the channel's aiDisclosureDefault was applied as the variant's syntheticMedia");
  assert(listAiRuns(wsId).some((r) => r.feature === 'autopilot-publish'), 'the autopilot post landed in the Activity feed');

  // ---- 1b. regression: a FULL-FORM channel-edit with an empty defaultStyleId must persist ----
  //? Pre-existing bug: '' for the @db.ObjectId styleId made Prisma throw and the WHOLE edit silently
  //? no-op — every UI edit without a house style saved nothing (masked until the autopilot toggle).
  await enqueueControlAction({ workspaceId: wsId, op: 'channel-edit', target: {}, payload: { channelId: manual.id, name: 'Handmatig', platform: 'youtube', handle: '', brandVoice: '', defaultStyleId: '', aiDisclosureDefault: true, defaultAccountId: '', autopilot: false }, userId: owner.id, clientRequestId: `ap-edit-${String(stamp)}` });
  const edited = await poll(() => prisma.channel.findFirst({ where: { workspaceId: wsId, id: manual.id, aiDisclosureDefault: true } }));
  assert(edited !== null, "a full-form edit with empty defaultStyleId persists (was a silent no-op)");
  eq(edited?.defaultStyleId, null, "an empty styleId lands as null, not ''");

  // ---- 2. manual channel: unchanged behaviour — a suggestion, no job ----
  await enqueueControlAction({ workspaceId: wsId, op: 'content-request-publish', target: {}, payload: { contentProjectId: pieceManual.id, assetId: assetManual.id, platform: 'youtube' }, userId: owner.id, clientRequestId: `ap-man-${String(stamp)}` });
  const sugg = await poll(() => prisma.workspaceSuggestion.findFirst({ where: { workspaceId: wsId, type: 'publish' } }));
  assert(sugg !== null, 'a manual channel still creates the publish suggestion (B-23 unchanged)');
  eq(await prisma.publishJob.count({ where: { workspaceId: wsId, contentProjectId: pieceManual.id } }), 0, 'and no direct job for the manual channel');

  // ---- 3. scheduled autopilot post carries the channel default account ----
  const future = new Date(Date.now() + 3_600_000).toISOString();
  await enqueueControlAction({ workspaceId: wsId, op: 'content-request-publish', target: {}, payload: { contentProjectId: pieceAuto.id, assetId: assetAuto.id, platform: 'youtube', scheduledAt: future }, userId: owner.id, clientRequestId: `ap-sched-${String(stamp)}` });
  const sched = await poll(() => prisma.publishJob.findFirst({ where: { workspaceId: wsId, contentProjectId: pieceAuto.id, status: 'scheduled' } }));
  assert(sched !== null, 'a future scheduledAt parks a scheduled autopilot job');
  eq(sched?.accountId, 'acct-yt-2', "the channel's defaultAccountId routed the scheduled post (channel↔account-binding)");

  // ---- 4. per-channel winners scoping ----
  await prisma.publishJob.updateMany({ where: { id: job?.id ?? '' }, data: { status: 'done', metrics: { views: 5000, likes: 10, comments: 1 } } });
  await prisma.publishJob.create({ data: { workspaceId: wsId, contentProjectId: pieceManual.id, assetId: assetManual.id, platform: 'youtube', status: 'done', metrics: { views: 90_000, likes: 5, comments: 0 } } });
  const lineAuto = await recentWinnersLine(wsId, auto.id);
  assert(lineAuto.includes('AP piece') && !lineAuto.includes('Manual piece'), "channel A's winners contain ONLY channel A's pieces (no cross-channel signal)");
  const lineAll = await recentWinnersLine(wsId);
  assert(lineAll.includes('Manual piece'), 'the unscoped line still sees everything (back-compat)');
} finally {
  if (wsId) await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/channelAutopilot.test.mts');
}
