/** @docs owner ItsLucky23 */
//? CI (DOCUMENTS_AND_SKILLS) — the READ-ONLY comment inbox. Fetches comments on PUBLISHED posts
//? (PublishJob.externalId) per platform connection and caches them as SocialComment rows (upsert on
//? the platform comment id) — the UI lists + marks them read; REPLIES are a deliberate non-goal
//? (user decision 2026-07-17). YouTube gates commentThreads behind the youtube.force-ssl scope →
//? `connectionSupportsComments` flags old upload-only connections as "reconnect". TikTok's comment
//? API is partner/business-gated for most apps — the fetch is built honestly and a rejection surfaces
//? as a per-platform 'unavailable' note, never fabricated rows. Pure request-builders/parsers are
//? exported for unit tests; the network step is injectable.
//? @adr 0273

import type { PrismaClient } from '@prisma/client';
import { tryCatch } from '@luckystack/core';

import { getValidConnection, type HttpRequest, type StoredTokens } from './publishOAuth';

export interface FetchedComment { externalId: string; author: string; text: string; publishedAt: number }
export interface CommentFetchOutcome { comments: FetchedComment[]; error?: string }
export type CommentFetcher = (platform: string, accessToken: string, externalVideoId: string) => Promise<CommentFetchOutcome>;

//? YouTube: comments need force-ssl. An old connection without a stored scope predates the broadened
//? consent → treat as NOT supporting comments (the UI offers a one-time reconnect). TikTok tokens
//? carry their scope too; video.publish alone cannot list comments.
export function connectionSupportsComments(platform: string, tokens: StoredTokens): boolean {
  const scope = tokens.scope ?? '';
  if (platform === 'youtube') return scope.includes('youtube.force-ssl');
  if (platform === 'tiktok') return scope.includes('comment') || scope.includes('video.list');
  return false;
}

export function buildYoutubeCommentsRequest(accessToken: string, videoId: string, maxResults = 50): HttpRequest {
  const params = new URLSearchParams({ part: 'snippet', videoId, maxResults: String(maxResults), order: 'time', textFormat: 'plainText' });
  return { url: `https://www.googleapis.com/youtube/v3/commentThreads?${params.toString()}`, method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } };
}

export function parseYoutubeComments(json: unknown): FetchedComment[] {
  if (json === null || typeof json !== 'object') return [];
  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: FetchedComment[] = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue;
    const top = (item as { snippet?: { topLevelComment?: { id?: unknown; snippet?: Record<string, unknown> } } }).snippet?.topLevelComment;
    const sn = top?.snippet;
    if (!sn || typeof top.id !== 'string') continue;
    const author = typeof sn.authorDisplayName === 'string' ? sn.authorDisplayName : '';
    const text = typeof sn.textDisplay === 'string' ? sn.textDisplay : '';
    const publishedAt = typeof sn.publishedAt === 'string' ? Date.parse(sn.publishedAt) : Number.NaN;
    if (text.length === 0 || Number.isNaN(publishedAt)) continue;
    out.push({ externalId: top.id, author, text, publishedAt });
  }
  return out;
}

export function buildTiktokCommentsRequest(accessToken: string, videoId: string, maxCount = 50): HttpRequest {
  return {
    url: 'https://open.tiktokapis.com/v2/video/comment/list/',
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_id: videoId, max_count: maxCount }),
  };
}

