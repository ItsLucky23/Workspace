//? Content script generation (F1.2, ADR 0049). Turns a brief into a narration Script + storyboard Beats,
//? composing the chosen style + free-form extra instructions. Uses the `script` AiFeature (Gemini default);
//? because no API keys exist yet, it STUBS a valid-shaped script from the brief when the provider is
//? unavailable (dummy-data mode) so the pipeline runs end-to-end. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runAiCompletion } from '../ai/registry';
import { resolveStyle, composeStylePrompt } from './styles';
import { buildBrandContext } from './brandContext';
import { extractJson, coerceBeats } from './jsonParse';

interface ParsedScript { body: string; beats: { text: string; visualPrompt: string }[] }

//? The structured-output directive appended to the model prompt so a live response is machine-parseable.
const SCRIPT_FORMAT = 'Return ONLY a JSON object: {"body": "<the full narration>", "beats": [{"text": "<one narration beat>", "visualPrompt": "<a vivid shot description for this beat>"}]}. 4–8 beats. No prose outside the JSON.';

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

//? Parse a live model's script response into body + structured beats. Prefers the requested JSON
//? (`{body, beats:[{text, visualPrompt}]}`); falls back to a line-based parse (one beat per non-empty
//? line) when the model returned prose. Exported + pure for tests.
export function parseLiveScript(text: string): ParsedScript {
  const json = extractJson(text);
  if (json !== null && typeof json === 'object') {
    const o = json as { body?: unknown; beats?: unknown };
    const beats = coerceBeats(o.beats);
    if (beats.length > 0) {
      const body = typeof o.body === 'string' && o.body.trim().length > 0 ? o.body.trim() : beats.map((b) => b.text).join(' ');
      return { body, beats };
    }
  }
  //? Fallback: one beat per non-empty line (a model that ignored the JSON directive).
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
  //? Q2 — prepend the persistent brand/product grounding so the script is on-brand.
  const brandContext = await buildBrandContext(prisma, args.workspaceId, args.contentProjectId);
  const system = [brandContext, composeStylePrompt(style, args.extraInstructions)].map((s) => s.trim()).filter((s) => s.length > 0).join('\n\n');
  const res = await runAiCompletion('script', {
    prompt: `${args.brief}\n\n${SCRIPT_FORMAT}`,
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
