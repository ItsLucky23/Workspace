//? C3 — audience-metrics ingest through Mongo with an INJECTED fetch (fixture; the live analytics call is
//? user-triggered with keys). Verifies: a posted job with an externalId gets its metrics parsed + stored; a job
//? without an externalId is skipped; and the ingest is best-effort (a fetch failure leaves the job untouched).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { ingestPublishMetrics, buildMetricsRequest } = await import('../../server/content/publishMetrics');
const { buildDeleteRequest } = await import('../../server/content/publish');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

//? #141/#131 — the pure per-platform stats + delete request builders (no DB/transport).
{
  const ytStats = buildMetricsRequest('youtube', 'YT1', 'tok');
  assert(ytStats !== null && ytStats.method === 'GET' && ytStats.url.includes('part=statistics') && ytStats.url.includes('YT1'), 'youtube stats request built with the id + statistics part');
  assert(ytStats?.headers.Authorization === 'Bearer tok', 'stats request carries the bearer token');
  const ttStats = buildMetricsRequest('tiktok', 'TT1', 'tok');
  assert(ttStats !== null && ttStats.method === 'POST' && (ttStats.body ?? '').includes('TT1'), 'tiktok stats request POSTs the video-id filter');
  eq(buildMetricsRequest('youtube', '', 'tok'), null, 'an empty external id yields no stats request');
  const ytDel = buildDeleteRequest('youtube', 'YT1', 'tok');
  assert(ytDel !== null && ytDel.method === 'DELETE' && ytDel.url.includes('YT1'), 'youtube delete request built (videos.delete)');
  eq(buildDeleteRequest('tiktok', 'TT1', 'tok'), null, 'tiktok has no public delete adapter (retract-only)');
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `pm-${String(stamp)}@youcomm.nl`, name: 'Pm' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Pm WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const dev = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const piece = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: dev?.id ?? '', title: 'Perf piece' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: piece.id, kind: 'render', url: '/media/x.mp4', status: 'ready' } });

  const yt = await prisma.publishJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', status: 'done', externalUrl: 'https://youtube.com/watch?v=YT1', externalId: 'YT1' } });
  const tt = await prisma.publishJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, assetId: asset.id, platform: 'tiktok', status: 'done', externalUrl: 'https://tiktok.com/@me/video/TT1', externalId: 'TT1' } });
  //? A done job WITHOUT an externalId (a stub post) → skipped.
  await prisma.publishJob.create({ data: { workspaceId: wsId, contentProjectId: piece.id, assetId: asset.id, platform: 'youtube', status: 'stub', externalUrl: 'stub://youtube/x' } });

  const res = await ingestPublishMetrics(prisma, wsId, async (platform, id) => {
    if (platform === 'youtube' && id === 'YT1') return { items: [{ statistics: { viewCount: '4200', likeCount: '210' } }] };
    if (platform === 'tiktok' && id === 'TT1') return { data: { videos: [{ view_count: 9000, like_count: 400, share_count: 30 }] } };
    return undefined;
  });
  eq(res.updated, 2, 'the two posted jobs with an external id were updated (the stub skipped)');

  const ytRow = await prisma.publishJob.findFirst({ where: { id: yt.id }, select: { metrics: true } });
  const ytM = (ytRow?.metrics ?? {}) as Record<string, unknown>;
  eq(ytM.views, 4200, 'youtube views ingested + stored');
  assert(typeof ytM.fetchedAt === 'string', 'a fetchedAt stamp is recorded');
  const ttRow = await prisma.publishJob.findFirst({ where: { id: tt.id }, select: { metrics: true } });
  eq(((ttRow?.metrics ?? {}) as Record<string, unknown>).views, 9000, 'tiktok views ingested + stored');

  // best-effort: a failing fetch leaves the prior metrics untouched
  const before = ((await prisma.publishJob.findFirst({ where: { id: yt.id }, select: { metrics: true } }))?.metrics ?? {}) as Record<string, unknown>;
  await ingestPublishMetrics(prisma, wsId, async () => { throw new Error('rate limited'); });
  const after = ((await prisma.publishJob.findFirst({ where: { id: yt.id }, select: { metrics: true } }))?.metrics ?? {}) as Record<string, unknown>;
  eq(after.views, before.views, 'a failed fetch leaves the prior metrics intact');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/publishMetricsIngest.test.mts');
