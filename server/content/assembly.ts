//? Assembly / render (F1.5 ADR 0049; M4 depth-program — REAL render). Composes a piece's beats (+ their
//? images) + the voiceover into a REAL `.mp4` via ffmpeg-in-Docker (server/content/render). No hosted
//? render API → costCents 0 (no budget debit). When the assets are still stub `stub://` (dummy mode) OR
//? ffmpeg/Docker is unavailable, the render degrades to the valid-shaped stub asset — the complete-output
//? the user downloads + posts manually. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';

import { broadcastContentAssetDelta } from '../read/broadcast';
import { jsonInput } from '../util/json';
import { renderTimeline, type FfmpegRunner } from './render';

export interface AssembleResult {
  ok: boolean;
  renderJobId?: string;
  assetId?: string;
  stub: boolean;
  beatCount: number;
  totalMs: number;
}

export async function assembleContent(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string },
  opts: { run?: FfmpegRunner } = {},
): Promise<AssembleResult> {
  const script = await prisma.script.findFirst({ where: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId }, orderBy: { createdAt: 'desc' } });
  if (!script) return { ok: false, stub: false, beatCount: 0, totalMs: 0 };
  const beats = await prisma.beat.findMany({ where: { workspaceId: args.workspaceId, scriptId: script.id }, orderBy: { order: 'asc' } });
  const voice = await prisma.contentAsset.findFirst({ where: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'voice' }, orderBy: { createdAt: 'desc' } });

  //? Build the timeline: one clip per beat (its image + duration), narrated over the voiceover.
  const timeline = beats.map((b) => ({ order: b.order, text: b.text, imageAssetId: b.imageAssetId ?? null, durationMs: b.durationMs ?? 3000 }));
  const totalMs = timeline.reduce((sum, t) => sum + t.durationMs, 0);
  const hasAllImages = beats.length > 0 && beats.every((b) => b.imageAssetId);

  //? Resolve each beat's image asset URL for the real render (null for beats without an image).
  const imageIds = beats.map((b) => b.imageAssetId).filter((id): id is string => typeof id === 'string');
  const imageAssets = imageIds.length > 0 ? await prisma.contentAsset.findMany({ where: { workspaceId: args.workspaceId, id: { in: imageIds } } }) : [];
  const urlById = new Map(imageAssets.map((a) => [a.id, a.url ?? null]));
  const renderBeats = beats.map((b) => ({ imageUrl: b.imageAssetId ? (urlById.get(b.imageAssetId) ?? null) : null, durationMs: b.durationMs ?? 3000 }));

  const renderJob = await prisma.renderJob.create({
    data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, composition: 'faceless', input: { timeline, voiceAssetId: voice?.id ?? null, totalMs }, status: 'running', costCents: 0 },
  });
  //? Create the render asset as PROCESSING up front + broadcast, so the whole room sees "rendering…"
  //? live (ffmpeg is local → no provider queue, so no `queued`/`startedAt`; a plain spinner, not a
  //? timer). Finalized to `ready` after the render.
  const asset = await prisma.contentAsset.create({
    data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'render', url: null, status: 'processing', metadata: jsonInput({ totalMs, beatCount: beats.length, hasVoice: Boolean(voice), hasAllImages }) },
  });
  await prisma.renderJob.update({ where: { id: renderJob.id }, data: { resultAssetId: asset.id } });
  await broadcastContentAssetDelta(prisma, args.workspaceId, args.contentProjectId, asset.id);

  //? Attempt the REAL ffmpeg render; degrade to a valid-shaped stub when assets are still `stub://`
  //? (dummy mode) or ffmpeg/Docker is unavailable — the pipeline stays green without keys/Docker.
  const render = await renderTimeline({ beats: renderBeats, voiceUrl: voice?.url ?? null }, opts);
  const stub = !render.ok;
  await prisma.contentAsset.update({
    where: { id: asset.id },
    data: {
      url: render.ok ? (render.url ?? '') : `stub://render/${args.contentProjectId}`,
      ...(render.storageRef ? { storageRef: render.storageRef } : {}),
      status: 'ready',
      metadata: jsonInput({ stub, totalMs, beatCount: beats.length, hasVoice: Boolean(voice), hasAllImages, downloadable: true, ...(render.ok ? {} : { degrade: render.error ?? 'stub' }) }),
    },
  });
  await prisma.renderJob.update({ where: { id: renderJob.id }, data: { status: 'done' } });
  await broadcastContentAssetDelta(prisma, args.workspaceId, args.contentProjectId, asset.id);
  return { ok: true, renderJobId: renderJob.id, assetId: asset.id, stub, beatCount: beats.length, totalMs };
}
