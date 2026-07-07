//? Short-form clip generation (F2.2, ADR 0049) — a hook-driven vertical clip (TikTok/Shorts/Reels) via
//? video-gen (stub, no key), in the chosen style, with a generated hook + captions. Budget → the shared
//? queue-aware lifecycle (runQueuedMediaAsset — queued → running → done, broadcasting each step). The
//? Conductor calls this (B-23).

import type { PrismaClient } from '@prisma/client';
import { estimateMediaCostCents } from '../media/registry';
import { checkMediaBudget } from '../media/budget';
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

//? Derive a punchy hook + caption lines from the prompt (dummy-data mode; a live hook-writer lands with keys).
function stubHook(prompt: string): { hook: string; captions: string[] } {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const hook = `${words.slice(0, 6).join(' ')}${words.length > 0 ? '?!' : ''}`.trim();
  const captions = [hook, prompt.trim()].filter(Boolean);
  return { hook, captions };
}

export async function generateShortForm(
  prisma: PrismaClient,
  args: { workspaceId: string; contentProjectId: string; prompt: string; styleKey?: string; extraInstructions?: string },
): Promise<ShortFormResult> {
  const { workspaceId, contentProjectId } = args;
  const budget = await checkMediaBudget(prisma, workspaceId, estimateMediaCostCents('video-gen'));
  if (!budget.ok) return { ok: false, blocked: true, costCents: 0, stub: false, hook: '' };

  const { hook, captions } = stubHook(args.prompt);
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
