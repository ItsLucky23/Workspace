//? Per-workspace AI provider overrides (FREEDOM_PROGRAM P1). The in-app settings picker stores a per-feature
//? provider choice as an EnvVar `__ai_provider_<feature>` (mirrors the media `__media_provider_<feature>`
//? store). `runAiCompletion` loads these and merges them UNDER any explicit call-site override, so a workspace
//? can steer which backend runs which AI feature (e.g. Gemini for scripts, Claude for reasoning) — this is what
//? finally FEEDS the `resolveAssignment` override seam that was inert. Best-effort: any read failure ⇒ no
//? overrides (falls back to the global defaults). Tenant-scoped by explicit `workspaceId` filtering.
//?
//? P4-1 — the same store also holds the WORKSPACE DEFAULT backend under the pseudo-feature `_default`
//? (EnvVar `__ai_provider__default`). One store, one op, one validation path: a separate Workspace column
//? would have meant a schema migration + a second save-op for what is semantically "the override for every
//? feature that has none of its own". The leading underscore cannot collide with a real `AiFeature` id.
//?
//? P4-2 — a stored value is `providerId[:model]`. No colon ⇒ provider only, the connection's picked model
//? applies. The split is at the FIRST colon because a provider id never contains one while a model id may
//? (`llama3.1:8b`, `vendor/model:beta`).

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { isKnownAiProviderId, providerSurface } from './providers/catalog';
import type { AiSurface } from './providers/catalog';
import type { AiFeature, AiProviderId, AiRoute } from './types';

export const AI_OVERRIDE_PREFIX = '__ai_provider_';
/** The pseudo-feature whose override is the workspace-wide default backend (P4-1). */
export const AI_DEFAULT_FEATURE = '_default';
//? Fase 5.2 — the pseudo-feature whose override is the workspace's RAG EMBEDDER
//? (`__ai_provider_embedding` = 'gemini-embedding[:model]' | 'local-embedding'). Same store, same op,
//? same validation path as every other per-feature choice — but it routes an 'embedding'-surface
//? provider, so the TEXT-overrides loader below skips it (server/rag/embed.ts reads it itself).
export const AI_EMBEDDING_FEATURE = 'embedding';
//? F-017 — derived from the provider CATALOG (ADR 0007), not a hardcoded pair. The settings picker offers every
//? connected backend, and the stored override echoed back as applied — but a stale ['claude-cli','gemini-api']
//? set here silently dropped openai-api/anthropic-api/openrouter/… at dispatch, so the choice looked saved and
//? was ignored. One source of truth: if it is in the catalog it is routable. P4-3 — no local Set any more
//? either: this is a type-guard alias over the catalog's own `isKnownAiProviderId`.
export const isAiProviderId = (v: string): v is AiProviderId => isKnownAiProviderId(v);

/** Parse a stored `providerId[:model]` override. `null` when the provider part is not a catalog id
 *  of the expected surface — a media/embedding id must never become a text route (Fase 5.2). */
export function parseAiOverride(value: string, surface: AiSurface = 'text'): AiRoute | null {
  const colon = value.indexOf(':');
  const providerId = colon === -1 ? value : value.slice(0, colon);
  const model = colon === -1 ? '' : value.slice(colon + 1).trim();
  if (!isAiProviderId(providerId) || providerSurface(providerId) !== surface) return null;
  return model.length > 0 ? { providerId, model } : { providerId };
}

/** The inverse of `parseAiOverride` — what the save-op stores. */
export function formatAiOverride(route: AiRoute): string {
  return route.model !== undefined && route.model.length > 0 ? `${route.providerId}:${route.model}` : route.providerId;
}

export interface WorkspaceAiOverrides {
  features: Partial<Record<AiFeature, AiRoute>>;
  /** The workspace default backend (`_default`), when set. */
  defaultRoute?: AiRoute;
}

export async function loadWorkspaceAiOverrides(workspaceId?: string): Promise<WorkspaceAiOverrides> {
  if (!workspaceId) return { features: {} };
  const [err, rows] = await tryCatch(() => getPrismaClient().envVar.findMany({ where: { workspaceId, key: { startsWith: AI_OVERRIDE_PREFIX } }, select: { key: true, value: true } }));
  if (err || !rows) return { features: {} };
  const out: WorkspaceAiOverrides = { features: {} };
  for (const row of rows) {
    const feature = row.key.slice(AI_OVERRIDE_PREFIX.length);
    if (feature === AI_EMBEDDING_FEATURE) continue; //? embedder choice — not a text route (embed.ts reads it)
    const route = parseAiOverride(row.value);
    if (route === null) continue;
    if (feature === AI_DEFAULT_FEATURE) out.defaultRoute = route;
    else out.features[feature as AiFeature] = route;
  }
  return out;
}
