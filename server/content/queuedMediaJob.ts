//? Shared queue-aware media-job lifecycle (ADR 0098/0099). Every content media flow (avatar/music/sfx/
//? 3d, per-beat images, voice, short-form, reference-image) runs the SAME lifecycle through this helper:
//? create the MediaJob + ContentAsset as `queued` up front (so the piece view shows an "in queue" card
//? immediately, before the provider call which may sit in the fal queue) → run the generation with a
//? serialized queue→running progress callback → finalize to `ready` (or `error`) → broadcast a
//? content-asset delta at EVERY transition so the whole workspace room stays live. The caller supplies
//? the per-flow specifics (kind, input, the generation request, and optional finalize/side-write hooks).
//?
//? Budget is the CALLER's concern (images meters per-beat) — this helper assumes it's already checked.
//? The Conductor calls the flows (B-23); every write here is on the single-writer chain.

import type { PrismaClient } from '@prisma/client';

import { recordMediaSpend } from '../media/budget';
import { runMediaGeneration } from '../media/registry';
import type { MediaFeature, MediaGenerationRequest, MediaGenerationResult, MediaProgress } from '../media/types';
import { broadcastContentAssetDelta } from '../read/broadcast';
import { jsonInput } from '../util/json';
import { buildBrandContext } from './brandContext';

export interface QueuedMediaJobArgs {
  workspaceId: string;
  contentProjectId: string;
  feature: MediaFeature;
  kind: string;                                                     // ContentAsset.kind (placeholder + final)
  styleId?: string;
  input: Record<string, unknown>;                                   // MediaJob.input (audit)
  initialMetadata?: Record<string, unknown>;                        // ContentAsset metadata while queued
  request: Omit<MediaGenerationRequest, 'feature' | 'onProgress'>;  // prompt/referenceUrl/style/extra/label/workspaceId
  recordSpend?: boolean;                                            // default true
  finalizeMetadata?: (res: MediaGenerationResult) => Record<string, unknown>; // final asset metadata (default res.asset.metadata)
  onComplete?: (assetId: string, res: MediaGenerationResult) => Promise<void>; // per-flow side write (e.g. Beat.imageAssetId)
}

export interface QueuedMediaJobResult {
  ok: boolean;
  assetId?: string;
  kind?: string;
  url?: string;
  costCents: number;
  stub: boolean;
  error?: string;
}

export async function runQueuedMediaAsset(prisma: PrismaClient, args: QueuedMediaJobArgs): Promise<QueuedMediaJobResult> {
  const { workspaceId, contentProjectId, feature, kind } = args;

  //? Queued job + placeholder asset up front → the room sees an "in queue" card before the provider call.
  const job = await prisma.mediaJob.create({ data: { workspaceId, contentProjectId, feature, providerId: '', ...(args.styleId ? { styleId: args.styleId } : {}), status: 'queued', input: jsonInput(args.input) } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId, contentProjectId, kind, url: null, mediaJobId: job.id, status: 'queued', metadata: jsonInput(args.initialMetadata ?? {}) } });
  await prisma.mediaJob.update({ where: { id: job.id }, data: { resultAssetId: asset.id } });
  await broadcastContentAssetDelta(prisma, workspaceId, contentProjectId, asset.id);

  //? Serialize queue→running transitions onto a chain awaited BEFORE the final write, so a progress
  //? update can never race past completion. Each transition broadcasts. Failures are swallowed — a
  //? progress-write hiccup must never break the generation.
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

  //? Q2 — persistent brand/product grounding for every media flow (one choke-point). The caller's own
  //? request wins if it already set brandContext.
  const brandContext = args.request.brandContext ?? await buildBrandContext(prisma, workspaceId, contentProjectId);
  const res = await runMediaGeneration({ feature, ...args.request, ...(brandContext ? { brandContext } : {}), onProgress });
  await progressChain;

  if (!res.ok || !res.asset) {
    await prisma.mediaJob.update({ where: { id: job.id }, data: { status: 'error', providerId: res.providerId, error: res.error ?? 'media.failed' } });
    await prisma.contentAsset.update({ where: { id: asset.id }, data: { status: 'error' } });
    await broadcastContentAssetDelta(prisma, workspaceId, contentProjectId, asset.id);
    return { ok: false, costCents: 0, stub: res.stub, ...(res.error ? { error: res.error } : {}) };
  }

  const metadata = args.finalizeMetadata ? args.finalizeMetadata(res) : res.asset.metadata;
  await prisma.mediaJob.update({ where: { id: job.id }, data: { status: 'done', providerId: res.providerId, costCents: res.costCents } });
  await prisma.contentAsset.update({ where: { id: asset.id }, data: { kind: res.asset.kind, url: res.asset.url, status: 'ready', metadata: jsonInput(metadata) } });
  if (args.recordSpend !== false) await recordMediaSpend(prisma, workspaceId, { contentProjectId, mediaJobId: job.id, feature, providerId: res.providerId, costCents: res.costCents });
  if (args.onComplete) await args.onComplete(asset.id, res);
  await broadcastContentAssetDelta(prisma, workspaceId, contentProjectId, asset.id);

  return { ok: true, assetId: asset.id, kind: res.asset.kind, url: res.asset.url, costCents: res.costCents, stub: res.stub };
}
