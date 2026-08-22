//? Per-workspace AI provider overrides (FREEDOM_PROGRAM P1). The in-app settings picker stores a per-feature
//? provider choice as an EnvVar `__ai_provider_<feature>` (mirrors the media `__media_provider_<feature>`
//? store). `runAiCompletion` loads these and merges them UNDER any explicit call-site override, so a workspace
//? can steer which backend runs which AI feature (e.g. Gemini for scripts, Claude for reasoning) — this is what
//? finally FEEDS the `resolveAssignment` override seam that was inert. Best-effort: any read failure ⇒ no
//? overrides (falls back to the global defaults). Tenant-scoped by explicit `workspaceId` filtering.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { AI_PROVIDER_CATALOG } from './providers/catalog';
import type { AiFeature, AiProviderId } from './types';

export const AI_OVERRIDE_PREFIX = '__ai_provider_';
//? F-017 — derived from the provider CATALOG (ADR 0007), not a hardcoded pair. The settings picker offers every
//? connected backend, and the stored override echoed back as applied — but a stale ['claude-cli','gemini-api']
//? set here silently dropped openai-api/anthropic-api/openrouter/… at dispatch, so the choice looked saved and
//? was ignored. One source of truth: if it is in the catalog it is routable.
const PROVIDER_IDS = new Set<AiProviderId>(Object.keys(AI_PROVIDER_CATALOG));
export const isAiProviderId = (v: string): v is AiProviderId => PROVIDER_IDS.has(v);

export async function loadWorkspaceAiOverrides(workspaceId?: string): Promise<Partial<Record<AiFeature, AiProviderId>>> {
  if (!workspaceId) return {};
  const [err, rows] = await tryCatch(() => getPrismaClient().envVar.findMany({ where: { workspaceId, key: { startsWith: AI_OVERRIDE_PREFIX } }, select: { key: true, value: true } }));
  if (err || !rows) return {};
  const out: Partial<Record<AiFeature, AiProviderId>> = {};
  for (const row of rows) {
    const feature = row.key.slice(AI_OVERRIDE_PREFIX.length);
    if (isAiProviderId(row.value)) out[feature as AiFeature] = row.value;
  }
  return out;
}
