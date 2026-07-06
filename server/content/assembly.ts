//? Assembly / render (F1.5, ADR 0049). Composes a piece's beats (+ their images) + the voiceover into a
//? Remotion timeline and produces the FINAL downloadable render asset. Remotion renders LOCALLY (CPU, no
//? metered API) → costCents 0 (no budget debit). In dummy mode the render is a valid-shaped stub asset —
//? the complete-output the user downloads + posts manually. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';

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
): Promise<AssembleResult> {
  const script = await prisma.script.findFirst({ where: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId }, orderBy: { createdAt: 'desc' } });
  if (!script) return { ok: false, stub: false, beatCount: 0, totalMs: 0 };
  const beats = await prisma.beat.findMany({ where: { workspaceId: args.workspaceId, scriptId: script.id }, orderBy: { order: 'asc' } });
  const voice = await prisma.contentAsset.findFirst({ where: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'voice' }, orderBy: { createdAt: 'desc' } });

  //? Build the Remotion timeline: one clip per beat (its image + duration), narrated over the voiceover.
  const timeline = beats.map((b) => ({ order: b.order, text: b.text, imageAssetId: b.imageAssetId ?? null, durationMs: b.durationMs ?? 3000 }));
  const totalMs = timeline.reduce((sum, t) => sum + t.durationMs, 0);
  const hasAllImages = beats.length > 0 && beats.every((b) => b.imageAssetId);

  const renderJob = await prisma.renderJob.create({
    data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, composition: 'faceless', input: { timeline, voiceAssetId: voice?.id ?? null, totalMs }, status: 'done', costCents: 0 },
  });
  //? Stub render → the final downloadable asset (the primary usable output while keys are absent).
  const asset = await prisma.contentAsset.create({
    data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'render', url: `stub://render/${args.contentProjectId}`, status: 'ready', metadata: { stub: true, totalMs, beatCount: beats.length, hasVoice: Boolean(voice), hasAllImages, downloadable: true } },
  });
  await prisma.renderJob.update({ where: { id: renderJob.id }, data: { resultAssetId: asset.id } });
  return { ok: true, renderJobId: renderJob.id, assetId: asset.id, stub: true, beatCount: beats.length, totalMs };
}
