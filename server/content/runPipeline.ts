//? O-C (IDEA_TO_OUTCOME) — content pipeline orchestration. Chains the per-step content ops (script → voice →
//? scenes/images → assemble) into ONE run, so "make me a video about X" produces a complete piece instead of the
//? user clicking each generate button. Reuses the existing step functions (no new generation logic). Mode
//? 'video' decomposes into stitched scenes (the marquee path); 'slideshow' generates a still per beat. The
//? Conductor calls this (B-23). Autonomy-gating between steps is a follow-up (the run itself is the user's consent).

import type { PrismaClient } from '@prisma/client';

import { assembleContent } from './assembly';
import { generateBeatImages } from './images';
import { decomposeIntoScenes } from './sceneDecompose';
import { generateScript } from './script';
import { generateVoiceover } from './voice';

export type PipelineMode = 'video' | 'slideshow';

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
  args: { workspaceId: string; contentProjectId: string; mode?: PipelineMode; styleKey?: string; extraInstructions?: string },
): Promise<PipelineRunResult> {
  const { workspaceId, contentProjectId } = args;
  const mode: PipelineMode = args.mode ?? 'video';
  const piece = await prisma.contentProject.findFirst({ where: { workspaceId, id: contentProjectId } });
  if (!piece) return { ok: false, ranScript: false, ranVoice: false, ranVisuals: false, ranAssemble: false, mode, stub: false };
  const opts = { ...(args.styleKey ? { styleKey: args.styleKey } : {}), ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}) };
  let stub = false;

  //? 1) Script — reuse the latest if the piece already has one.
  let script = await prisma.script.findFirst({ where: { workspaceId, contentProjectId }, orderBy: { createdAt: 'desc' } });
  let ranScript = false;
  if (!script) {
    const r = await generateScript(prisma, { workspaceId, contentProjectId, brief: piece.brief ?? piece.title, ...opts });
    stub = r.stub;
    ranScript = true;
    script = await prisma.script.findFirst({ where: { workspaceId, contentProjectId }, orderBy: { createdAt: 'desc' } });
  }
  if (!script) return { ok: false, ranScript, ranVoice: false, ranVisuals: false, ranAssemble: false, mode, stub };

  //? 2) Voiceover.
  const voice = await generateVoiceover(prisma, { workspaceId, contentProjectId, scriptId: script.id, ...opts });
  stub = stub || voice.stub;

  //? 3) Visuals — video scenes (marquee) or a still per beat.
  let ranVisuals = false;
  if (mode === 'video') {
    const dec = await decomposeIntoScenes(prisma, { workspaceId, contentProjectId, scriptId: script.id });
    stub = stub || dec.stub;
    ranVisuals = dec.ok;
  } else {
    const img = await generateBeatImages(prisma, { workspaceId, contentProjectId, scriptId: script.id, ...opts });
    stub = stub || img.stub;
    ranVisuals = img.ok;
  }

  //? 4) Assemble → the final render (real stitch when there are scenes/Docker, else an honest stub — ADR 0144/0147).
  const asm = await assembleContent(prisma, { workspaceId, contentProjectId });
  stub = stub || asm.stub;

  return { ok: true, ranScript, ranVoice: true, ranVisuals, ranAssemble: asm.ok, mode, stub };
}
