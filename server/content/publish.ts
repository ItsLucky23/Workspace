//? Publishing (F3.1/F3.2, ADR 0065) — post a content asset to a platform, ALWAYS behind the B-23 approval
//? gate: `content-request-publish` creates a WorkspaceSuggestion(type:'publish'); accepting it (the human
//? consent) makes the Conductor call `publishAsset` here. YouTube (F3.1) + TikTok (F3.2) are built; Instagram
//? + LinkedIn are FUTURE-READY (the abstraction lists them; posting isn't built). No keys → a dummy post
//? returns a valid-shaped `stub://` external url. The Conductor is the only writer of the PublishJob.

import type { PrismaClient } from '@prisma/client';

import { getConnection, type OAuthPlatform, type PublishUploadTransport, realUploadTransport } from './publishOAuth';

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
}

//? Post an asset to a platform (called by the Conductor AFTER a publish suggestion is accepted — B-23).
//? `opts.uploadTransport` is injectable for tests. When the workspace has a stored OAuth connection for
//? the platform, this runs a REAL upload with the decrypted token; otherwise it degrades to a dummy post.
export async function publishAsset(
  prisma: PrismaClient,
  workspaceId: string,
  args: { contentProjectId: string; assetId: string; platform: PublishPlatform },
  opts: { uploadTransport?: PublishUploadTransport } = {},
): Promise<PublishResult> {
  //? A future-ready platform: record the intent as an error job (no posting adapter yet).
  if (!BUILT_PLATFORMS.includes(args.platform)) {
    const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'error', error: 'platform.notBuilt' } });
    return { ok: false, publishJobId: job.id, stub: false, error: 'platform.notBuilt' };
  }

  //? Real posting when connected: decrypt the OAuth token + run the platform upload. Any failure falls
  //? back to a dummy post rather than losing the (consented) publish — the job still records the intent.
  const oauthPlatform = args.platform as OAuthPlatform; // built platforms are youtube|tiktok
  const connection = await getConnection(prisma, workspaceId, oauthPlatform);
  const asset = await prisma.contentAsset.findFirst({ where: { workspaceId, id: args.assetId }, select: { url: true } });
  const project = await prisma.contentProject.findFirst({ where: { workspaceId, id: args.contentProjectId }, select: { title: true } });

  if (connection) {
    const transport = opts.uploadTransport ?? realUploadTransport;
    const uploaded = await transport.upload(oauthPlatform, { accessToken: connection.accessToken, assetUrl: asset?.url ?? '', title: project?.title ?? 'Untitled' }).catch(() => null);
    if (uploaded) {
      const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'done', externalUrl: uploaded.externalUrl } });
      return { ok: true, publishJobId: job.id, externalUrl: uploaded.externalUrl, stub: false };
    }
  }

  //? Not connected (or upload failed) → a dummy post (valid-shaped external url).
  const externalUrl = `stub://${args.platform}/${args.assetId}`;
  const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'done', externalUrl } });
  return { ok: true, publishJobId: job.id, externalUrl, stub: true };
}
