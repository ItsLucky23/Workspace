//? Per-beat image generation (F1.4, ADR 0049). For each storyboard Beat, generate a visual (image-gen,
//? stub when no key) in the chosen style + extra instructions, attach it as a ContentAsset, and link it on
//? the beat (`imageAssetId`). Metered per image (budget-check → gen → asset → spend). Stops early if the
//? budget cap is hit (partial result). The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runMediaGeneration, estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';
import { resolveStyle } from './styles';
import { jsonInput } from '../util/json';
import type { MediaStyle } from '../media/types';

export interface BeatImagesResult {
  ok: boolean;
  imageCount: number;
  costCents: number;
  stub: boolean;
  blocked: boolean;   //? true if the budget cap stopped it before all beats were done
}

export async function generateBeatImages(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; scriptId: string; styleKey?: string; extraInstructions?: string },
): Promise<BeatImagesResult> {
  const beats = await prisma.beat.findMany({ where: { workspaceId: args.workspaceId, scriptId: args.scriptId }, orderBy: { order: 'asc' } });
  const resolved = await resolveStyle(prisma, args.workspaceId, 'image-gen', args.styleKey);
  const style: MediaStyle | undefined = resolved ? { key: resolved.key, systemPrompt: resolved.systemPrompt } : undefined;

  let imageCount = 0;
  let costCents = 0;
  let stub = false;
  const estimate = estimateMediaCostCents('image-gen');

  for (const beat of beats) {
    //? Budget guard BEFORE each (paid) image.
    const budget = await checkMediaBudget(prisma, args.workspaceId, estimate);
    if (!budget.ok) return { ok: imageCount > 0, imageCount, costCents, stub, blocked: true };

    const res = await runMediaGeneration({
      feature: 'image-gen', prompt: beat.visualPrompt ?? beat.text,
      ...(style ? { style } : {}),
      ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}),
      workspaceId: args.workspaceId, label: `Beat ${String(beat.order)} image`,
    });
    if (!res.ok || !res.asset) continue;
    stub = stub || res.stub;

    const job = await prisma.mediaJob.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, feature: 'image-gen', providerId: res.providerId, ...(resolved ? { styleId: resolved.id } : {}), status: 'done', input: { beatId: beat.id, prompt: beat.visualPrompt ?? beat.text }, costCents: res.costCents } });
    const asset = await prisma.contentAsset.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'image', url: res.asset.url, mediaJobId: job.id, status: 'ready', metadata: jsonInput(res.asset.metadata) } });
    await prisma.mediaJob.update({ where: { id: job.id }, data: { resultAssetId: asset.id } });
    await prisma.beat.update({ where: { id: beat.id }, data: { imageAssetId: asset.id } });
    await recordMediaSpend(prisma, args.workspaceId, { contentProjectId: args.contentProjectId, mediaJobId: job.id, feature: 'image-gen', providerId: res.providerId, costCents: res.costCents });
    imageCount += 1;
    costCents += res.costCents;
  }
  return { ok: imageCount > 0, imageCount, costCents, stub, blocked: false };
}
