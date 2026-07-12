//? Short-form clip generation (F2.2, ADR 0049) — a hook-driven vertical clip (TikTok/Shorts/Reels) via
//? video-gen (stub, no key), in the chosen style, with a generated hook + captions. Budget → the shared
//? queue-aware lifecycle (runQueuedMediaAsset — queued → running → done, broadcasting each step). The
//? Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { tryCatch, tryCatchSync } from '@luckystack/core';
import { estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget } from '../media/budget';
import { runAiCompletion } from '../ai/registry';
import { resolveStyle } from './styles';
import { runQueuedMediaAsset } from './queuedMediaJob';

export interface ShortFormResult {
  ok: boolean;
  blocked?: boolean;
  assetId?: string;
  costCents: number;
  stub: boolean;
  hook: string;
}

//? Derive a punchy hook + caption lines from the prompt (dummy-data mode; the fallback when no AI provider).
function stubHook(prompt: string): { hook: string; captions: string[] } {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const hook = `${words.slice(0, 6).join(' ')}${words.length > 0 ? '?!' : ''}`.trim();
  const captions = [hook, prompt.trim()].filter(Boolean);
  return { hook, captions };
}

//? #137 — an AI-written hook + captions via the `script` AiFeature (provider-pluggable). Falls back to the
//? word-slice stub on no-key / failure / malformed output — so live clips get a real hook when a key is set.
async function aiHook(workspaceId: string, prompt: string): Promise<{ hook: string; captions: string[] }> {
  const [err, res] = await tryCatch(() => runAiCompletion('script', {
    prompt: `Write a scroll-stopping HOOK (max 8 words) and 2-3 short caption lines for a vertical short-form video about: "${prompt}". Respond with STRICT JSON only: {"hook": string, "captions": string[]}. No prose, no markdown.`,
    workspaceId, label: 'Short-form hook',
  }));
  if (err || !res?.ok || res.text.trim().length === 0) return stubHook(prompt);
  const start = res.text.indexOf('{');
  const end = res.text.lastIndexOf('}');
  if (start === -1 || end <= start) return stubHook(prompt);
  const [pErr, parsed] = tryCatchSync(() => JSON.parse(res.text.slice(start, end + 1)) as { hook?: unknown; captions?: unknown });
  if (pErr || parsed === null || typeof parsed !== 'object') return stubHook(prompt);
  const hook = typeof parsed.hook === 'string' && parsed.hook.trim().length > 0 ? parsed.hook.trim() : '';
  if (hook.length === 0) return stubHook(prompt);
  const captions = Array.isArray(parsed.captions) ? parsed.captions.filter((c): c is string => typeof c === 'string' && c.trim().length > 0) : [];
  return { hook, captions: captions.length > 0 ? captions : [hook] };
}

export async function generateShortForm(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; prompt: string; styleKey?: string; extraInstructions?: string },
): Promise<ShortFormResult> {
  const { workspaceId, contentProjectId } = args;
  const budget = await checkMediaBudget(prisma, workspaceId, estimateMediaCostCents('video-gen'));
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false, hook: '' };

  //? #137 — real AI hook+captions when a provider is configured; graceful stub fallback otherwise.
  const { hook, captions } = await aiHook(workspaceId, args.prompt);
  const resolved = await resolveStyle(prisma, workspaceId, 'video-gen', args.styleKey);
  const r = await runQueuedMediaAsset(prisma, {
    workspaceId, contentProjectId, feature: 'video-gen', kind: 'video',
    ...(resolved ? { styleId: resolved.id } : {}),
    input: { prompt: args.prompt },
    initialMetadata: { feature: 'video-gen', format: 'short' },
    request: { prompt: args.prompt, ...(resolved ? { style: { key: resolved.key, systemPrompt: resolved.systemPrompt } } : {}), ...(args.extraInstructions ? { extraInstructions: args.extraInstructions } : {}), workspaceId, label: 'Short-form clip' },
    finalizeMetadata: (res) => ({ ...res.asset?.metadata, hook, captions, format: 'short' }),
  });

  return { ok: r.ok, ...(r.assetId ? { assetId: r.assetId } : {}), costCents: r.costCents, stub: r.stub, hook };
}
