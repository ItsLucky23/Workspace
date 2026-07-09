//? V3 (IDEA_TO_OUTCOME) — long-video decomposition. Turns a piece's storyboard beats into an ordered set of
//? VIDEO SCENES that FLOW into each other: each scene's generation prompt carries a continuity hint from the
//? previous beat, a clip is generated per scene (video-gen; stub without a key), and a VideoScene is created
//? linking it. This is how "make a 60s video about X" becomes N scenes stitched by V2. The Conductor calls this.

import type { PrismaClient } from '@prisma/client';

import { checkMediaBudget } from '../media/budget';
import { estimateMediaCostCents } from '../media/registry';
import { resolveStyle } from './styles';
import { runQueuedMediaAsset } from './queuedMediaJob';
import type { MediaStyle, MediaGenerationRequest } from '../media/types';

export interface ScenePromptSpec { order: number; prompt: string; sourceText: string }

//? Build the per-scene generation prompts from ordered beats so consecutive scenes are visually continuous:
//? every scene after the first is told to continue seamlessly from the previous beat's visual. Pure + tested.
export function buildContinuityPrompts(beats: { order: number; text: string; visualPrompt: string | null }[]): ScenePromptSpec[] {
  return beats.map((b, i) => {
    const base = (b.visualPrompt ?? b.text).trim();
    const prevBeat = i > 0 ? beats[i - 1] : undefined;
    const prev = prevBeat ? (prevBeat.visualPrompt ?? prevBeat.text).trim() : '';
    const prompt = i === 0 || prev.length === 0 ? base : `${base}. Continues seamlessly from the previous scene: ${prev}`;
    return { order: b.order, prompt, sourceText: b.text };
  });
}

export interface DecomposeResult { ok: boolean; sceneCount: number; costCents: number; stub: boolean; blocked: boolean }

//? M2 — build ONE scene's media-generation request. Pure + exported so a test can assert the style rides
//? every scene-gen request (the fix: the video path used to carry no style). Mirrors images.ts's request shape.
export function buildSceneRequest(prompt: string, order: number, workspaceId: string, style?: MediaStyle, extraInstructions?: string): MediaGenerationRequest {
  return { feature: 'video-gen', prompt, ...(style ? { style } : {}), ...(extraInstructions ? { extraInstructions } : {}), workspaceId, label: `Scene ${String(order)} clip` };
}

//? Decompose the piece's script beats into generated video scenes. Re-decomposing REPLACES the scene list.
//? Stops early (partial) if the media budget is hit. `sceneDurationMs` is the per-scene on-timeline length.
export async function decomposeIntoScenes(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; scriptId: string; sceneDurationMs?: number; styleKey?: string; extraInstructions?: string },
): Promise<DecomposeResult> {
  const { workspaceId, contentProjectId } = args;
  const beats = await prisma.beat.findMany({ where: { workspaceId, scriptId: args.scriptId }, orderBy: { order: 'asc' }, select: { order: true, text: true, visualPrompt: true } });
  if (beats.length === 0) return { ok: false, sceneCount: 0, costCents: 0, stub: false, blocked: false };

  //? M2 — resolve the piece's VIDEO-GEN style so EVERY scene's generation carries it (e.g. "stick-man
  //? figures" on every clip). Previously decompose passed no style → the video path was ungenerated-style.
  const resolved = await resolveStyle(prisma, workspaceId, 'video-gen', args.styleKey);
  const style: MediaStyle | undefined = resolved ? { key: resolved.key, systemPrompt: resolved.systemPrompt } : undefined;

  const specs = buildContinuityPrompts(beats);
  //? A fresh decomposition replaces the piece's scenes (the editor's manual edits are a separate save).
  await prisma.videoScene.deleteMany({ where: { workspaceId, contentProjectId } });
  const durationMs = Math.max(1000, args.sceneDurationMs ?? 5000);
  const estimate = estimateMediaCostCents('video-gen');

  let sceneCount = 0;
  let costCents = 0;
  let stub = false;
  for (const [i, spec] of specs.entries()) {
    const budget = await checkMediaBudget(prisma, workspaceId, estimate);
    if (!budget.ok) return { ok: sceneCount > 0, sceneCount, costCents, stub, blocked: true };
    //? Scenes after the first crossfade in, so they visually flow together.
    const transitionIn = i === 0 ? 'cut' : 'xfade';
    const r = await runQueuedMediaAsset(prisma, {
      workspaceId, contentProjectId, feature: 'video-gen', kind: 'video',
      ...(resolved ? { styleId: resolved.id } : {}),
      input: { prompt: spec.prompt, sceneOrder: spec.order },
      initialMetadata: { feature: 'video-gen', sceneOrder: spec.order },
      request: buildSceneRequest(spec.prompt, spec.order, workspaceId, style, args.extraInstructions),
      onComplete: async (assetId) => {
        await prisma.videoScene.create({ data: { workspaceId, contentProjectId, order: spec.order, videoAssetId: assetId, durationMs, transitionIn, prompt: spec.prompt } });
      },
    });
    if (!r.ok) continue;
    stub = stub || r.stub;
    sceneCount += 1;
    costCents += r.costCents;
  }
  return { ok: sceneCount > 0, sceneCount, costCents, stub, blocked: false };
}