export function parseTiktokComments(json: unknown): FetchedComment[] {
  if (json === null || typeof json !== 'object') return [];
  const data = (json as { data?: { comments?: unknown } }).data;
  const comments = data?.comments;
  if (!Array.isArray(comments)) return [];
  const out: FetchedComment[] = [];
  for (const c of comments) {
    if (c === null || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : (typeof rec.comment_id === 'string' ? rec.comment_id : '');
    const text = typeof rec.text === 'string' ? rec.text : '';
    const author = typeof rec.username === 'string' ? rec.username : (typeof rec.user_id === 'string' ? rec.user_id : '');
    const ts = typeof rec.create_time === 'number' ? rec.create_time * 1000 : Number.NaN;
    if (id.length === 0 || text.length === 0 || Number.isNaN(ts)) continue;
    out.push({ externalId: id, author, text, publishedAt: ts });
  }
  return out;
}

//? The LIVE fetcher (injectable in refreshComments so tests never hit the platforms).
export const liveCommentFetcher: CommentFetcher = async (platform, accessToken, externalVideoId) => {
  const req = platform === 'youtube' ? buildYoutubeCommentsRequest(accessToken, externalVideoId) : buildTiktokCommentsRequest(accessToken, externalVideoId);
  const [err, res] = await tryCatch(async () => {
    const r = await fetch(req.url, { method: req.method, headers: req.headers, ...(req.body === undefined ? {} : { body: req.body }) });
    const json = (await r.json()) as unknown;
    if (!r.ok) throw new Error(`comments ${platform} ${String(r.status)}`);
    return json;
  });
  if (err || res === null) return { comments: [], error: `comments.${platform}Unavailable` };
  return { comments: platform === 'youtube' ? parseYoutubeComments(res) : parseTiktokComments(res) };
};

export interface RefreshResult { checkedPosts: number; newComments: number; notes: string[] }

//? Refresh the inbox for ONE workspace: every done post with a platform id, via its (refreshed)
//? connection. Skips platforms whose connection can't read comments (note → the UI's reconnect hint).
//? Upserts on (workspaceId, externalId) so re-fetches never duplicate.
export async function refreshComments(prisma: PrismaClient, workspaceId: string, fetcher: CommentFetcher = liveCommentFetcher): Promise<RefreshResult> {
  const jobs = await prisma.publishJob.findMany({ where: { workspaceId, status: 'done', externalId: { not: null } }, orderBy: { updatedAt: 'desc' }, take: 30, select: { platform: true, accountId: true, externalId: true, contentProjectId: true } });
  const notes = new Set<string>();
  let newComments = 0;
  let checkedPosts = 0;
  //? Channel lookup for inbox grouping (piece → its channel).
  const pieceIds = [...new Set(jobs.map((j) => j.contentProjectId))];
  const pieces = await prisma.contentProject.findMany({ where: { workspaceId, id: { in: pieceIds } }, select: { id: true, channelId: true } });
  const channelByPiece = new Map(pieces.map((p) => [p.id, p.channelId]));
  const connCache = new Map<string, StoredTokens | null>();
  for (const job of jobs) {
    if (job.platform !== 'youtube' && job.platform !== 'tiktok') continue;
    const connKey = `${job.platform}:${job.accountId ?? ''}`;
    if (!connCache.has(connKey)) {
      const [, conn] = await tryCatch(() => getValidConnection(prisma, workspaceId, job.platform as 'youtube' | 'tiktok', { accountId: job.accountId }));
      connCache.set(connKey, conn ?? null);
    }
    const tokens = connCache.get(connKey) ?? null;
    if (!tokens) { notes.add(`comments.${job.platform}NotConnected`); continue; }
    if (!connectionSupportsComments(job.platform, tokens)) { notes.add(`comments.${job.platform}Reconnect`); continue; }
    checkedPosts += 1;
    const outcome = await fetcher(job.platform, tokens.accessToken, job.externalId ?? '');
    if (outcome.error) { notes.add(outcome.error); continue; }
    for (const c of outcome.comments) {
      const existing = await prisma.socialComment.count({ where: { workspaceId, externalId: c.externalId } });
      if (existing > 0) continue;
      await prisma.socialComment.create({
        data: {
          workspaceId, platform: job.platform, contentProjectId: job.contentProjectId,
          channelId: channelByPiece.get(job.contentProjectId) ?? null, externalVideoId: job.externalId ?? '',
          externalId: c.externalId, author: c.author, text: c.text.slice(0, 2000), publishedAt: new Date(c.publishedAt),
        },
      });
      newComments += 1;
    }
  }
  return { checkedPosts, newComments, notes: [...notes] };
}

//? Cron sweep: every workspace that has published posts (mirrors runMetricsIngest).
export const COMMENTS_INTERVAL_MS = Math.max(5, Number(process.env.WS_COMMENTS_INTERVAL_MIN ?? '30')) * 60_000;
export async function runCommentsIngest(prisma: PrismaClient): Promise<{ newComments: number }> {
  // luckystack-allow tenant-scope: cron sweep across ALL workspaces (mirrors runMetricsIngest); refreshComments re-enters per workspace with an explicit workspaceId.
  const rows = await prisma.publishJob.findMany({ where: { status: 'done', externalId: { not: null } }, select: { workspaceId: true }, distinct: ['workspaceId'] });
  let total = 0;
  for (const { workspaceId } of rows) {
    const [, res] = await tryCatch(() => refreshComments(prisma, workspaceId));
    total += res?.newComments ?? 0;
  }
  return { newComments: total };
}
