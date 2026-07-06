//? Generic single-asset media generation (F2.4+, ADR 0049). The shared metered path for the simple
//? "prompt (+ optional reference) + style → one asset" features (avatar, music, sfx, model-3d): budget →
//? runMediaGeneration (stub) → ContentAsset + MediaJob + recordMediaSpend. The specialised flows (voice
//? timing, per-beat images, short-form captions, reference-image) keep their own services; this backs the
//? rest so they don't each re-implement the plumbing. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runMediaGeneration, estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';
import { resolveStyle } from './styles';
import type { MediaFeature } from '../media/types';

export interface MediaAssetResult {
  ok: boolean;
  blocked?: boolean;
  assetId?: string;
  kind?: string;
  costCents: number;
  stub: boolean;
}

export async function generateMediaAsset(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; feature: MediaFeature; prompt?: string; referenceUrl?: string; styleKey?: string; extraInstructions?: string; label?: string },
): Promise<MediaAssetResult> {
  const estimate = estimateMediaCostCents(args.feature);
  const budget = await checkMediaBudget(prisma, args.workspaceId, estimate);
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false };

  const resolved = await resolveStyle(prisma, args.workspaceId, args.feature, args.styleKey);
  const res = await runMediaGeneration({
    feature: args.feature,
    ...(args.prompt ? { prompt: args.prompt } : {}),
    ...(args.referenceUrl ? { referenceUrl: args.referenceUrl } : {}),
    ...(resolved ? { style: { key: resolved.key, systemPrompt: resolved.systemPrompt } } : {}),
    ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}),
    workspaceId: args.workspaceId, ...(args.label ? { label: args.label } : {}),
  });
  if (!res.ok || !res.asset) return { ok: false, costCents: 0, stub: res.stub };

  const job = await prisma.mediaJob.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, feature: args.feature, providerId: res.providerId, ...(resolved ? { styleId: resolved.id } : {}), status: 'done', input: { prompt: args.prompt ?? null, referenceUrl: args.referenceUrl ?? null }, costCents: res.costCents } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: res.asset.kind, url: res.asset.url, mediaJobId: job.id, status: 'ready', metadata: res.asset.metadata } });
  await prisma.mediaJob.update({ where: { id: job.id }, data: { resultAssetId: asset.id } });
  await recordMediaSpend(prisma, args.workspaceId, { contentProjectId: args.contentProjectId, mediaJobId: job.id, feature: args.feature, providerId: res.providerId, costCents: res.costCents });

  return { ok: true, assetId: asset.id, kind: res.asset.kind, costCents: res.costCents, stub: res.stub };
}
