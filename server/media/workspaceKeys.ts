//? Per-workspace media config (FIX-A) — the in-app Settings key-form (`save-media-provider`, ADR 0086)
//? stores each provider key encrypted as `EnvVar __provider_key_<providerId>` and each per-feature
//? provider choice as `EnvVar __media_provider_<feature>`. The media registry reads them here so an
//? in-app key/override actually drives generation (previously only `process.env` keys worked). Decryption
//? uses the same `secretBox` fail-closed path as the rest of the app; a bad/missing blob → no key (stub).

import type { PrismaClient } from '@prisma/client';
import { decryptSecret } from '../crypto/secretBox';
import type { MediaFeature, MediaProviderId } from './types';

export interface WorkspaceMediaConfig {
  overrides: Partial<Record<MediaFeature, MediaProviderId>>;   //? per-feature provider choice
  keys: Partial<Record<MediaProviderId, string>>;              //? decrypted per-provider api key
}

const OVERRIDE_PREFIX = '__media_provider_';
const KEY_PREFIX = '__provider_key_';
const PROVIDER_IDS: MediaProviderId[] = ['fal', 'elevenlabs', 'suno'];

function isProviderId(v: string): v is MediaProviderId {
  return (PROVIDER_IDS as string[]).includes(v);
}

//? Load a workspace's stored media overrides + decrypted provider keys in one query. Never throws —
//? a decrypt failure just omits that key (the registry then stubs or falls back to the env key).
export async function loadWorkspaceMediaConfig(prisma: PrismaClient, workspaceId: string): Promise<WorkspaceMediaConfig> {
  const rows = await prisma.envVar.findMany({
    where: { workspaceId, OR: [{ key: { startsWith: OVERRIDE_PREFIX } }, { key: { startsWith: KEY_PREFIX } }] },
    select: { key: true, value: true },
  });
  const overrides: Partial<Record<MediaFeature, MediaProviderId>> = {};
  const keys: Partial<Record<MediaProviderId, string>> = {};
  for (const row of rows) {
    if (row.key.startsWith(OVERRIDE_PREFIX)) {
      const feature = row.key.slice(OVERRIDE_PREFIX.length);
      if (isProviderId(row.value)) overrides[feature as MediaFeature] = row.value;
    } else {
      const providerId = row.key.slice(KEY_PREFIX.length);
      if (!isProviderId(providerId)) continue;
      const plain = decryptSecret(row.value);
      if (plain !== null && plain.trim().length > 0) keys[providerId] = plain.trim();
    }
  }
  return { overrides, keys };
}
