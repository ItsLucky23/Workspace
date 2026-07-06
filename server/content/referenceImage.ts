//? Reference-driven photorealistic image generation (F2.1, ADR 0049 — the #1-priority feature). Generates
//? an image CONDITIONED on a reference image, in the chosen style (e.g. `realistisch`) + free-form extra
//? instructions (e.g. "dancing, brown curls"). Metered path (budget → reference-image gen (stub) → asset +
//? spend). The persistent custom-model/LoRA-training-from-references variant is a SEPARATE follow-up (a
//? reference set → a trained model) — this is per-generation reference conditioning, which covers the
//? user's example. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runMediaGeneration, estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';
import { resolveStyle } from './styles';
import { jsonInput } from '../util/json';

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
  const estimate = estimateMediaCostCents('reference-image');
  const budget = await checkMediaBudget(prisma, args.workspaceId, estimate);
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false };

  //? Default to the photoreal style unless overridden (realism is the priority for this feature).
  const resolved = await resolveStyle(prisma, args.workspaceId, 'reference-image', args.styleKey ?? 'realistisch');
  const res = await runMediaGeneration({
    feature: 'reference-image',
    ...(args.prompt ? { prompt: args.prompt } : {}),
    referenceUrl: args.referenceUrl,
    ...(resolved ? { style: { key: resolved.key, systemPrompt: resolved.systemPrompt } } : {}),
    ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}),
    workspaceId: args.workspaceId, label: 'Reference image',
  });
  if (!res.ok || !res.asset) return { ok: false, costCents: 0, stub: res.stub };

  const job = await prisma.mediaJob.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, feature: 'reference-image', providerId: res.providerId, ...(resolved ? { styleId: resolved.id } : {}), status: 'done', input: { referenceUrl: args.referenceUrl, extraInstructions: args.extraInstructions ?? null }, costCents: res.costCents } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'image', url: res.asset.url, mediaJobId: job.id, status: 'ready', metadata: jsonInput(res.asset.metadata) } });
  await prisma.mediaJob.update({ where: { id: job.id }, data: { resultAssetId: asset.id } });
  await recordMediaSpend(prisma, args.workspaceId, { contentProjectId: args.contentProjectId, mediaJobId: job.id, feature: 'reference-image', providerId: res.providerId, costCents: res.costCents });

  return { ok: true, assetId: asset.id, costCents: res.costCents, stub: res.stub };
}
