//? Per-workspace configuration for a TEXT backend, generic over providers.
//?
//? Gemini's settings lived in three dedicated `Workspace` columns (`geminiModel`, `geminiTemperature`,
//? `geminiBaseUrl`) and its key in an EnvVar. That works for exactly one provider and is why the
//? AI-behaviour page was Gemini-shaped: there was nowhere to put a second backend's model. The media
//? side already solved this generically — `__media_model_<feature>` — so this uses the same shape:
//?
//? Settings now live on an `AiConnection` row (see ./connections.ts) rather than in EnvVars or in
//? Gemini's three bespoke `Workspace` columns: the owner wanted a LIST of connected AIs, which a
//? per-provider record cannot express. This module is the read side — "what should provider X run
//? with right now" — and is the only thing the providers themselves call.
//? @adr 0007

import { connectionFor } from './connections';
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

/** Read the config a backend should run with: its CONNECTION first, then env defaults.
 *
 *  The endpoint is deliberately NOT part of what a user can set — it comes from the provider catalog,
 *  with an operator env override for a proxy or a self-hosted gateway. It is infrastructure. */
export async function resolveProviderConfig(
  id: AiProviderId,
  workspaceId: string | undefined,
  envFallback: { apiKey: string; model: string; baseUrl: string },
): Promise<ResolvedProviderConfig> {
  const meta = AI_PROVIDER_CATALOG[id];
  const defaults: ResolvedProviderConfig = {
    apiKey: envFallback.apiKey,
    model: envFallback.model || meta.defaultModel,
    //? Env first here, not last: only an operator sets this, and when they do it is because the
    //? default host is unreachable from their network.
    baseUrl: envFallback.baseUrl || meta.defaultBaseUrl,
    temperature: null,
  };
  if (workspaceId === undefined) return defaults;

  const connection = await connectionFor(workspaceId, id);
  return {
    //? A connection's key WINS over the env key — it is the one a user just entered, and an env key
    //? silently overriding it was a real bug once (Q5).
    apiKey: (connection?.apiKey ?? '').length > 0 ? (connection?.apiKey ?? '') : defaults.apiKey,
    model: (connection?.model ?? '').length > 0 ? (connection?.model ?? '') : defaults.model,
    baseUrl: defaults.baseUrl,
    temperature: null,
  };
}

/** The EnvVar keys one provider's settings occupy — used by the writer and by the snapshot. */
export const providerConfigKeys = (id: AiProviderId): { key: string; model: string; baseUrl: string; temp: string } => ({
  key: `__provider_key_${id}`,
  model: cfgKey('model', id),
  baseUrl: cfgKey('baseurl', id),
  temp: cfgKey('temp', id),
});
