//? FASE CI (DOCUMENTS_AND_SKILLS) — the read-only comment inbox through the REAL Conductor + Mongo,
//? with an injected fetcher (fixtures, never live platforms). Covers: the pure builders/parsers
//? (YouTube commentThreads + TikTok comment-list shapes), the scope gate (old upload-only YouTube
//? connections → an honest 'reconnect' note, zero fabricated rows), the refresh upsert (no dupes),
//? channel grouping, mark-read (one + all) via the ops, and the snapshot fold (comments + unread).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { buildYoutubeCommentsRequest, parseYoutubeComments, buildTiktokCommentsRequest, parseTiktokComments, connectionSupportsComments, refreshComments } = await import('../../server/content/commentInbox');
const { saveConnection } = await import('../../server/content/publishOAuth');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ci-${String(stamp)}@youcomm.nl`, name: 'CI' } });
let wsId = '';

try {
  // ---- 1. pure builders + parsers ----
  const ytReq = buildYoutubeCommentsRequest('tok-1', 'vid-9');
  assert(ytReq.url.includes('commentThreads') && ytReq.url.includes('videoId=vid-9'), 'the YouTube request targets commentThreads for the video');
  eq(ytReq.headers.Authorization, 'Bearer tok-1', 'with the bearer token');
  const ytFixture = { items: [
    { snippet: { topLevelComment: { id: 'c1', snippet: { authorDisplayName: 'Ana', textDisplay: 'Great video!', publishedAt: '2026-07-17T10:00:00Z' } } } },
    { snippet: { topLevelComment: { id: 'c2', snippet: { authorDisplayName: 'Bo', textDisplay: 'More please', publishedAt: '2026-07-17T11:00:00Z' } } } },
    { snippet: {} }, //? malformed entry → skipped, not a crash
  ] };
  const ytParsed = parseYoutubeComments(ytFixture);
  eq(ytParsed.length, 2, 'the YouTube parser reads well-formed threads and skips malformed ones');
  eq(ytParsed[0]?.author, 'Ana', 'with the author');

  const ttReq = buildTiktokCommentsRequest('tok-2', 'post-7');
  assert(ttReq.url.includes('/v2/video/comment/list/') && (ttReq.body ?? '').includes('post-7'), 'the TikTok request posts the video id');
  const ttParsed = parseTiktokComments({ data: { comments: [{ id: 't1', text: 'nice', username: 'kim', create_time: 1_752_750_000 }] } });
  eq(ttParsed.length, 1, 'the TikTok parser reads the data.comments shape');

  // ---- 2. the scope gate ----
  assert(!connectionSupportsComments('youtube', { accessToken: 'x' }), 'a scope-less (old upload-only) YouTube connection cannot read comments');
  assert(!connectionSupportsComments('youtube', { accessToken: 'x', scope: 'https://www.googleapis.com/auth/youtube.upload' }), 'upload-only scope → no');
  assert(connectionSupportsComments('youtube', { accessToken: 'x', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl' }), 'the broadened scope → yes');

  // ---- 3. refresh with an injected fetcher through real rows ----
  const created = await createBlankWorkspace(prisma, owner.id, 'Inbox WS');
  wsId = created.workspaceId;
  const project = await prisma.project.create({ data: { workspaceId: wsId, name: 'content', projectType: 'content', gitlabPath: '' } });
  const channel = await prisma.channel.create({ data: { workspaceId: wsId, projectId: project.id, name: 'Main YT', platform: 'youtube' } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: project.id, channelId: channel.id, title: 'Posted piece', brief: 'x' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'render', url: '/media/x.mp4', status: 'ready' } });
  await prisma.publishJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', status: 'done', externalId: 'vid-42' } });

  //? 3a — an OLD (scope-less) connection: honest reconnect note, zero rows, fetcher NEVER called.
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'old-token' });
  let fetcherCalls = 0;
  const res1 = await refreshComments(prisma, wsId, async () => { fetcherCalls += 1; return { comments: [] }; });
  assert(res1.notes.includes('comments.youtubeReconnect'), 'the old connection surfaces the reconnect note');
  eq(fetcherCalls, 0, 'and the platform is never called without the scope');
  eq(res1.checkedPosts, 0, 'no posts were checked');

  //? 3b — a broadened connection: comments land, grouped to the piece's channel; re-run dedups.
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'new-token', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl' });
  const fakeFetcher = async (): Promise<{ comments: { externalId: string; author: string; text: string; publishedAt: number }[] }> => ({ comments: [
    { externalId: `yc-1-${String(stamp)}`, author: 'Ana', text: 'Great video!', publishedAt: Date.now() - 60_000 },
    { externalId: `yc-2-${String(stamp)}`, author: 'Bo', text: 'More please', publishedAt: Date.now() },
  ] });
  const res2 = await refreshComments(prisma, wsId, fakeFetcher);
  eq(res2.newComments, 2, 'two comments ingested');
  const res3 = await refreshComments(prisma, wsId, fakeFetcher);
  eq(res3.newComments, 0, 'a re-run upserts nothing (dedup on the platform comment id)');
  const rows = await prisma.socialComment.findMany({ where: { workspaceId: wsId } });
  eq(rows.length, 2, 'exactly two cached rows');
  assert(rows.every((r) => r.channelId === channel.id), "each row carries the piece's channel (inbox grouping)");

  // ---- 4. mark-read ops + the snapshot fold ----
  const snap1 = await buildSnapshot(prisma, owner.id, wsId);
  eq(snap1.content.comments.length, 2, 'the snapshot lists the comments');
  eq(snap1.content.unreadComments, 2, 'both unread');
  const firstId = rows[0]?.id ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'comments-mark-read', target: {}, payload: { commentId: firstId }, userId: owner.id, clientRequestId: `cr-1-${String(stamp)}` });
  assert(await poll(async () => ((await prisma.socialComment.count({ where: { workspaceId: wsId, read: false } })) === 1 ? true : null)) === true, 'one comment marked read via the op');
  await enqueueControlAction({ workspaceId: wsId, op: 'comments-mark-read', target: {}, payload: {}, userId: owner.id, clientRequestId: `cr-all-${String(stamp)}` });
  assert(await poll(async () => ((await prisma.socialComment.count({ where: { workspaceId: wsId, read: false } })) === 0 ? true : null)) === true, 'mark-all clears the rest');
  const snap2 = await buildSnapshot(prisma, owner.id, wsId);
  eq(snap2.content.unreadComments, 0, 'the snapshot unread count follows');
} finally {
  if (wsId) {
    await prisma.socialComment.deleteMany({ where: { workspaceId: wsId } }).catch(() => undefined);
    await cleanupWorkspace(prisma, wsId, [owner.id]).catch(() => undefined);
  } else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  report('tests/integration/commentInbox.test.mts');
}
