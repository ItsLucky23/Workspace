//? Generic single-asset media generation (F2.4+, ADR 0049). The shared metered path for the simple
//? "prompt (+ optional reference) + style → one asset" features (avatar, music, sfx, model-3d): budget →
//? create a QUEUED job+asset → runMediaGeneration (with live queue→running progress) → finalize +
//? recordMediaSpend. The specialised flows (voice timing, per-beat images, short-form captions,
//? reference-image) keep their own services; this backs the rest so they don't each re-implement the
//? plumbing. The Conductor calls this (B-23) — every write below is on the single-writer chain.
//?
//? Queue-aware lifecycle (ADR): fal media can sit in the provider QUEUE before it starts. We persist
//? the MediaJob queued → running(@startedAt) → done and broadcast a content-asset delta at each step,
//? so the UI shows "in queue · position N" (no timer) and only starts the elapsed timer once the job
//? actually begins. See server/media/providers/fal.ts (onProgress) + server/read/broadcast.ts.

import type { PrismaClient } from '@prisma/client';
import { runMediaGeneration, estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';
import { broadcastContentAssetDelta } from '../read/broadcast';
import { jsonInput } from '../util/json';
import { resolveStyle } from './styles';
import type { MediaFeature, MediaProgress } from '../media/types';

export interface MediaAssetResult {
  ok: boolean;
  blocked?: boolean;
  assetId?: string;
  kind?: string;
  costCents: number;
  stub: boolean;
}

//? The asset kind per feature — so the placeholder (queued) asset already carries the right kind
//? for the UI icon before the provider result lands (it's re-confirmed from res.asset on completion).
const FEATURE_KIND: Record<MediaFeature, string> = {
  'image-gen': 'image', 'reference-image': 'image', 'video-gen': 'video', 'avatar': 'avatar',
  'model-3d': 'model-3d', 'tts': 'voice', 'music': 'music', 'sfx': 'sfx',
};

export async function generateMediaAsset(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; feature: MediaFeature; prompt?: string; referenceUrl?: string; styleKey?: string; extraInstructions?: string; label?: string },
): Promise<MediaAssetResult> {
  const { workspaceId, contentProjectId, feature } = args;
  const estimate = estimateMediaCostCents(feature);
  const budget = await checkMediaBudget(prisma, workspaceId, estimate);
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false };

  const resolved = await resolveStyle(prisma, workspaceId, feature, args.styleKey);

  //? Create the job + a placeholder asset as QUEUED up front → the piece view shows an "in queue"
  //? card immediately (before the provider call, which may sit in the fal queue). The asset links
  //? the job so the snapshot/broadcast can surface its live queuePosition/startedAt.
  const job = await prisma.mediaJob.create({ data: { workspaceId, contentProjectId, feature, providerId: '', ...(resolved ? { styleId: resolved.id } : {}), status: 'queued', input: jsonInput({ prompt: args.prompt ?? null, referenceUrl: args.referenceUrl ?? null }) } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId, contentProjectId, kind: FEATURE_KIND[feature], url: null, mediaJobId: job.id, status: 'queued', metadata: jsonInput({ feature }) } });
  await prisma.mediaJob.update({ where: { id: job.id }, data: { resultAssetId: asset.id } });
  await broadcastContentAssetDelta(prisma, workspaceId, contentProjectId, asset.id);

  //? Serialize the live queue→running transitions onto a chain we await BEFORE the final write, so a
  //? progress update can never race past the completion write. Each transition broadcasts a delta.
  let progressChain: Promise<void> = Promise.resolve();
  const onProgress = (p: MediaProgress): void => {
    progressChain = progressChain.then(async () => {
      if (p.state === 'running') {
        await prisma.mediaJob.update({ where: { id: job.id }, data: { status: 'running', startedAt: new Date(), queuePosition: null } });
        await prisma.contentAsset.update({ where: { id: asset.id }, data: { status: 'processing' } });
      } else {
        await prisma.mediaJob.update({ where: { id: job.id }, data: { queuePosition: p.queuePosition ?? null } });
      }
      await broadcastContentAssetDelta(prisma, workspaceId, contentProjectId, asset.id);
    }).catch(() => { /* a progress-write failure must never break the generation */ });
  };

  const res = await runMediaGeneration({
    feature,
    ...(args.prompt ? { prompt: args.prompt } : {}),
    ...(args.referenceUrl ? { referenceUrl: args.referenceUrl } : {}),
    ...(resolved ? { style: { key: resolved.key, systemPrompt: resolved.systemPrompt } } : {}),
    ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}),
    workspaceId, ...(args.label ? { label: args.label } : {}), onProgress,
  });
  await progressChain;

  if (!res.ok || !res.asset) {
    await prisma.mediaJob.update({ where: { id: job.id }, data: { status: 'error', providerId: res.providerId, error: res.error ?? 'media.failed' } });
    await prisma.contentAsset.update({ where: { id: asset.id }, data: { status: 'error' } });
    await broadcastContentAssetDelta(prisma, workspaceId, contentProjectId, asset.id);
    return { ok: false, costCents: 0, stub: res.stub };
  }

  await prisma.mediaJob.update({ where: { id: job.id }, data: { status: 'done', providerId: res.providerId, costCents: res.costCents } });
  await prisma.contentAsset.update({ where: { id: asset.id }, data: { kind: res.asset.kind, url: res.asset.url, status: 'ready', metadata: jsonInput(res.asset.metadata) } });
  await recordMediaSpend(prisma, workspaceId, { contentProjectId, mediaJobId: job.id, feature, providerId: res.providerId, costCents: res.costCents });
  await broadcastContentAssetDelta(prisma, workspaceId, contentProjectId, asset.id);

  return { ok: true, assetId: asset.id, kind: res.asset.kind, costCents: res.costCents, stub: res.stub };
}
