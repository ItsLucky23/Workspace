//? Voiceover generation (F1.3, ADR 0049). Turns a Script into a voice ContentAsset + a per-beat timing map
//? (so the montage in F1.5 can align visuals to the narration). Runs the full metered path: budget-check
//? (F0.2) → media gen (F0.3, stub when no key) → ContentAsset + MediaJob + recordMediaSpend. The Conductor
//? calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runMediaGeneration, estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';
import { resolveStyle } from './styles';

export interface VoiceResult {
  ok: boolean;
  blocked?: boolean;       //? budget cap hit → no gen ran
  assetId?: string;
  costCents: number;
  stub: boolean;
  totalMs: number;
}

//? Estimate a beat's spoken duration from its word count (min 1.5s). Deterministic → testable.
function beatDurationMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1500, words * 400);
}

export async function generateVoiceover(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; scriptId: string; styleKey?: string; extraInstructions?: string },
): Promise<VoiceResult> {
  const script = await prisma.script.findFirst({ where: { workspaceId: args.workspaceId, id: args.scriptId } });
  if (!script) return { ok: false, costCents: 0, stub: false, totalMs: 0 };
  const beats = await prisma.beat.findMany({ where: { workspaceId: args.workspaceId, scriptId: args.scriptId }, orderBy: { order: 'asc' } });

  //? Budget guard BEFORE the (paid) generation.
  const estimate = estimateMediaCostCents('tts');
  const budget = await checkMediaBudget(prisma, args.workspaceId, estimate);
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false, totalMs: 0 };

  const style = await resolveStyle(prisma, args.workspaceId, 'tts', args.styleKey);
  const res = await runMediaGeneration({
    feature: 'tts', prompt: script.body,
    ...(style ? { style: { key: style.key, systemPrompt: style.systemPrompt } } : {}),
    ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}),
    workspaceId: args.workspaceId, label: 'Voiceover',
  });
  if (!res.ok || !res.asset) return { ok: false, costCents: 0, stub: res.stub, totalMs: 0 };

  //? Per-beat timing (cumulative) + persist each beat's duration.
  let cursor = 0;
  const timing: { beatId: string; order: number; startMs: number; durationMs: number }[] = [];
  for (const b of beats) {
    const durationMs = beatDurationMs(b.text);
    timing.push({ beatId: b.id, order: b.order, startMs: cursor, durationMs });
    cursor += durationMs;
    await prisma.beat.update({ where: { id: b.id }, data: { durationMs } });
  }
  const totalMs = cursor;

  const job = await prisma.mediaJob.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, feature: 'tts', providerId: res.providerId, status: 'done', input: { scriptId: args.scriptId }, costCents: res.costCents } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, kind: 'voice', url: res.asset.url, mediaJobId: job.id, status: 'ready', metadata: { totalMs, timing, stub: res.stub } } });
  await prisma.mediaJob.update({ where: { id: job.id }, data: { resultAssetId: asset.id } });
  await recordMediaSpend(prisma, args.workspaceId, { contentProjectId: args.contentProjectId, mediaJobId: job.id, feature: 'tts', providerId: res.providerId, costCents: res.costCents });

  return { ok: true, assetId: asset.id, costCents: res.costCents, stub: res.stub, totalMs };
}
