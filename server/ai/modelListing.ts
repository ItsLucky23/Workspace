//? P4-4 — LIVE model listing per connection, so a model released after catalog.ts was written shows up
//? without a code change. The catalog's static list stays the offline fallback, and the add-form's
//? free-text "other" hatch stays the escape for anything a host does not list.
//?
//? Two endpoints: `GET {baseUrl}/models` on the OpenAI shape (standard — OpenAI, Gemini-compat, OpenRouter,
//? Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, Ollama/vLLM all answer it) and Anthropic's
//? own `GET /v1/models` (same path, its own headers, `display_name` instead of a bare id). A subscription
//? CLI has no model concept → `ai.modelsUnsupported`.
//?
//? Tenant-scoped: the key comes from the workspace's OWN AiConnection row (looked up by workspaceId +
//? connectionId), never from a client field. 10-minute in-memory cache per (workspace, connection) —
//? the UI's refresh button bypasses it. The key never leaves the server; only `{id,label}` is returned.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { decryptSecret } from '../crypto/secretBox';
import { AI_PROVIDER_CATALOG, providerBaseUrl, type AiModelChoice } from './providers/catalog';

export const MODEL_LIST_TTL_MS = 10 * 60 * 1000;

export interface ModelListResult { ok: boolean; models: AiModelChoice[]; error?: string }

/** `<base>/models`, trimming a trailing slash. Pure + exported so a test can pin it. */
export const modelsUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '')}/models`;

interface OpenAiModelsBody { data?: { id?: unknown }[] }
interface AnthropicModelsBody { data?: { id?: unknown; display_name?: unknown }[] }

//? Google's compat endpoint lists ids as `models/gemini-…` while `/chat/completions` takes the bare
//? name — strip the prefix so a listed id is usable as-is. Sorted so the list is stable between refreshes.
const normalizeId = (id: string): string => id.replace(/^models\//, '');

/** Parse the OpenAI `/models` shape: `{ data: [{ id }] }` → `{id, label:id}`. Pure. */
export function parseOpenAiModels(body: unknown): AiModelChoice[] {
  const rows = (body as OpenAiModelsBody | null)?.data;
  if (!Array.isArray(rows)) return [];
  const ids = rows.map((r) => (typeof r.id === 'string' ? normalizeId(r.id.trim()) : '')).filter((id) => id.length > 0);
  return [...new Set(ids)].toSorted((a, b) => a.localeCompare(b)).map((id) => ({ id, label: id }));
}

/** Parse Anthropic's `/models` shape: `{ data: [{ id, display_name }] }`. Pure. */
export function parseAnthropicModels(body: unknown): AiModelChoice[] {
  const rows = (body as AnthropicModelsBody | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: AiModelChoice[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (typeof r.id !== 'string' || r.id.trim().length === 0 || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, label: typeof r.display_name === 'string' && r.display_name.length > 0 ? r.display_name : r.id });
  }
  return out.toSorted((a, b) => a.id.localeCompare(b.id));
}

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs: number, tag: string): Promise<[Error | null, unknown]> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  const result = await tryCatch(async () => {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    //? The status IS the diagnosis (401 bad key / 404 no such endpoint on this host) — it reaches the UI.
    if (!res.ok) throw new Error(`${tag} ${String(res.status)}`);
    return await res.json() as unknown;
  });
  clearTimeout(timer);
  return [result[0], result[1]];
}

/** Fetch the live list for ONE catalog backend with ONE key. Exported for the route + tests; no cache. */
export async function fetchProviderModels(providerId: string, apiKey: string, timeoutMs = 15_000): Promise<ModelListResult> {
  const meta = AI_PROVIDER_CATALOG[providerId];
  if (meta === undefined) return { ok: false, models: [], error: 'ai.unknownProvider' };
  if (meta.transport === 'claude-cli') return { ok: false, models: [], error: 'ai.modelsUnsupported' };
  const url = modelsUrl(providerBaseUrl(meta));
  if (meta.transport === 'anthropic') {
    const [error, body] = await fetchJson(url, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, timeoutMs, 'anthropic');
    return error ? { ok: false, models: [], error: error.message } : { ok: true, models: parseAnthropicModels(body) };
  }
  //? A local server usually wants no auth; an empty Bearer makes some of them 401 rather than ignore it.
  const [error, body] = await fetchJson(url, apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {}, timeoutMs, meta.id);
  return error ? { ok: false, models: [], error: error.message } : { ok: true, models: parseOpenAiModels(body) };
}

interface CacheEntry { expiresAt: number; models: AiModelChoice[] }
const cache = new Map<string, CacheEntry>();

/** Test seam: drop every cached list. */
export function clearModelListCache(): void { cache.clear(); }

/** The live model list for a workspace's connection (tenant-scoped), cached 10 min unless `refresh`. */
export async function listModelsForConnection(workspaceId: string, connectionId: string, refresh = false, now = Date.now()): Promise<ModelListResult & { cached: boolean }> {
  const key = `${workspaceId}:${connectionId}`;
  const hit = cache.get(key);
  if (!refresh && hit !== undefined && hit.expiresAt > now) return { ok: true, models: hit.models, cached: true };
  const [rowErr, row] = await tryCatch(() => getPrismaClient().aiConnection.findFirst({ where: { workspaceId, id: connectionId } }));
  if (rowErr || !row) return { ok: false, models: [], error: 'ai.connectionNotFound', cached: false };
  const apiKey = row.apiKey === null ? '' : (decryptSecret(row.apiKey) ?? '').trim();
  const result = await fetchProviderModels(row.providerId, apiKey);
  if (result.ok) cache.set(key, { expiresAt: now + MODEL_LIST_TTL_MS, models: result.models });
  return { ...result, cached: false };
}
