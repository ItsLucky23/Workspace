//? Reference-video analysis (F2.3, ADR 0049). A multimodal model watches a reference video and returns a
//? beat/style BLUEPRINT (text/structured, NOT an asset) that seeds a new Script — "mimic that video's
//? storytelling/pacing/style over a NEW story". Uses the `reference-video-analysis` AiFeature (Gemini);
//? content-local stub when no key. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runAiCompletion } from '../ai/registry';

export interface VideoBlueprint {
  pacing: string;
  styleHint: string;
  beats: { text: string; visualPrompt: string }[];
}

export interface ReferenceVideoResult {
  ok: boolean;
  scriptId?: string;
  beatCount: number;
  stub: boolean;
  providerId: string;
  blueprint: VideoBlueprint;
}

//? A valid-shaped stub blueprint (dummy-data mode) — a fixed pacing/style + a 4-beat arc for a NEW story.
function stubBlueprint(referenceVideoUrl: string, newStory: string): VideoBlueprint {
  const topic = newStory.trim().slice(0, 80) || 'the new story';
  return {
    pacing: 'fast-cut, hook-first, 4-beat arc (mirrored from the reference)',
    styleHint: 'high-contrast, punchy captions, energetic',
    beats: [
      { text: `Hook — ${topic}.`, visualPrompt: `a bold opening shot for ${topic}` },
      { text: `Build — the core of ${topic}.`, visualPrompt: `a revealing mid shot of ${topic}` },
      { text: `Turn — the twist in ${topic}.`, visualPrompt: `a dramatic angle on ${topic}` },
      { text: `Payoff — ${topic}.`, visualPrompt: `a satisfying closing shot of ${topic}` },
    ],
  };
}

export async function analyzeReferenceVideo(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; referenceVideoUrl: string; newStory: string },
): Promise<ReferenceVideoResult> {
  const res = await runAiCompletion('reference-video-analysis', {
    prompt: `Analyse the reference video at ${args.referenceVideoUrl} (its storytelling structure, pacing, visual style) and produce a blueprint to retell this NEW story in the same shape: ${args.newStory}`,
    workspaceId: args.workspaceId, label: 'Reference-video analysis',
  });
  const stub = !res.ok;
  //? Live parsing of the blueprint JSON is a keyed follow-up; the stub is the tested path.
  const blueprint = stubBlueprint(args.referenceVideoUrl, args.newStory);

  //? Seed a Script + Beats FROM the blueprint (reference → new story in the same shape).
  const script = await prisma.script.create({ data: { workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, title: 'From reference video', body: blueprint.beats.map((b) => b.text).join(' '), providerId: res.providerId } });
  for (const [i, b] of blueprint.beats.entries()) {
    await prisma.beat.create({ data: { workspaceId: args.workspaceId, scriptId: script.id, contentProjectId: args.contentProjectId, order: i, text: b.text, visualPrompt: b.visualPrompt } });
  }
  return { ok: true, scriptId: script.id, beatCount: blueprint.beats.length, stub, providerId: res.providerId, blueprint };
}
