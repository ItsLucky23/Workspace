//? Designer — AI generation of a design STYLE and an ANIMATION from a plain-language brief (the
//? "AI adjusts everything" flow, next to the theme generator). Pure prompt-builders + a JSON parser
//? (unit-testable); the impure step is the provider call via the pluggable AI layer (ADR 0007,
//? features `designer-style` / `designer-animation`). Returns the RAW parsed JSON — the client coerces
//? it into a valid DesignStyle / AnimSpec (filling any omission from a seed).

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { runAiCompletion } from '../ai/registry';
import type { AiFeature } from '../ai/types';

export function buildStylePrompt(brief: string): { system: string; prompt: string } {
  return {
    system: 'You are a senior UI designer defining a visual STYLE (the language around colours). Output ONE ```json code block only, matching exactly: {"name":string,"description":string,"radius":number,"radiusLg":number,"pill":boolean,"shadow":string,"shadowSm":string,"border":"none"|"hairline"|"solid"|"bold","density":"compact"|"cozy"|"comfortable","fontHeading":string,"fontBody":string,"weightHeading":number,"tracking":string,"motion":"none"|"snappy"|"smooth"|"bouncy","blur":number}. radius/radiusLg/blur are px numbers; shadow/shadowSm are CSS box-shadow strings; fonts are CSS font-family stacks; weightHeading 400-900; tracking a CSS letter-spacing like "-0.02em".',
    prompt: `Design a UI style for this direction:\n\n"${brief}"\n\nReturn one \`\`\`json block only.`,
  };
}

export function buildAnimPrompt(brief: string): { system: string; prompt: string } {
  return {
    system: 'You are a motion designer defining a UI ENTRANCE animation. Output ONE ```json code block only, matching exactly: {"name":string,"description":string,"fade":boolean,"x":number,"y":number,"scale":number,"rotate":number,"easing":"spring"|"linear"|"easeIn"|"easeOut"|"easeInOut","duration":number,"bounce":number}. x/y are start pixel offsets (animate to 0); scale ~0.2-1.6 (1 = none); rotate degrees; duration seconds 0.1-1.5; bounce 0-0.8 (spring only).',
    prompt: `Design a tasteful UI entrance animation for this feel:\n\n"${brief}"\n\nReturn one \`\`\`json block only.`,
  };
}

//? Parse the model's text into a raw JSON object (never throws — {} on failure).
export function parseAsset(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const slice = fenced?.[1] ?? text;
  const start = slice.indexOf('{'); const end = slice.lastIndexOf('}');
  const candidate = start !== -1 && end > start ? slice.slice(start, end + 1) : slice;
  const [, parsed] = tryCatchSync(() => JSON.parse(candidate) as unknown);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

async function generate(feature: AiFeature, build: (b: string) => { system: string; prompt: string }, brief: string, label: string, workspaceId?: string): Promise<Record<string, unknown> | null> {
  const { system, prompt } = build(brief);
  const [error, res] = await tryCatch(() => runAiCompletion(feature, { prompt, system, timeoutMs: 120_000, ...(workspaceId ? { workspaceId, label } : {}) }));
  if (error || !res?.ok || res.text.trim().length === 0) return null;
  const obj = parseAsset(res.text);
  return Object.keys(obj).length > 0 ? obj : null;
}

export function generateStyle(brief: string, workspaceId?: string): Promise<Record<string, unknown> | null> {
  return generate('designer-style', buildStylePrompt, brief, `Style · ${brief.slice(0, 40)}`, workspaceId);
}
export function generateAnimation(brief: string, workspaceId?: string): Promise<Record<string, unknown> | null> {
  return generate('designer-animation', buildAnimPrompt, brief, `Animation · ${brief.slice(0, 40)}`, workspaceId);
}
