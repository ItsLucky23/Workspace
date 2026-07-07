//? Publishing (F3.1/F3.2, ADR 0065) — post a content asset to a platform, ALWAYS behind the B-23 approval
//? gate: `content-request-publish` creates a WorkspaceSuggestion(type:'publish'); accepting it (the human
//? consent) makes the Conductor call `publishAsset` here. YouTube (F3.1) + TikTok (F3.2) are built; Instagram
//? + LinkedIn are FUTURE-READY (the abstraction lists them; posting isn't built). No keys → a dummy post
//? returns a valid-shaped `stub://` external url. The Conductor is the only writer of the PublishJob.

import { getPrismaClient, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { isLeader } from '../orchestrator/cluster';
import { getConnection, type OAuthPlatform, type PublishUploadTransport, realUploadTransport } from './publishOAuth';

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
//? Do the actual upload (no job write) — real post when connected, else a valid-shaped dummy. Extracted so
//? both the immediate path and the scheduled-fire path (O3) share one posting implementation.
async function performUpload(
  prisma: PrismaClient, workspaceId: string,
  args: { contentProjectId: string; assetId: string; platform: PublishPlatform },
  opts: { uploadTransport?: PublishUploadTransport },
): Promise<{ externalUrl: string; stub: boolean }> {
  const oauthPlatform = args.platform as OAuthPlatform; // built platforms are youtube|tiktok
  const connection = await getConnection(prisma, workspaceId, oauthPlatform);
  const asset = await prisma.contentAsset.findFirst({ where: { workspaceId, id: args.assetId }, select: { url: true } });
  const project = await prisma.contentProject.findFirst({ where: { workspaceId, id: args.contentProjectId }, select: { title: true } });
  if (connection) {
    const transport = opts.uploadTransport ?? realUploadTransport;
    const uploaded = await transport.upload(oauthPlatform, { accessToken: connection.accessToken, assetUrl: asset?.url ?? '', title: project?.title ?? 'Untitled' }).catch(() => null);
    if (uploaded) return { externalUrl: uploaded.externalUrl, stub: false };
  }
  //? Not connected (or upload failed) → a dummy post (valid-shaped external url).
  return { externalUrl: `stub://${args.platform}/${args.assetId}`, stub: true };
}

export async function publishAsset(
  prisma: PrismaClient,
  workspaceId: string,
  args: { contentProjectId: string; assetId: string; platform: PublishPlatform; scheduledAt?: Date | null },
  opts: { uploadTransport?: PublishUploadTransport; now?: number } = {},
): Promise<PublishResult> {
  //? A future-ready platform: record the intent as an error job (no posting adapter yet).
  if (!BUILT_PLATFORMS.includes(args.platform)) {
    const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'error', error: 'platform.notBuilt' } });
    return { ok: false, publishJobId: job.id, stub: false, error: 'platform.notBuilt' };
  }

  //? O3 — a future schedule: park the intent as a 'scheduled' job; the leader loop fires it when due.
  const now = opts.now ?? Date.now();
  if (args.scheduledAt && args.scheduledAt.getTime() > now) {
    const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'scheduled', scheduledAt: args.scheduledAt } });
    return { ok: true, publishJobId: job.id, stub: false, scheduled: true };
  }

  //? Immediate: post now + record a done job.
  const { externalUrl, stub } = await performUpload(prisma, workspaceId, args, opts);
  const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'done', externalUrl } });
  return { ok: true, publishJobId: job.id, externalUrl, stub };
}

//? O3 — fire every scheduled post that is now due (leader-gated by the caller). Best-effort per job; a failed
//? upload marks the job 'error' (not lost). `now` injected for deterministic tests. Returns the fired count.
export async function runScheduledPublish(prisma: PrismaClient, now: number, opts: { uploadTransport?: PublishUploadTransport } = {}): Promise<{ fired: number }> {
  const due = await prisma.publishJob.findMany({ where: { status: 'scheduled', scheduledAt: { lte: new Date(now) } } });
  let fired = 0;
  for (const job of due) {
    const platform = job.platform;
    if (!BUILT_PLATFORMS.includes(platform as PublishPlatform)) { await prisma.publishJob.update({ where: { id: job.id }, data: { status: 'error', error: 'platform.notBuilt' } }).catch(() => null); continue; }
    const [err, res] = await tryCatch(() => performUpload(prisma, job.workspaceId, { contentProjectId: job.contentProjectId, assetId: job.assetId, platform: platform as PublishPlatform }, opts));
    if (err || !res) { await prisma.publishJob.update({ where: { id: job.id }, data: { status: 'error', error: 'publish.uploadFailed' } }).catch(() => null); continue; }
    await prisma.publishJob.update({ where: { id: job.id }, data: { status: 'done', externalUrl: res.externalUrl } }).catch(() => null);
    fired += 1;
  }
  return { fired };
}

//? O3 — start the leader-gated scheduled-post loop (mirrors the watchdog interval). Returns the timer.
export function startScheduledPublisher(): ReturnType<typeof setInterval> {
  return setInterval(() => { if (isLeader()) void runScheduledPublish(getPrismaClient(), Date.now()).catch((error: unknown) => { console.error('[publish] scheduler error:', error); }); }, PUBLISH_INTERVAL_MS);
}
