//? Generic single-asset media generation (F2.4+, ADR 0049). The shared metered path for the simple
//? "prompt (+ optional reference) + style → one asset" features (avatar, music, sfx, model-3d). Budget →
//? the shared queue-aware lifecycle (runQueuedMediaAsset: queued → running@startedAt → done, broadcasting
//? every transition). The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget } from '../media/budget';
import { resolveStyle } from './styles';
import { runQueuedMediaAsset } from './queuedMediaJob';
import type { MediaFeature } from '../media/types';

export interface MediaAssetResult {
  ok: boolean;
  blocked?: boolean;
  assetId?: string;
  kind?: string;
  costCents: number;
  stub: boolean;
}

//? The asset kind per feature — so the placeholder (queued) asset already carries the right kind for the
//? UI icon before the provider result lands (it's re-confirmed from res.asset on completion).
const FEATURE_KIND: Record<MediaFeature, string> = {
  'image-gen': 'image', 'reference-image': 'image', 'video-gen': 'video', 'avatar': 'avatar',
  'model-3d': 'model-3d', 'tts': 'voice', 'music': 'music', 'sfx': 'sfx', 'inpaint': 'image',
};

export async function generateMediaAsset(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; feature: MediaFeature; prompt?: string; referenceUrl?: string; maskUrl?: string; styleKey?: string; extraInstructions?: string; label?: string },
): Promise<MediaAssetResult> {
  const { workspaceId, contentProjectId, feature } = args;
  const budget = await checkMediaBudget(prisma, workspaceId, estimateMediaCostCents(feature));
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false };

  const resolved = await resolveStyle(prisma, workspaceId, feature, args.styleKey);
  const r = await runQueuedMediaAsset(prisma, {
    workspaceId, contentProjectId, feature, kind: FEATURE_KIND[feature],
    ...(resolved ? { styleId: resolved.id } : {}),
    input: { prompt: args.prompt ?? null, referenceUrl: args.referenceUrl ?? null },
    initialMetadata: { feature },
    request: {
      ...(args.prompt ? { prompt: args.prompt } : {}),
      ...(args.referenceUrl ? { referenceUrl: args.referenceUrl } : {}),
      ...(args.maskUrl ? { maskUrl: args.maskUrl } : {}),
      ...(resolved ? { style: { key: resolved.key, systemPrompt: resolved.systemPrompt } } : {}),
      ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}),
      workspaceId, ...(args.label ? { label: args.label } : {}),
    },
  });

  return { ok: r.ok, ...(r.assetId ? { assetId: r.assetId } : {}), ...(r.kind ? { kind: r.kind } : {}), costCents: r.costCents, stub: r.stub };
}
