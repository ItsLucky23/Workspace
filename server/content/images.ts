//? Per-beat image generation (F1.4, ADR 0049). For each storyboard Beat, generate a visual (image-gen,
//? stub when no key) in the chosen style + extra instructions via the shared queue-aware lifecycle
//? (runQueuedMediaAsset — queued → running → done, broadcasting each step), and link it on the beat
//? (`imageAssetId`) once ready. Metered per image; stops early if the budget cap is hit (partial result).
//? The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget } from '../media/budget';
import { resolveStyle } from './styles';
import { runQueuedMediaAsset } from './queuedMediaJob';
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
  const { workspaceId, contentProjectId } = args;
  const beats = await prisma.beat.findMany({ where: { workspaceId, scriptId: args.scriptId }, orderBy: { order: 'asc' } });
  const resolved = await resolveStyle(prisma, workspaceId, 'image-gen', args.styleKey);
  const style: MediaStyle | undefined = resolved ? { key: resolved.key, systemPrompt: resolved.systemPrompt } : undefined;

  let imageCount = 0;
  let costCents = 0;
  let stub = false;
  const estimate = estimateMediaCostCents('image-gen');

  for (const beat of beats) {
    //? Budget guard BEFORE each (paid) image.
    const budget = await checkMediaBudget(prisma, workspaceId, estimate);
    if (!budget.ok) return { ok: imageCount > 0, imageCount, costCents, stub, blocked: true };

    const prompt = beat.visualPrompt ?? beat.text;
    const r = await runQueuedMediaAsset(prisma, {
      workspaceId, contentProjectId, feature: 'image-gen', kind: 'image',
      ...(resolved ? { styleId: resolved.id } : {}),
      input: { beatId: beat.id, prompt },
      initialMetadata: { feature: 'image-gen', beatId: beat.id },
      request: { prompt, ...(style ? { style } : {}), ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}), workspaceId, label: `Beat ${String(beat.order)} image` },
      //? Link the produced image on its beat once ready (the montage reads Beat.imageAssetId).
      onComplete: async (assetId) => { await prisma.beat.update({ where: { id: beat.id }, data: { imageAssetId: assetId } }); },
    });
    if (!r.ok) continue;
    stub = stub || r.stub;
    imageCount += 1;
    costCents += r.costCents;
  }
  return { ok: imageCount > 0, imageCount, costCents, stub, blocked: false };
}
