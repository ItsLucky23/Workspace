//? Voiceover generation (F1.3, ADR 0049). Turns a Script into a voice ContentAsset + a per-beat timing map
//? (so the montage in F1.5 can align visuals to the narration). Budget-check → the shared queue-aware
//? lifecycle (runQueuedMediaAsset — queued → running → done, broadcasting each step). The timing map is
//? deterministic from the beats: it's carried into the final asset metadata and written to Beat.durationMs
//? on completion. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget } from '../media/budget';
import { resolveStyle } from './styles';
import { runQueuedMediaAsset } from './queuedMediaJob';

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
  const { workspaceId, contentProjectId } = args;
  const script = await prisma.script.findFirst({ where: { workspaceId, id: args.scriptId } });
  if (!script) return { ok: false, costCents: 0, stub: false, totalMs: 0 };
  const beats = await prisma.beat.findMany({ where: { workspaceId, scriptId: args.scriptId }, orderBy: { order: 'asc' } });

  //? Budget guard BEFORE the (paid) generation.
  const budget = await checkMediaBudget(prisma, workspaceId, estimateMediaCostCents('tts'));
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false, totalMs: 0 };

  //? Per-beat cumulative timing (deterministic from the beats — no gen needed). Carried into the asset
  //? metadata + written to Beat.durationMs on completion.
  let cursor = 0;
  const timing: { beatId: string; order: number; startMs: number; durationMs: number }[] = [];
  for (const b of beats) {
    const durationMs = beatDurationMs(b.text);
    timing.push({ beatId: b.id, order: b.order, startMs: cursor, durationMs });
    cursor += durationMs;
  }
  const totalMs = cursor;

  const style = await resolveStyle(prisma, workspaceId, 'tts', args.styleKey);
  const r = await runQueuedMediaAsset(prisma, {
    workspaceId, contentProjectId, feature: 'tts', kind: 'voice',
    input: { scriptId: args.scriptId },
    initialMetadata: { feature: 'tts' },
    request: { prompt: script.body, ...(style ? { style: { key: style.key, systemPrompt: style.systemPrompt } } : {}), ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}), workspaceId, label: 'Voiceover' },
    finalizeMetadata: (res) => ({ totalMs, timing, stub: res.stub }),
    //? Persist each beat's duration only once the voiceover is ready.
    onComplete: async () => { for (const t of timing) await prisma.beat.update({ where: { id: t.beatId }, data: { durationMs: t.durationMs } }); },
  });

  return { ok: r.ok, ...(r.assetId ? { assetId: r.assetId } : {}), costCents: r.costCents, stub: r.stub, totalMs };
}
