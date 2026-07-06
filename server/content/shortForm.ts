//? Short-form clip generation (F2.2, ADR 0049) — a hook-driven vertical clip (TikTok/Shorts/Reels) via
//? video-gen (stub, no key), in the chosen style, with a generated hook + captions. Metered path. The
//? Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runMediaGeneration, estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';
import { resolveStyle } from './styles';

export interface ShortFormResult {
  ok: boolean;
  blocked?: boolean;
  assetId?: string;
  costCents: number;
  stub: boolean;
  hook: string;
}

//? Derive a punchy hook + caption lines from the prompt (dummy-data mode; a live hook-writer lands with keys).
function stubHook(prompt: string): { hook: string; captions: string[] } {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const hook = `${words.slice(0, 6).join(' ')}${words.length > 0 ? '?!' : ''}`.trim();
  const captions = [hook, prompt.trim()].filter(Boolean);
  return { hook, captions };
}

export async function generateShortForm(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; prompt: string; styleKey?: string; extraInstructions?: string },
): Promise<ShortFormResult> {
  const estimate = estimateMediaCostCents('video-gen');
  const budget = await checkMediaBudget(prisma, args.workspaceId, estimate);
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false, hook: '' };

  const resolved = await resolveStyle(prisma, args.workspaceId, 'video-gen', args.styleKey);
  const res = await runMediaGeneration({
    feature: 'video-gen', prompt: args.prompt,
    ...(resolved ? { style: { key: resolved.key, systemPrompt: resolved.systemPrompt } } : {}),
    ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}),
    workspaceId: args.workspaceId, label: 'Short-form clip',
  });
  if (!res.ok || !res.asset) return { ok: false, costCents: 0, stub: res.stub, hook: '' };

  const { hook, captions } = stubHook(args.prompt);
  const job = await prisma.mediaJob.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, feature: 'video-gen', providerId: res.providerId, ...(resolved ? { styleId: resolved.id } : {}), status: 'done', input: { prompt: args.prompt }, costCents: res.costCents } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'video', url: res.asset.url, mediaJobId: job.id, status: 'ready', metadata: { ...res.asset.metadata, hook, captions, format: 'short' } } });
  await prisma.mediaJob.update({ where: { id: job.id }, data: { resultAssetId: asset.id } });
  await recordMediaSpend(prisma, args.workspaceId, { contentProjectId: args.contentProjectId, mediaJobId: job.id, feature: 'video-gen', providerId: res.providerId, costCents: res.costCents });

  return { ok: true, assetId: asset.id, costCents: res.costCents, stub: res.stub, hook };
}
