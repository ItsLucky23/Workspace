//? V4 (IDEA_TO_OUTCOME) — range-refine. The editor selects a time range ("seconds 13–18") and asks to refine
//? it ("smoother transition", "redo the voice"); this maps the range to the covering scene(s) and regenerates
//? each as a NEW version (parentId lineage) with the instruction folded into its prompt. This is how a user
//? iterates a long video without redoing the whole thing. The Conductor calls this.

import type { PrismaClient } from '@prisma/client';

import { runQueuedMediaAsset } from './queuedMediaJob';

//? Map an ordered scene list onto the timeline and return which scenes OVERLAP [startMs, endMs). Pure + tested.
//? Each scene occupies [runningStart, runningStart+durationMs); a scene is in range if the intervals overlap.
export function scenesInRange<T extends { order: number; durationMs: number; id: string }>(scenes: T[], startMs: number, endMs: number): (T & { startMs: number; endMs: number })[] {
  const ordered = scenes.toSorted((a, b) => a.order - b.order);
  const out: (T & { startMs: number; endMs: number })[] = [];
  let cursor = 0;
  for (const s of ordered) {
    const sStart = cursor;
    const sEnd = cursor + s.durationMs;
    //? Overlap test for half-open intervals [start,end).
    if (sStart < endMs && sEnd > startMs) out.push({ ...s, startMs: sStart, endMs: sEnd });
    cursor = sEnd;
  }
  return out;
}

export interface RefineRangeResult { ok: boolean; refinedCount: number; stub: boolean; costCents: number }

//? Regenerate every scene covered by [startMs,endMs) with `instruction` folded into its prompt, as a NEW
//? version: a fresh clip + a new VideoScene (parentId = the old scene, same order/duration/transition), then
//? the old scene is removed so the timeline keeps its shape. Returns how many scenes were refined.
export async function refineSceneRange(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; startMs: number; endMs: number; instruction: string },
): Promise<RefineRangeResult> {
  const { workspaceId, contentProjectId } = args;
  const instruction = args.instruction.trim();
  if (instruction.length === 0) return { ok: false, refinedCount: 0, stub: false, costCents: 0 };
  const all = await prisma.videoScene.findMany({ where: { workspaceId, contentProjectId }, orderBy: { order: 'asc' } });
  const covered = scenesInRange(all.map((s) => ({ id: s.id, order: s.order, durationMs: s.durationMs })), args.startMs, args.endMs);
  if (covered.length === 0) return { ok: false, refinedCount: 0, stub: false, costCents: 0 };
  const byId = new Map(all.map((s) => [s.id, s]));

  let refinedCount = 0;
  let stub = false;
  let costCents = 0;
  for (const c of covered) {
    const old = byId.get(c.id);
    if (!old) continue;
    const basePrompt = (old.prompt ?? '').trim();
    const prompt = basePrompt.length > 0 ? `${basePrompt}. Refinement: ${instruction}` : instruction;
    const r = await runQueuedMediaAsset(prisma, {
      workspaceId, contentProjectId, feature: 'video-gen', kind: 'video',
      input: { prompt, refineOf: old.id },
      initialMetadata: { feature: 'video-gen', refineOf: old.id },
      request: { prompt, workspaceId, label: `Scene ${String(old.order)} refine` },
      onComplete: async (assetId) => {
        //? A new version of the scene (parentId lineage), keeping its place on the timeline.
        await prisma.videoScene.create({ data: {
          workspaceId, contentProjectId, order: old.order, durationMs: old.durationMs, startTrimMs: 0,
          transitionIn: old.transitionIn, videoAssetId: assetId, prompt, parentId: old.id,
        } });
        await prisma.videoScene.delete({ where: { id: old.id } }).catch(() => null);
      },
    });
    if (!r.ok) continue;
    stub = stub || r.stub;
    costCents += r.costCents;
    refinedCount += 1;
  }
  return { ok: refinedCount > 0, refinedCount, stub, costCents };
}
