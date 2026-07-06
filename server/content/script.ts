//? Content script generation (F1.2, ADR 0049). Turns a brief into a narration Script + storyboard Beats,
//? composing the chosen style + free-form extra instructions. Uses the `script` AiFeature (Gemini default);
//? because no API keys exist yet, it STUBS a valid-shaped script from the brief when the provider is
//? unavailable (dummy-data mode) so the pipeline runs end-to-end. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runAiCompletion } from '../ai/registry';
import { resolveStyle, composeStylePrompt } from './styles';

interface ParsedScript { body: string; beats: { text: string; visualPrompt: string }[] }

//? A valid-shaped STUB script from the brief (dummy-data mode) — a fixed 4-beat arc so downstream stages
//? (voice, per-beat image, assembly) always have real structure to work on.
function stubScriptFromBrief(brief: string): ParsedScript {
  const topic = brief.trim().slice(0, 80) || 'the subject';
  const beats = [
    { text: `Intro — meet ${topic}.`, visualPrompt: `an establishing shot introducing ${topic}` },
    { text: `The first thing to know about ${topic}.`, visualPrompt: `a close, revealing detail of ${topic}` },
    { text: `Why ${topic} matters.`, visualPrompt: `a dynamic, dramatic angle on ${topic}` },
    { text: `Wrapping up ${topic}.`, visualPrompt: `a calm closing shot of ${topic}` },
  ];
  return { body: beats.map((b) => b.text).join(' '), beats };
}

//? Parse a live model's script text into body + beats (one beat per non-empty line). Only reached when a
//? key is present; kept simple until the live prompt format is finalised (a keyed follow-up).
function parseLiveScript(text: string): ParsedScript {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const beats = (lines.length > 0 ? lines : ['(empty)']).map((l) => ({ text: l, visualPrompt: `a shot illustrating: ${l}` }));
  return { body: text.trim(), beats };
}

//? Generate a Script + Beats for a content piece. Returns the ids + whether it was a stub.
export async function generateScript(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; brief: string; styleKey?: string; extraInstructions?: string },
): Promise<{ scriptId: string; beatCount: number; stub: boolean; providerId: string }> {
  const style = await resolveStyle(prisma, args.workspaceId, 'script', args.styleKey);
  const system = composeStylePrompt(style, args.extraInstructions);
  const res = await runAiCompletion('script', {
    prompt: args.brief,
    ...(system ? { system } : {}),
    workspaceId: args.workspaceId,
    label: 'Content script',
  });
  const stub = !res.ok;
  const parsed = res.ok ? parseLiveScript(res.text) : stubScriptFromBrief(args.brief);

  const script = await prisma.script.create({
    data: {
      workspaceId: args.workspaceId, contentProjectId: args.contentProjectId, body: parsed.body,
      ...(style ? { styleId: style.id } : {}), providerId: res.providerId,
    },
  });
  for (const [i, b] of parsed.beats.entries()) {
    await prisma.beat.create({ data: { workspaceId: args.workspaceId, scriptId: script.id, contentProjectId: args.contentProjectId, order: i, text: b.text, visualPrompt: b.visualPrompt } });
  }
  return { scriptId: script.id, beatCount: parsed.beats.length, stub, providerId: res.providerId };
}
