//? Publishing (F3.1/F3.2, ADR 0065) — post a content asset to a platform, ALWAYS behind the B-23 approval
//? gate: `content-request-publish` creates a WorkspaceSuggestion(type:'publish'); accepting it (the human
//? consent) makes the Conductor call `publishAsset` here. YouTube (F3.1) + TikTok (F3.2) are built; Instagram
//? + LinkedIn are FUTURE-READY (the abstraction lists them; posting isn't built). No keys → a dummy post
//? returns a valid-shaped `stub://` external url. The Conductor is the only writer of the PublishJob.

import { getPrismaClient, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { isLeader } from '../orchestrator/cluster';
import { getValidConnection, type OAuthPlatform, type OAuthRefreshTransport, type PublishUploadTransport, type PublishVariant, realUploadTransport } from './publishOAuth';
import { extractExternalId, ingestPublishMetrics, buildMetricsRequest, type MetricsFetch } from './publishMetrics';

//? O2 — pull a validated per-platform variant out of a piece's `publishVariants` JSON. Unknown/garbage → null
//? (the upload falls back to title-only, its prior behaviour). Pure + exported for tests.
export function extractPublishVariant(raw: unknown, platform: string): PublishVariant | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entry = (raw as Record<string, unknown>)[platform];
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const e = entry as Record<string, unknown>;
  const out: PublishVariant = {};
  if (typeof e.caption === 'string') out.caption = e.caption;
  if (Array.isArray(e.hashtags)) out.hashtags = e.hashtags.filter((t): t is string => typeof t === 'string');
  if (e.privacy === 'public' || e.privacy === 'unlisted' || e.privacy === 'private') out.privacy = e.privacy;
  return out;
}

//? O3 — how often the leader checks for due scheduled posts.
const PUBLISH_INTERVAL_MS = Number(process.env.WS_PUBLISH_SCHEDULER_INTERVAL_MIN ?? '1') * 60_000;

export type PublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'linkedin';

//? Platforms whose posting adapter is BUILT (dummy-postable now). Instagram/LinkedIn are future-ready.
export const BUILT_PLATFORMS: PublishPlatform[] = ['youtube', 'tiktok'];
export const FUTURE_PLATFORMS: PublishPlatform[] = ['instagram', 'linkedin'];

export function isPublishPlatform(p: string): p is PublishPlatform {
  return (['youtube', 'tiktok', 'instagram', 'linkedin'] as string[]).includes(p);
}

export interface PublishResult {
  ok: boolean;
  publishJobId?: string;
  externalUrl?: string;
  stub: boolean;
  error?: string;
  scheduled?: boolean; // O3 — the post was parked for a future scheduledAt (not posted yet)
}

//? Post an asset to a platform (called by the Conductor AFTER a publish suggestion is accepted — B-23).
//? `opts.uploadTransport` is injectable for tests. When the workspace has a stored OAuth connection for
//? the platform, this runs a REAL upload with the decrypted token; otherwise it degrades to a dummy post.
//? The honest result of an upload attempt: a REAL post, a STUB (not connected — a dummy), or an ERROR (an
//? attempted upload that failed). The audit found the old code collapsed stub+error into a fake 'done'.
type UploadOutcome = { kind: 'real'; externalUrl: string } | { kind: 'stub' } | { kind: 'error' };

//? Do the actual upload (no job write) — real post when connected, else a stub/error outcome. Extracted so
//? both the immediate path and the scheduled-fire path (O3) share one posting implementation.
async function performUpload(
  prisma: PrismaClient, workspaceId: string,
  args: { contentProjectId: string; assetId: string; platform: PublishPlatform; accountId?: string },
  opts: { uploadTransport?: PublishUploadTransport; refreshTransport?: OAuthRefreshTransport; now?: number },
): Promise<UploadOutcome> {
  const oauthPlatform = args.platform as OAuthPlatform; // built platforms are youtube|tiktok
  //? F1 + A3 — a USABLE connection for the CHOSEN account: the stored token (default account when no
  //? accountId), transparently refreshed when expired and re-saved under the same account key.
  const connection = await getValidConnection(prisma, workspaceId, oauthPlatform, { refreshTransport: opts.refreshTransport, now: opts.now, accountId: args.accountId });
  const asset = await prisma.contentAsset.findFirst({ where: { workspaceId, id: args.assetId }, select: { url: true } });
  const project = await prisma.contentProject.findFirst({ where: { workspaceId, id: args.contentProjectId }, select: { title: true, publishVariants: true } });
  //? O2 — the per-platform post override (caption/hashtags/privacy), if the piece defines one.
  const variant = extractPublishVariant(project?.publishVariants, args.platform);
  //? Honesty (audit fix): NOT connected → an explicit 'stub' (a dummy, not a live post). Connected but the
  //? upload fails → an explicit 'error' — a real failure that was previously SWALLOWED into a fake success.
  if (!connection) return { kind: 'stub' };
  const transport = opts.uploadTransport ?? realUploadTransport;
  const [err, uploaded] = await tryCatch(() => transport.upload(oauthPlatform, { accessToken: connection.accessToken, assetUrl: asset?.url ?? '', title: project?.title ?? 'Untitled', variant }));
  if (err || !uploaded) return { kind: 'error' };
  return { kind: 'real', externalUrl: uploaded.externalUrl };
}

