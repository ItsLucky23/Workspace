//? Content script generation (F1.2, ADR 0049). Turns a brief into a narration Script + storyboard Beats,
//? composing the chosen style + free-form extra instructions. Uses the `script` AiFeature (Gemini default);
//? because no API keys exist yet, it STUBS a valid-shaped script from the brief when the provider is
//? unavailable (dummy-data mode) so the pipeline runs end-to-end. The Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { runAiCompletion } from '../ai/registry';
import { resolveStyle, composeStylePrompt } from './styles';
import { buildBrandContext } from './brandContext';
import { buildKnowledgeContext } from './knowledgeContext';
import { retrieveContentPlaybook } from '../rag/contentPlaybook';
import { retrieveReferences } from './referenceLibrary';
import { extractJson, coerceBeats } from './jsonParse';

interface ParsedScript { body: string; beats: { text: string; visualPrompt: string }[] }

//? The structured-output directive appended to the model prompt. `targetBeats` (M3 long-form planner) asks
//? for roughly N beats so a duration target is met; without it, the default 4–8 arc.
const MAX_BEATS = 40; // cost/scene cap — a 10-min video at 5s/scene ≈ 120 scenes would be huge; the budget guard is the hard rem, this is the planner ceiling.
function scriptFormat(targetBeats?: number): string {
  const count = typeof targetBeats === 'number' && targetBeats > 0 ? `approximately ${String(Math.min(MAX_BEATS, Math.max(2, Math.round(targetBeats))))} beats (one narration beat per scene)` : '4–8 beats';
  return `Return ONLY a JSON object: {"body": "<the full narration>", "beats": [{"text": "<one narration beat>", "visualPrompt": "<a vivid shot description for this beat>"}]}. ${count}. No prose outside the JSON.`;
}

//? M3 — plan the number of beats/scenes to approach a target video duration. `null`/0 target → 0 (use the
//? default arc). Bounded to [2, MAX_BEATS]; the media budget is the true hard cap. Pure + exported.
export function planBeatCount(targetDurationMs: number | null | undefined, sceneDurationMs = 5000): number {
  if (!targetDurationMs || targetDurationMs <= 0) return 0;
  const n = Math.round(targetDurationMs / Math.max(1000, sceneDurationMs));
  return Math.max(2, Math.min(MAX_BEATS, n));
}

//? A valid-shaped STUB script from the brief (dummy-data mode) — a `targetBeats`-long arc (default 4) so
//? downstream stages (voice, per-beat image, assembly) always have real structure to work on.
function stubScriptFromBrief(brief: string, targetBeats?: number): ParsedScript {
  const topic = brief.trim().slice(0, 80) || 'the subject';
  const n = typeof targetBeats === 'number' && targetBeats >= 2 ? Math.min(MAX_BEATS, Math.round(targetBeats)) : 4;
  const arcs = [
    (t: string) => ({ text: `Intro — meet ${t}.`, visualPrompt: `an establishing shot introducing ${t}` }),
    (t: string) => ({ text: `A key detail of ${t}.`, visualPrompt: `a close, revealing detail of ${t}` }),
    (t: string) => ({ text: `Why ${t} matters.`, visualPrompt: `a dynamic, dramatic angle on ${t}` }),
    (t: string) => ({ text: `Wrapping up ${t}.`, visualPrompt: `a calm closing shot of ${t}` }),
  ];
  const beats = Array.from({ length: n }, (_, i) => arcs[i % arcs.length]?.(topic) ?? { text: topic, visualPrompt: topic });
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
  args: { workspaceId: string; contentProjectId: string; brief: string; styleKey?: string; extraInstructions?: string; targetBeats?: number },
  //? `complete` is injectable so a test can capture the composed `system` prompt (proving best-practices +
  //? references are actually injected — stub mode discards the prompt, so it can't be asserted otherwise).
  opts: { complete?: typeof runAiCompletion } = {},
): Promise<{ scriptId: string; beatCount: number; stub: boolean; providerId: string }> {
  const complete = opts.complete ?? runAiCompletion;
  const style = await resolveStyle(prisma, args.workspaceId, 'script', args.styleKey);
  //? Q2 brand/product grounding + K3 knowledge grounding (the user's enabled context-docs) prepended so the
  //? script is on-brand + uses their material.
  const brandContext = await buildBrandContext(prisma, args.workspaceId, args.contentProjectId);
  const knowledge = await buildKnowledgeContext(prisma, args.workspaceId);
  //? Ground the script on DOMAIN best-practices (hooks/retention/structure) relevant to the brief, so the AI
  //? writes what WORKS, not just what's asked. Global playbook corpus (server/rag/contentPlaybook.ts).
  const playbook = await retrieveContentPlaybook(prisma, args.brief, 3);
  const bestPractices = playbook.length > 0 ? `Proven content best-practices (apply these):\n${playbook.map((p) => p.content).join('\n\n')}` : '';
  //? Ground on the workspace's own INSPIRATION library — great examples the user collected — emulating their
  //? approach/structure, not copying them verbatim.
  const refs = await retrieveReferences(prisma, args.workspaceId, args.brief, 2);
  const inspiration = refs.length > 0 ? `Reference examples from this workspace's inspiration library (emulate the APPROACH/structure, do NOT copy verbatim):\n${refs.map((r) => r.content).join('\n\n')}` : '';
  const system = [brandContext, knowledge, bestPractices, inspiration, composeStylePrompt(style, args.extraInstructions)].map((s) => s.trim()).filter((s) => s.length > 0).join('\n\n');
  const res = await complete('script', {
    prompt: `${args.brief}\n\n${scriptFormat(args.targetBeats)}`,
    ...(system ? { system } : {}),
    workspaceId: args.workspaceId,
    label: 'Content script',
  });
  const stub = !res.ok;
  const parsed = res.ok ? parseLiveScript(res.text) : stubScriptFromBrief(args.brief, args.targetBeats);

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
