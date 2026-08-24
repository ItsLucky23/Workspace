//? Per-workspace media config (FIX-A) — the in-app Settings key-form (`save-media-provider`, ADR 0086)
//? stores each provider key encrypted as `EnvVar __provider_key_<providerId>` and each per-feature
//? provider choice as `EnvVar __media_provider_<feature>`. The media registry reads them here so an
//? in-app key/override actually drives generation (previously only `process.env` keys worked). Decryption
//? uses the same `secretBox` fail-closed path as the rest of the app; a bad/missing blob → no key (stub).

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';
import { decryptSecret } from '../crypto/secretBox';
import type { MediaFeature, MediaProviderId } from './types';

export interface WorkspaceMediaConfig {
  overrides: Partial<Record<MediaFeature, MediaProviderId>>;   //? per-feature provider choice
  keys: Partial<Record<MediaProviderId, string>>;              //? decrypted per-provider api key
  models: Partial<Record<MediaFeature, string>>;              //? P3 — per-feature model id override (low-poly/fast vs quality)
  cheap: boolean;                                             //? workspace-wide cheap-preview default (WS_MEDIA_CHEAP fallback)
  sceneContinuity: boolean;                                  //? workspace-wide scene-continuity default (WS_SCENE_CONTINUITY fallback)
  voiceId?: string;                                          //? default ElevenLabs voice id (ELEVENLABS_VOICE_ID fallback)
}

const OVERRIDE_PREFIX = '__media_provider_';
const KEY_PREFIX = '__provider_key_';
const MODEL_PREFIX = '__media_model_';
//? Workspace-wide media generation defaults (single-value keys, not per-feature). Plaintext (not secrets);
//? each overrides its host-env fallback per workspace.
const CHEAP_KEY = '__media_cheap';
const SCENE_CONTINUITY_KEY = '__media_scene_continuity';
const VOICE_ID_KEY = '__media_voice_id';
const PROVIDER_IDS: MediaProviderId[] = ['fal', 'elevenlabs', 'suno'];

function isProviderId(v: string): v is MediaProviderId {
  return (PROVIDER_IDS as string[]).includes(v);
}

//? Load a workspace's stored media overrides + decrypted provider keys in one query. Never throws —
//? a decrypt failure just omits that key (the registry then stubs or falls back to the env key).
export async function loadWorkspaceMediaConfig(prisma: PrismaClient, workspaceId: string): Promise<WorkspaceMediaConfig> {
  const rows = await prisma.envVar.findMany({
    where: { workspaceId, OR: [{ key: { startsWith: OVERRIDE_PREFIX } }, { key: { startsWith: KEY_PREFIX } }, { key: { startsWith: MODEL_PREFIX } }, { key: { in: [CHEAP_KEY, SCENE_CONTINUITY_KEY, VOICE_ID_KEY] } }] },
    select: { key: true, value: true },
  });
  const overrides: Partial<Record<MediaFeature, MediaProviderId>> = {};
  const keys: Partial<Record<MediaProviderId, string>> = {};
  const models: Partial<Record<MediaFeature, string>> = {};
  let cheap = false;
  let sceneContinuity = false;
  let voiceId: string | undefined;
  for (const row of rows) {
    if (row.key === CHEAP_KEY) { cheap = row.value === '1'; continue; }
    if (row.key === SCENE_CONTINUITY_KEY) { sceneContinuity = row.value === 'on'; continue; }
    if (row.key === VOICE_ID_KEY) { if (row.value.trim().length > 0) voiceId = row.value.trim(); continue; }
    if (row.key.startsWith(MODEL_PREFIX)) {
      const feature = row.key.slice(MODEL_PREFIX.length);
      if (row.value.trim().length > 0) models[feature as MediaFeature] = row.value.trim();
      continue;
    }
    if (row.key.startsWith(OVERRIDE_PREFIX)) {
      const feature = row.key.slice(OVERRIDE_PREFIX.length);
      if (isProviderId(row.value)) overrides[feature as MediaFeature] = row.value;
      continue;
    }
    const providerId = row.key.slice(KEY_PREFIX.length);
    if (!isProviderId(providerId)) continue;
    const plain = decryptSecret(row.value);
    if (plain !== null && plain.trim().length > 0) keys[providerId] = plain.trim();
  }
  //? Fase 5.2 — the AiConnection table is now THE key store for every backend (text, media, embedding);
  //? the `__provider_key_*` EnvVars above remain only as a legacy fallback (boot migrates them, but a
  //? partially-migrated workspace must not lose generation mid-flight). A keyed connection wins.
  const keysFromConnections = new Set<MediaProviderId>();
  const [, connectionRows] = await tryCatch(() => prisma.aiConnection.findMany({ where: { workspaceId, providerId: { in: PROVIDER_IDS } }, select: { providerId: true, apiKey: true }, orderBy: { createdAt: 'asc' } }));
  for (const row of connectionRows ?? []) {
    if (!isProviderId(row.providerId) || row.apiKey === null || keysFromConnections.has(row.providerId)) continue;
    const plain = decryptSecret(row.apiKey);
    if (plain !== null && plain.trim().length > 0) { keys[row.providerId] = plain.trim(); keysFromConnections.add(row.providerId); }
  }
  return { overrides, keys, models, cheap, sceneContinuity, ...(voiceId ? { voiceId } : {}) };
}