export async function publishAsset(
  prisma: PrismaClient,
  workspaceId: string,
  args: { contentProjectId: string; assetId: string; platform: PublishPlatform; scheduledAt?: Date | null; accountId?: string },
  opts: { uploadTransport?: PublishUploadTransport; refreshTransport?: OAuthRefreshTransport; now?: number } = {},
): Promise<PublishResult> {
  //? A future-ready platform: record the intent as an error job (no posting adapter yet).
  if (!BUILT_PLATFORMS.includes(args.platform)) {
    const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'error', error: 'platform.notBuilt' } });
    return { ok: false, publishJobId: job.id, stub: false, error: 'platform.notBuilt' };
  }

  //? O3 — a future schedule: park the intent as a 'scheduled' job; the leader loop fires it when due.
  const now = opts.now ?? Date.now();
  if (args.scheduledAt && args.scheduledAt.getTime() > now) {
    const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, ...(args.accountId ? { accountId: args.accountId } : {}), status: 'scheduled', scheduledAt: args.scheduledAt } });
    return { ok: true, publishJobId: job.id, stub: false, scheduled: true };
  }

  //? Immediate: post now. The job STATUS now tells the truth — 'done' only for a real post, 'stub' for a
  //? not-connected dummy, 'error' for an attempted-but-failed upload (was silently 'done' before).
  const outcome = await performUpload(prisma, workspaceId, args, { ...opts, now });
  if (outcome.kind === 'error') {
    const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'error', error: 'publish.uploadFailed' } });
    return { ok: false, publishJobId: job.id, stub: false, error: 'publish.uploadFailed' };
  }
  const isReal = outcome.kind === 'real';
  const externalUrl = isReal ? outcome.externalUrl : `stub://${args.platform}/${args.assetId}`;
  //? C3 — record the platform post id on a real post so audience-metrics ingest can query it later.
  const externalId = isReal ? extractExternalId(args.platform, externalUrl) : '';
  const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: isReal ? 'done' : 'stub', externalUrl, ...(externalId ? { externalId } : {}) } });
  return { ok: isReal, publishJobId: job.id, externalUrl, stub: !isReal };
}

//? O3 — fire every scheduled post that is now due (leader-gated by the caller). Best-effort per job; a failed
//? upload marks the job 'error' (not lost). `now` injected for deterministic tests. Returns the fired count.
export async function runScheduledPublish(prisma: PrismaClient, now: number, opts: { uploadTransport?: PublishUploadTransport; refreshTransport?: OAuthRefreshTransport } = {}): Promise<{ fired: number }> {
  const due = await prisma.publishJob.findMany({ where: { status: 'scheduled', scheduledAt: { lte: new Date(now) } } });
  let fired = 0;
  for (const job of due) {
    const platform = job.platform;
    if (!BUILT_PLATFORMS.includes(platform as PublishPlatform)) { await prisma.publishJob.update({ where: { id: job.id }, data: { status: 'error', error: 'platform.notBuilt' } }).catch(() => null); continue; }
    //? F1 — a scheduled post fires long after connect, so refresh the (likely-expired) token before uploading.
    //? A3 — route to the account the job was scheduled for.
    const [err, res] = await tryCatch(() => performUpload(prisma, job.workspaceId, { contentProjectId: job.contentProjectId, assetId: job.assetId, platform: platform as PublishPlatform, ...(job.accountId ? { accountId: job.accountId } : {}) }, { ...opts, now }));
    if (err || !res || res.kind === 'error') { await prisma.publishJob.update({ where: { id: job.id }, data: { status: 'error', error: 'publish.uploadFailed' } }).catch(() => null); continue; }
    //? A scheduled post with no connection is 'stub' (honest), a real one is 'done'.
    const externalUrl = res.kind === 'real' ? res.externalUrl : `stub://${platform}/${job.assetId}`;
    await prisma.publishJob.update({ where: { id: job.id }, data: { status: res.kind === 'real' ? 'done' : 'stub', externalUrl } }).catch(() => null);
    //? `fired` = due jobs the scheduler PROCESSED (real or stub); the job status tells the real-vs-stub truth.
    fired += 1;
  }
  return { fired };
}

