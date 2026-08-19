//? Per-workspace configuration for a TEXT backend, generic over providers.
//?
//? Gemini's settings lived in three dedicated `Workspace` columns (`geminiModel`, `geminiTemperature`,
//? `geminiBaseUrl`) and its key in an EnvVar. That works for exactly one provider and is why the
//? AI-behaviour page was Gemini-shaped: there was nowhere to put a second backend's model. The media
//? side already solved this generically — `__media_model_<feature>` — so this uses the same shape:
//?
//?   __provider_key_<id>   the API key, ENCRYPTED (already the convention, shared with media)
//?   __ai_model_<id>       the chosen model
//?   __ai_baseurl_<id>     the endpoint, for a proxy / self-host / OpenAI-compatible gateway
//?   __ai_temp_<id>        temperature
//?
//? The legacy Gemini columns are still READ as a fallback so no workspace loses what it configured
//? before this existed; nothing writes them any more.
//? @adr 0007

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { decryptSecret } from '../crypto/secretBox';
import { AI_PROVIDER_CATALOG } from './providers/catalog';
import type { AiProviderId } from './types';

export interface ResolvedProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** null = let the provider decide; a number is clamped to the provider's accepted range. */
  temperature: number | null;
}

const cfgKey = (prefix: string, id: AiProviderId): string => `__ai_${prefix}_${id}`;

/** Read every stored setting for one backend, in one query, falling back through the layers. */
export async function resolveProviderConfig(
  id: AiProviderId,
  workspaceId: string | undefined,
  envFallback: { apiKey: string; model: string; baseUrl: string },
): Promise<ResolvedProviderConfig> {
  const meta = AI_PROVIDER_CATALOG[id];
  const defaults: ResolvedProviderConfig = {
    apiKey: envFallback.apiKey,
    model: envFallback.model || meta.defaultModel,
    baseUrl: envFallback.baseUrl || meta.defaultBaseUrl,
    temperature: null,
  };
  if (workspaceId === undefined) return defaults;

  const prisma = getPrismaClient();
  const [, rows] = await tryCatch(() => prisma.envVar.findMany({
    where: { workspaceId, key: { in: [`__provider_key_${id}`, cfgKey('model', id), cfgKey('baseurl', id), cfgKey('temp', id)] } },
    select: { key: true, value: true },
  }));
  const stored = new Map((rows ?? []).map((r) => [r.key, r.value]));

  //? A stored key WINS over the env key — the per-workspace key is the one a user just typed, and an
  //? env key silently overriding it was a real bug once (Q5).
  const rawKey = stored.get(`__provider_key_${id}`);
  const plainKey = (rawKey === undefined ? '' : decryptSecret(rawKey)) ?? '';
  const model = (stored.get(cfgKey('model', id)) ?? '').trim();
  const baseUrl = (stored.get(cfgKey('baseurl', id)) ?? '').trim();
  const tempRaw = (stored.get(cfgKey('temp', id)) ?? '').trim();
  const tempNum = Number(tempRaw);

  //? Legacy: the three Gemini columns predate this store. Read, never written — a workspace configured
  //? before this file existed keeps working, and stops being special the moment it is saved again.
  let legacy = { model: '', baseUrl: '', temp: '' };
  if (id === 'gemini-api') {
    const [, ws] = await tryCatch(() => prisma.workspace.findUnique({ where: { id: workspaceId }, select: { geminiModel: true, geminiTemperature: true, geminiBaseUrl: true } }));
    legacy = { model: (ws?.geminiModel ?? '').trim(), baseUrl: (ws?.geminiBaseUrl ?? '').trim(), temp: (ws?.geminiTemperature ?? '').trim() };
  }

  const legacyTempNum = Number(legacy.temp);
  return {
    apiKey: plainKey.trim().length > 0 ? plainKey.trim() : defaults.apiKey,
    model: model || legacy.model || defaults.model,
    baseUrl: baseUrl || legacy.baseUrl || defaults.baseUrl,
    temperature: tempRaw.length > 0 && Number.isFinite(tempNum)
      ? Math.min(2, Math.max(0, tempNum))
      : (legacy.temp.length > 0 && Number.isFinite(legacyTempNum) ? Math.min(2, Math.max(0, legacyTempNum)) : null),
  };
}

/** The EnvVar keys one provider's settings occupy — used by the writer and by the snapshot. */
export const providerConfigKeys = (id: AiProviderId): { key: string; model: string; baseUrl: string; temp: string } => ({
  key: `__provider_key_${id}`,
  model: cfgKey('model', id),
  baseUrl: cfgKey('baseurl', id),
  temp: cfgKey('temp', id),
});
