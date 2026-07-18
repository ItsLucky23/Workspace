//? C3 — audience analytics + the feedback loop. The audit found NO views/CTR anywhere (only production + € cost).
//? This ingests per-post metrics from YouTube/TikTok (a `done` PublishJob's `externalId`) into `PublishJob.metrics`,
//? and summarizes the TOP performers so the ideator role can steer future content ("this worked"). The PARSERS are
//? pure + unit-tested; the fetch transport is injectable (fixture now — the live call is user-triggered with keys,
//? per the decision). Never blocks on a key.

import type { PrismaClient } from '@prisma/client';
import { tryCatch } from '@luckystack/core';

import { jsonInput } from '../util/json';

export interface PublishMetrics { views: number; likes: number; comments: number; shares: number; watchTimeSec: number; ctr: number }

const num = (v: unknown): number => { const n = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : 0); return Number.isFinite(n) ? n : 0; };

//? YouTube `videos.list?part=statistics`: { items: [{ statistics: { viewCount, likeCount, commentCount } }] }.
export function parseYouTubeMetrics(json: unknown): PublishMetrics {
  const items = (json !== null && typeof json === 'object' ? (json as Record<string, unknown>).items : null);
  const first = Array.isArray(items) && items[0] !== null && typeof items[0] === 'object' ? items[0] as Record<string, unknown> : {};
  const s = (first.statistics !== null && typeof first.statistics === 'object' ? first.statistics : {}) as Record<string, unknown>;
  const views = num(s.viewCount);
  return { views, likes: num(s.likeCount), comments: num(s.commentCount), shares: 0, watchTimeSec: 0, ctr: 0 };
}

//? TikTok video query: { data: { videos: [{ view_count, like_count, comment_count, share_count }] } }.
export function parseTiktokMetrics(json: unknown): PublishMetrics {
  const data = (json !== null && typeof json === 'object' ? (json as Record<string, unknown>).data : null);
  const videos = (data !== null && typeof data === 'object' ? (data as Record<string, unknown>).videos : null);
  const v = Array.isArray(videos) && videos[0] !== null && typeof videos[0] === 'object' ? videos[0] as Record<string, unknown> : {};
  return { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count), watchTimeSec: 0, ctr: 0 };
}

export function parsePlatformMetrics(platform: string, json: unknown): PublishMetrics {
  return platform === 'tiktok' ? parseTiktokMetrics(json) : parseYouTubeMetrics(json);
}

//? C3 — the platform post id out of the returned external url (for the analytics fetch): YouTube `watch?v=<id>`,
//? TikTok `/video/<id>`. '' when not extractable (a stub url). Pure.
export function extractExternalId(platform: string, externalUrl: string): string {
  if (externalUrl.startsWith('stub://')) return '';
  if (platform === 'youtube') return /[?&]v=([^&]+)/.exec(externalUrl)?.[1] ?? '';
  if (platform === 'tiktok') return /\/video\/([^/?]+)/.exec(externalUrl)?.[1] ?? '';
  return '';
}

//? `accountId` carries the PublishJob's connection lineage; omitted means the legacy/default account.
export type MetricsFetch = (platform: string, externalId: string, accountId?: string | null) => Promise<unknown>;

//? #141 — the pure per-platform stats REQUEST builder (transport-free, unit-testable). YouTube reads
//? `videos.list?part=statistics&id=<id>`; TikTok POSTs the video-query with the id filter. Returns null
//? for an unknown platform / empty id (the live transport then skips). The caller supplies the OAuth token.
export interface MetricsHttpRequest { url: string; method: string; headers: Record<string, string>; body?: string }
export function buildMetricsRequest(platform: string, externalId: string, accessToken: string): MetricsHttpRequest | null {
  if (!externalId) return null;
  if (platform === 'youtube') {
    return { url: `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalId)}`, method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } };
  }
  if (platform === 'tiktok') {
    return { url: 'https://open.tiktokapis.com/v2/video/query/?fields=view_count,like_count,comment_count,share_count', method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { video_ids: [externalId] } }) };
  }
  return null;
}

//? Ingest metrics for every posted job with an external id. Injectable fetch (fixture/live). Best-effort per
//? job; a fetch failure leaves the prior metrics untouched. Returns the count updated.
export async function ingestPublishMetrics(prisma: PrismaClient, workspaceId: string, fetchMetrics: MetricsFetch): Promise<{ updated: number }> {
  const jobs = await prisma.publishJob.findMany({ where: { workspaceId, status: 'done', externalId: { not: null } }, select: { id: true, platform: true, externalId: true, accountId: true } });
  let updated = 0;
  for (const job of jobs) {
    if (!job.externalId) continue;
    const [err, raw] = await tryCatch(() => fetchMetrics(job.platform, job.externalId ?? '', job.accountId));
    if (err || raw === undefined) continue;
    const metrics = parsePlatformMetrics(job.platform, raw);
    await prisma.publishJob.updateMany({ where: { id: job.id }, data: { metrics: jsonInput({ ...metrics, fetchedAt: new Date().toISOString() }) } }).catch(() => null);
    updated += 1;
  }
  return { updated };
}

//? The feedback signal for the ideator: the top-N posted pieces by views, as short lines it folds into its prompt
//? ("recent winners: …") so future ideas lean toward what worked. Pure over the fetched job+metrics rows.
export function topPerformers(rows: { platform: string; title: string; metrics: unknown }[], n = 5): { title: string; platform: string; views: number }[] {
  return rows
    .map((r) => ({ title: r.title, platform: r.platform, views: num((r.metrics !== null && typeof r.metrics === 'object' ? (r.metrics as Record<string, unknown>).views : 0)) }))
    .filter((r) => r.views > 0)
    .toSorted((a, b) => b.views - a.views)
    .slice(0, n);
}
