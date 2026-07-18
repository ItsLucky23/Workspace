//? A3+A4 — publish routes to the CHOSEN account, and content binds to a channel. Real Mongo + a fixture
//? upload transport (no real OAuth apps). A3: publishAsset with accountId uploads with THAT account's token.
//? A4: content-from-brief with channelId binds the piece to the channel (brand grounding). Cleans up.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { saveConnection } = await import('../../server/content/publishOAuth');
const { publishAsset, runScheduledPublish } = await import('../../server/content/publish');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `pr-${String(stamp)}@youcomm.nl`, name: 'PR' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'PR WS' }, userId: owner.id, clientRequestId: `pr-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));

  // ---- A3: publish routes to the chosen account -----------------------------------------------------
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'tok-main' }, 'main');
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'tok-second' }, 'second');
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', title: 'A clip' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'render', url: '/media/x.mp4', status: 'ready' } });

  //? A fixture transport records which account token it was handed.
  let usedToken = '';
  const externalId = `ROUTED-${String(stamp)}`;
  const transport = { upload: (_platform: string, req: { accessToken: string }) => { usedToken = req.accessToken; return Promise.resolve({ externalUrl: `https://youtube.com/watch?v=${externalId}` }); } };

  const toSecond = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', accountId: 'second' }, { uploadTransport: transport });
  eq(usedToken, 'tok-second', 'publish routed to the "second" account token');
  assert(toSecond.ok, 'the routed publish succeeded');

  const toMain = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', accountId: 'main' }, { uploadTransport: transport });
  eq(usedToken, 'tok-main', 'publish routed to the "main" account token');
  assert(toMain.ok, 'the routed publish succeeded (main)');

  // ---- A1/A3: a SCHEDULED publish keeps its accountId (was dropped — PublishJob had no accountId) --------
  usedToken = '';
  const future = new Date(Date.now() + 3_600_000);
  const sched = await publishAsset(prisma, wsId, { contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', accountId: 'second', scheduledAt: future }, { uploadTransport: transport });
  assert(sched.scheduled === true, 'the publish is parked as scheduled');
  const job = await prisma.publishJob.findFirst({ where: { workspaceId: wsId, status: 'scheduled' } });
  eq(job?.accountId, 'second', 'the scheduled job persisted the chosen accountId');
  eq(usedToken, '', 'nothing uploaded yet (still scheduled)');
  //? Fire it as if now is past due → it must upload with the SECOND account token, not the default.
  const fired = await runScheduledPublish(prisma, future.getTime() + 1000, { uploadTransport: transport });
  assert(fired.fired >= 1, 'the due scheduled job fired');
  eq(usedToken, 'tok-second', 'the scheduled publish used the chosen account token (accountId survived)');
  const firedJob = await prisma.publishJob.findUnique({ where: { id: job?.id ?? '' } });
  eq(firedJob?.accountId, 'second', 'firing preserves the selected accountId');
  eq(firedJob?.externalId, externalId, 'the injected upload URL is recorded with its external id');

  // ---- A4: content binds to a channel ---------------------------------------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'channel-create', target: {}, payload: { name: 'Chan Z', platform: 'youtube', brandVoice: 'punchy' }, userId: owner.id, clientRequestId: `pr-cc-${String(stamp)}` });
  const channel = await poll(() => prisma.channel.findFirst({ where: { workspaceId: wsId, name: 'Chan Z' } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'content-from-brief', target: {}, payload: { brief: 'a launch teaser', title: 'For Z', channelId: channel?.id ?? '' }, userId: owner.id, clientRequestId: `pr-cfb-${String(stamp)}` });
  const bound = await poll(() => prisma.contentProject.findFirst({ where: { workspaceId: wsId, title: 'For Z' } }));
  assert(bound !== null, 'content-from-brief created the piece');
  eq(bound?.channelId, channel?.id, 'the piece is bound to channel Z (brand grounding flows in)');
  console.log(`[pr] ✓ publish routes by account + content binds to a channel`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/publishRouting.test.mts');
