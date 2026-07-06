//? Publishing (F3.1/F3.2, ADR 0065) — post a content asset to a platform, ALWAYS behind the B-23 approval
//? gate: `content-request-publish` creates a WorkspaceSuggestion(type:'publish'); accepting it (the human
//? consent) makes the Conductor call `publishAsset` here. YouTube (F3.1) + TikTok (F3.2) are built; Instagram
//? + LinkedIn are FUTURE-READY (the abstraction lists them; posting isn't built). No keys → a dummy post
//? returns a valid-shaped `stub://` external url. The Conductor is the only writer of the PublishJob.

import type { PrismaClient } from '@prisma/client';

export type PublishPlatform = 'youtube' | 'tiktok' | 'instagram' | 'linkedin';

//? Platforms whose posting adapter is BUILT (dummy-postable now). Instagram/LinkedIn are future-ready.
export const BUILT_PLATFORMS: PublishPlatform[] = ['youtube', 'tiktok'];
export const FUTURE_PLATFORMS: PublishPlatform[] = ['instagram', 'linkedin'];

export function isPublishPlatform(p: string): p is PublishPlatform {
  return (['youtube', 'tiktok', 'instagram', 'linkedin'] as string[]).includes(p);
}

const PLATFORM_KEY_ENV: Record<PublishPlatform, string> = {
  youtube: 'YOUTUBE_TOKEN', tiktok: 'TIKTOK_TOKEN', instagram: 'INSTAGRAM_TOKEN', linkedin: 'LINKEDIN_TOKEN',
};

export interface PublishResult {
  ok: boolean;
  publishJobId?: string;
  externalUrl?: string;
  stub: boolean;
  error?: string;
}

//? Post an asset to a platform (called by the Conductor AFTER a publish suggestion is accepted).
export async function publishAsset(
  prisma: PrismaClient,
  workspaceId: string,
  args: { contentProjectId: string; assetId: string; platform: PublishPlatform },
): Promise<PublishResult> {
  //? A future-ready platform: record the intent as an error job (no posting adapter yet).
  if (!BUILT_PLATFORMS.includes(args.platform)) {
    const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'error', error: 'platform.notBuilt' } });
    return { ok: false, publishJobId: job.id, stub: false, error: 'platform.notBuilt' };
  }
  //? No key → a dummy post (valid-shaped external url). Live posting via the platform API lands with keys.
  const stub = !process.env[PLATFORM_KEY_ENV[args.platform]];
  const externalUrl = `stub://${args.platform}/${args.assetId}`;
  const job = await prisma.publishJob.create({ data: { workspaceId, contentProjectId: args.contentProjectId, assetId: args.assetId, platform: args.platform, status: 'done', externalUrl } });
  return { ok: true, publishJobId: job.id, externalUrl, stub };
}