//? O3 — start the leader-gated scheduled-post loop (mirrors the watchdog interval). Returns the timer.
export function startScheduledPublisher(): ReturnType<typeof setInterval> {
  return setInterval(() => { if (isLeader()) void runScheduledPublish(getPrismaClient(), Date.now()).catch((error: unknown) => { console.error('[publish] scheduler error:', error); }); }, PUBLISH_INTERVAL_MS);
}

//? #131 — the pure per-platform DELETE request builder. YouTube supports `videos.delete`; TikTok has NO
//? public post-delete endpoint (retract-only), so it returns null and the caller falls back to marking the
//? job 'unpublished' without a live delete. Unknown platform / empty id ⇒ null. Caller supplies the token.
export function buildDeleteRequest(platform: string, externalId: string, accessToken: string): { url: string; method: string; headers: Record<string, string> } | null {
  if (!externalId) return null;
  if (platform === 'youtube') {
    return { url: `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(externalId)}`, method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } };
  }
  return null; // tiktok + others: no public delete API → retract-only
}

//? #131 — best-effort platform delete for a retracted post. Uses the platform's valid OAuth connection.
//? Returns `{ deleted, reason? }` — never throws (a failed/absent delete still lets the local retract proceed).
export async function deletePlatformPost(prisma: PrismaClient, workspaceId: string, platform: string, externalId: string): Promise<{ deleted: boolean; reason?: string }> {
  if (platform !== 'youtube' && platform !== 'tiktok') return { deleted: false, reason: 'unsupported-platform' };
  const conn = await getValidConnection(prisma, workspaceId, platform);
  if (!conn) return { deleted: false, reason: 'no-connection' };
  const req = buildDeleteRequest(platform, externalId, conn.accessToken);
  if (!req) return { deleted: false, reason: 'no-delete-adapter' };
  const [err, ok] = await tryCatch(async () => {
    //? External platform delete API — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const r = await fetch(req.url, { method: req.method, headers: req.headers });
    return r.ok;
  });
  return err || ok !== true ? { deleted: false, reason: 'delete-failed' } : { deleted: true };
}

//? #141 — how often the leader refreshes audience metrics for posted content (default hourly; APIs are slow-moving).
const METRICS_INTERVAL_MS = Number(process.env.WS_METRICS_INGEST_INTERVAL_MIN ?? '60') * 60_000;

//? #141 — the LIVE metrics-fetch transport for one workspace: use the platform's valid OAuth connection to
//? call its stats endpoint. No connection / no keys ⇒ `undefined` (ingest skips that job — never blocks).
export function buildLiveMetricsFetch(prisma: PrismaClient, workspaceId: string): MetricsFetch {
  return async (platform, externalId) => {
    if (platform !== 'youtube' && platform !== 'tiktok') return;
    const conn = await getValidConnection(prisma, workspaceId, platform);
    if (!conn) return;
    const req = buildMetricsRequest(platform, externalId, conn.accessToken);
    if (!req) return;
    const [err, json] = await tryCatch(async () => {
      //? External platform stats API — not a framework `/api/*` route.
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(req.url, { method: req.method, headers: req.headers, ...(req.body === undefined ? {} : { body: req.body }) });
      if (!r.ok) throw new Error(`metrics ${String(r.status)}`);
      return r.json() as Promise<unknown>;
    });
    return err ? undefined : json;
  };
}

//? #141 — refresh metrics for every workspace that has posted content, using the live per-workspace transport.
//? Best-effort per workspace (one failing workspace never blocks the rest). Returns the total jobs updated.
export async function runMetricsIngest(prisma: PrismaClient): Promise<{ updated: number }> {
  const rows = await prisma.publishJob.findMany({ where: { status: 'done', externalId: { not: null } }, select: { workspaceId: true }, distinct: ['workspaceId'] });
  let updated = 0;
  for (const { workspaceId } of rows) {
    const [, res] = await tryCatch(() => ingestPublishMetrics(prisma, workspaceId, buildLiveMetricsFetch(prisma, workspaceId)));
    updated += res?.updated ?? 0;
  }
  return { updated };
}

//? #141 — start the leader-gated metrics-ingest loop (mirrors the scheduled-publisher). Returns the timer.
export function startMetricsIngest(): ReturnType<typeof setInterval> {
  return setInterval(() => { if (isLeader()) void runMetricsIngest(getPrismaClient()).catch((error: unknown) => { console.error('[metrics] ingest error:', error); }); }, METRICS_INTERVAL_MS);
}
