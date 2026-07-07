//? Assembly / render (F1.5 ADR 0049; M4 depth-program — REAL render). Composes a piece's beats (+ their
//? images) + the voiceover into a REAL `.mp4` via ffmpeg-in-Docker (server/content/render). No hosted
//? render API → costCents 0 (no budget debit). When the assets are still stub `stub://` (dummy mode) OR
//? ffmpeg/Docker is unavailable, the render degrades to the valid-shaped stub asset — the complete-output
//? the user downloads + posts manually. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';

import { broadcastContentAssetDelta } from '../read/broadcast';
import { jsonInput } from '../util/json';
import { renderTimeline, renderScenes, type FfmpegRunner } from './render';

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

  //? V2 — real multi-clip video: when the piece has an edited SCENE timeline, render THAT (stitched real clips
  //? with trims + transitions) instead of the beat slideshow. Resolve each scene's clip/still asset url.
  const scenes = await prisma.videoScene.findMany({ where: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId }, orderBy: { order: 'asc' } });
  const sceneAssetIds = scenes.flatMap((s) => [s.videoAssetId, s.imageAssetId].filter((id): id is string => typeof id === 'string' && id.length > 0));
  const sceneAssets = sceneAssetIds.length > 0 ? await prisma.contentAsset.findMany({ where: { workspaceId: args.workspaceId, id: { in: sceneAssetIds } } }) : [];
  const sceneUrlById = new Map(sceneAssets.map((a) => [a.id, a.url ?? null]));
  const renderScenesInput = scenes.map((s) => ({
    videoUrl: s.videoAssetId ? (sceneUrlById.get(s.videoAssetId) ?? null) : null,
    imageUrl: s.imageAssetId ? (sceneUrlById.get(s.imageAssetId) ?? null) : null,
    startTrimMs: s.startTrimMs, durationMs: s.durationMs, transitionIn: s.transitionIn,
  }));
  const useScenes = scenes.length > 0;
  //? When rendering scenes, the timeline length + segment count come from the scenes, not the beats.
  const effectiveTotalMs = useScenes ? renderScenesInput.reduce((sum, s) => sum + s.durationMs, 0) : totalMs;
  const segmentCount = useScenes ? scenes.length : beats.length;

  const renderJob = await prisma.renderJob.create({
    data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, composition: 'faceless', input: { timeline, voiceAssetId: voice?.id ?? null, totalMs }, status: 'running', costCents: 0 },
  });
  //? Create the render asset as PROCESSING up front + broadcast, so the whole room sees "rendering…"
  //? live (ffmpeg is local → no provider queue, so no `queued`/`startedAt`; a plain spinner, not a
  //? timer). Finalized to `ready` after the render.
  const asset = await prisma.contentAsset.create({
    data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'render', url: null, status: 'processing', metadata: jsonInput({ totalMs: effectiveTotalMs, beatCount: segmentCount, hasVoice: Boolean(voice), hasAllImages, ...(useScenes ? { sceneCount: scenes.length } : {}) }) },
  });
  await prisma.renderJob.update({ where: { id: renderJob.id }, data: { resultAssetId: asset.id } });
  await broadcastContentAssetDelta(prisma, args.workspaceId, args.contentProjectId, asset.id);

  //? Attempt the REAL ffmpeg render; degrade to a valid-shaped stub when assets are still `stub://`
  //? (dummy mode) or ffmpeg/Docker is unavailable — the pipeline stays green without keys/Docker.
  const render = useScenes
    ? await renderScenes({ scenes: renderScenesInput, voiceUrl: voice?.url ?? null }, opts)
    : await renderTimeline({ beats: renderBeats, voiceUrl: voice?.url ?? null }, opts);
  const stub = !render.ok;
  //? Honesty (audit fix): a stub render did NOT produce a real mp4 → it is NOT 'ready' and NOT 'downloadable'.
  //? Previously it was recorded 'ready'+downloadable:true with a `stub://render/...` url — a fake finished video.
  await prisma.contentAsset.update({
    where: { id: asset.id },
    data: {
      url: render.ok ? (render.url ?? '') : `stub://render/${args.contentProjectId}`,
      ...(render.storageRef ? { storageRef: render.storageRef } : {}),
      status: render.ok ? 'ready' : 'error',
      metadata: jsonInput({ stub, totalMs: effectiveTotalMs, beatCount: segmentCount, hasVoice: Boolean(voice), hasAllImages, downloadable: render.ok, ...(useScenes ? { sceneCount: scenes.length } : {}), ...(render.ok ? {} : { degrade: render.error ?? 'stub' }) }),
    },
  });
  await prisma.renderJob.update({ where: { id: renderJob.id }, data: { status: render.ok ? 'done' : 'error' } });
  await broadcastContentAssetDelta(prisma, args.workspaceId, args.contentProjectId, asset.id);
  return { ok: true, renderJobId: renderJob.id, assetId: asset.id, stub, beatCount: segmentCount, totalMs: effectiveTotalMs };
}
