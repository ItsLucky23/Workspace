//? Workspaces — the "is this actually set up?" readiness signals the UI reads to explain WHY a feature is
//? blocked and HOW to fix it (link a repo / add a key / connect an account), instead of a silent empty state
//? or a placeholder result. Two cost classes:
//?   - HOST-level probes (docker daemon, Claude CLI) are cached with a short TTL — `dockerAvailable()` shells
//?     out to `docker info`, so it must NOT run on every snapshot build; the Claude probe is already process-
//?     cached, but caching the whole block keeps the snapshot hot-path free of both.
//?   - Config-presence checks (stored provider keys, VAPID / encryption-key env) are trivial booleans.
//? The values themselves never leave the server — readiness reports only presence, never a key.

import { dockerAvailable } from '../container/runtime';
import { claudeCliAvailable } from '../ai/providers/claudeCli';
import type { WorkspaceReadiness } from '../../src/workspaces/_data/types';

//? Host-global readiness (identical for every workspace on this instance) — the part worth caching.
interface HostReadiness { docker: boolean; claudeCli: boolean; push: boolean; secretManager: boolean }

const HOST_TTL_MS = 30_000;
let hostCache: { at: number; value: HostReadiness } | null = null;

//? Probe the host at most once per TTL. `now` is injected so the caller controls the clock (and tests can
//? pin it). A missing VAPID/enc key is a plain env-presence check; docker is the only real (cached) probe.
export async function hostReadiness(now: number): Promise<HostReadiness> {
  if (hostCache && now - hostCache.at < HOST_TTL_MS) return hostCache.value;
  const docker = await dockerAvailable();
  const value: HostReadiness = {
    docker,
    claudeCli: claudeCliAvailable(),
    push: (process.env.WORKSPACES_VAPID_PUBLIC ?? '').trim().length > 0 && (process.env.WORKSPACES_VAPID_PRIVATE ?? '').trim().length > 0,
    secretManager: (process.env.WORKSPACES_ENC_KEY ?? '').trim().length > 0,
  };
  hostCache = { at: now, value };
  return value;
}

//? The active workspace's config signals the host probes get combined with. `providerKeys` = the set of the
//? workspace's stored `__provider_key_<id>` EnvVar KEYS (presence only — never decrypted here); the env-var
//? fallbacks (GEMINI_API_KEY, FAL_KEY, …) that the registries also honour count as configured too.
export interface WorkspaceReadinessInput {
  repoLinked: boolean;
  publishingConnected: boolean;
  providerKeys: Set<string>;
}

//? Fold the cached host readiness + the workspace config signals into the client-facing block. Mirrors what
//? each registry treats as "available": a text provider = Claude CLI on the host OR a Gemini key; a media
//? provider = its own stored key OR its env fallback.
export async function buildReadiness(now: number, input: WorkspaceReadinessInput): Promise<WorkspaceReadiness> {
  const host = await hostReadiness(now);
  const has = (id: string, ...envVars: string[]): boolean =>
    input.providerKeys.has(`__provider_key_${id}`) || envVars.some((v) => (process.env[v] ?? '').trim().length > 0);
  return {
    repoLinked: input.repoLinked,
    aiText: host.claudeCli || has('gemini', 'GEMINI_API_KEY'),
    media: {
      fal: has('fal', 'FAL_KEY'),
      elevenlabs: has('elevenlabs', 'ELEVENLABS_KEY'),
      suno: has('suno', 'SUNO_KEY'),
    },
    publishing: input.publishingConnected,
    docker: host.docker,
    push: host.push,
    secretManager: host.secretManager,
  };
}
