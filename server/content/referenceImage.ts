//? Reference-driven photorealistic image generation (F2.1, ADR 0049 — the #1-priority feature). Generates
//? an image CONDITIONED on a reference image, in the chosen style (e.g. `realistisch`) + free-form extra
//? instructions. Budget → the shared queue-aware lifecycle (runQueuedMediaAsset — queued → running → done,
//? broadcasting each step). The persistent custom-model/LoRA variant is a SEPARATE follow-up. The Conductor
//? calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget } from '../media/budget';
import { resolveStyle } from './styles';
import { runQueuedMediaAsset } from './queuedMediaJob';

export interface ReferenceImageResult {
  ok: boolean;
  blocked?: boolean;
  assetId?: string;
  costCents: number;
  stub: boolean;
}

export async function generateReferenceImage(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; referenceUrl: string; prompt?: string; styleKey?: string; extraInstructions?: string },
): Promise<ReferenceImageResult> {
  const { workspaceId, contentProjectId } = args;
  const budget = await checkMediaBudget(prisma, workspaceId, estimateMediaCostCents('reference-image'));
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false };

  //? Default to the photoreal style unless overridden (realism is the priority for this feature).
  const resolved = await resolveStyle(prisma, workspaceId, 'reference-image', args.styleKey ?? 'realistisch');
  const r = await runQueuedMediaAsset(prisma, {
    workspaceId, contentProjectId, feature: 'reference-image', kind: 'image',
    ...(resolved ? { styleId: resolved.id } : {}),
    input: { referenceUrl: args.referenceUrl, extraInstructions: args.extraInstructions ?? null },
    initialMetadata: { feature: 'reference-image' },
    request: { ...(args.prompt ? { prompt: args.prompt } : {}), referenceUrl: args.referenceUrl, ...(resolved ? { style: { key: resolved.key, systemPrompt: resolved.systemPrompt } } : {}), ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}), workspaceId, label: 'Reference image' },
  });

  return { ok: r.ok, ...(r.assetId ? { assetId: r.assetId } : {}), costCents: r.costCents, stub: r.stub };
}
