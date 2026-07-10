//? O-C (IDEA_TO_OUTCOME) — content pipeline orchestration. Chains the per-step content ops (script → voice →
//? scenes/images → assemble) into ONE run, so "make me a video about X" produces a complete piece instead of the
//? user clicking each generate button. Reuses the existing step functions (no new generation logic). Mode
//? 'video' decomposes into stitched scenes (the marquee path); 'slideshow' generates a still per beat. The
//? Conductor calls this (B-23). Autonomy-gating between steps is a follow-up (the run itself is the user's consent).

import type { PrismaClient } from '@prisma/client';

import { assembleContent } from './assembly';
import { generateBeatImages } from './images';
import { decomposeIntoScenes } from './sceneDecompose';
import { generateScript, planBeatCount } from './script';
import { generateVoiceover } from './voice';
import { CONTENT_STAGES, type ContentStage } from './pipeline';

export type PipelineMode = 'video' | 'slideshow';

//? CC1 — advance the piece's content-stage as the pipeline lands each step (script → generate → review),
//? FORWARD-ONLY: a piece already further along never regresses. Idempotent per step. The Conductor calls
//? runContentPipeline (B-23) so this stays within the single-writer path.
async function advanceStage(prisma: PrismaClient, workspaceId: string, contentProjectId: string, to: ContentStage): Promise<void> {
  const piece = await prisma.contentProject.findFirst({ where: { workspaceId, id: contentProjectId }, select: { stageId: true } });
  const curIdx = piece ? (CONTENT_STAGES as readonly string[]).indexOf(piece.stageId) : -1;
  const toIdx = (CONTENT_STAGES as readonly string[]).indexOf(to);
  if (toIdx > curIdx) await prisma.contentProject.updateMany({ where: { workspaceId, id: contentProjectId }, data: { stageId: to } });
}

export interface PipelineRunResult {
  ok: boolean;
  ranScript: boolean;
  ranVoice: boolean;
  ranVisuals: boolean;
  ranAssemble: boolean;
  mode: PipelineMode;
  stub: boolean;
}

//? Run the full content pipeline for a piece. Idempotent-ish: it reuses an existing script rather than
//? regenerating one. Each step degrades to a stub without keys but the structure (script/beats/scenes/render)
//? is real. Returns which steps ran + whether any output was a stub.
export async function runContentPipeline(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; mode?: PipelineMode; styleKey?: string; extraInstructions?: string; durationMs?: number; sceneDurationMs?: number },
): Promise<PipelineRunResult> {
  const { workspaceId, contentProjectId } = args;
  const mode: PipelineMode = args.mode ?? 'video';
  const piece = await prisma.contentProject.findFirst({ where: { workspaceId, id: contentProjectId } });
  if (!piece) return { ok: false, ranScript: false, ranVoice: false, ranVisuals: false, ranAssemble: false, mode, stub: false };
  const opts = { ...(args.styleKey ? { styleKey: args.styleKey } : {}), ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}) };
  //? M3 — long-form planner: a target duration → ~N beats/scenes (each ≈ sceneDurationMs). 0 ⇒ the default arc.
  const targetBeats = planBeatCount(args.durationMs, args.sceneDurationMs ?? 5000);
  const sceneOpt = args.sceneDurationMs ? { sceneDurationMs: args.sceneDurationMs } : {};
  let stub = false;

  //? 1) Script — reuse the latest if the piece already has one, UNLESS a target duration was given: the user
  //? asked for a specific length, so regenerate to hit the planned beat count (else the old beat count wins).
  let script = await prisma.script.findFirst({ where: { workspaceId, contentProjectId }, orderBy: { createdAt: 'desc' } });
  let ranScript = false;
  if (!script || targetBeats > 0) {
    const r = await generateScript(prisma, { workspaceId, contentProjectId, brief: piece.brief ?? piece.title, ...opts, ...(targetBeats > 0 ? { targetBeats } : {}) });
    stub = r.stub;
    ranScript = true;
    script = await prisma.script.findFirst({ where: { workspaceId, contentProjectId }, orderBy: { createdAt: 'desc' } });
  }
  if (!script) return { ok: false, ranScript, ranVoice: false, ranVisuals: false, ranAssemble: false, mode, stub };
  //? CC1 — a script exists → the piece is at least at the 'script' stage.
  await advanceStage(prisma, workspaceId, contentProjectId, 'script');

  //? 2) Voiceover.
  const voice = await generateVoiceover(prisma, { workspaceId, contentProjectId, scriptId: script.id, ...opts });
  stub = stub || voice.stub;

  //? 3) Visuals — video scenes (marquee) or a still per beat.
  let ranVisuals = false;
  if (mode === 'video') {
    const dec = await decomposeIntoScenes(prisma, { workspaceId, contentProjectId, scriptId: script.id, ...opts, ...sceneOpt });
    stub = stub || dec.stub;
    ranVisuals = dec.ok;
  } else {
    const img = await generateBeatImages(prisma, { workspaceId, contentProjectId, scriptId: script.id, ...opts });
    stub = stub || img.stub;
    ranVisuals = img.ok;
  }
  //? CC1 — visuals produced → the piece reached the 'generate' stage.
  if (ranVisuals) await advanceStage(prisma, workspaceId, contentProjectId, 'generate');

  //? 4) Assemble → the final render (real stitch when there are scenes/Docker, else an honest stub — ADR 0144/0147).
  const asm = await assembleContent(prisma, { workspaceId, contentProjectId });
  stub = stub || asm.stub;
  //? CC1 — a render exists → the piece is ready for human review (publish stays an explicit gated op).
  if (asm.ok) await advanceStage(prisma, workspaceId, contentProjectId, 'review');

  return { ok: true, ranScript, ranVoice: true, ranVisuals, ranAssemble: asm.ok, mode, stub };
}
