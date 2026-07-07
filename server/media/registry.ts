//? The media-provider registry + dispatch (F0.3, ADR 0052) — the asset sibling of server/ai/registry.ts.
//? Callers use `runMediaGeneration(req)` and NEVER name a provider. When the resolved provider has no key
//? (`available()` false), the registry returns a valid-SHAPED STUB asset + a declared € cost so the whole
//? content pipeline runs end-to-end on dummy data (no keys). The caller records the cost (recordMediaSpend).

import { getPrismaClient } from '@luckystack/core';

import { resolveMediaAssignment, defaultMediaAssignments } from './assignments';
import { falProvider } from './providers/fal';
import { elevenlabsProvider } from './providers/elevenlabs';
import { sunoProvider } from './providers/suno';
import { loadWorkspaceMediaConfig } from './workspaceKeys';
import type { MediaFeature, MediaGenerationRequest, MediaGenerationResult, MediaProvider, MediaProviderId } from './types';

const MEDIA_PROVIDERS: Record<MediaProviderId, MediaProvider> = {
  fal: falProvider,
  elevenlabs: elevenlabsProvider,
  suno: sunoProvider,
};

//? The asset kind produced by each feature (drives ContentAsset.kind + the stub shape).
const FEATURE_KIND: Record<MediaFeature, string> = {
  'image-gen': 'image',
  'reference-image': 'image',
  'video-gen': 'video',
  'tts': 'voice',
  'music': 'music',
  'sfx': 'sfx',
  'avatar': 'avatar',
  'model-3d': 'model-3d',
};

//? Declared STUB cost per feature (cents) — realistic-order magnitudes so the €-budget guard is
//? exercised on dummy data (video » image » voice). Replaced by the live provider's real cost when keyed.
const STUB_COST_CENTS: Record<MediaFeature, number> = {
  'image-gen': 4,
  'reference-image': 5,
  'video-gen': 40,
  'tts': 2,
  'music': 6,
  'sfx': 1,
  'avatar': 30,
  'model-3d': 20,
};

//? Build a valid-shaped stub result for a feature (dummy-data mode).
function stubMediaResult(feature: MediaFeature, providerId: MediaProviderId, req: MediaGenerationRequest): MediaGenerationResult {
  const kind = FEATURE_KIND[feature];
  return {
    ok: true,
    stub: true,
    providerId,
    costCents: STUB_COST_CENTS[feature],
    asset: {
      kind,
      url: `stub://${kind}/${feature}/${req.style?.key ?? 'default'}`,
      metadata: { stub: true, feature, style: req.style?.key ?? null, hasReference: Boolean(req.referenceUrl), extra: req.extraInstructions ?? null },
    },
  };
}

//? The expected € cost (cents) of a generation BEFORE running it — so the caller can budget-check first
//? (F0.2). Today = the deterministic stub cost; a live provider estimate replaces it when keyed.
export function estimateMediaCostCents(feature: MediaFeature): number {
  return STUB_COST_CENTS[feature];
}

//? The per-feature € estimate table (cents), surfaced in the snapshot so the UI can show "≈ €X" on the
//? generation confirm BEFORE the user spends (Q1 — cost transparency). One source of truth = STUB_COST_CENTS.
export function mediaCostTable(): { feature: MediaFeature; cents: number }[] {
  return (Object.keys(STUB_COST_CENTS) as MediaFeature[]).map((feature) => ({ feature, cents: STUB_COST_CENTS[feature] }));
}

//? Run one media generation for a feature. Never throws; returns a typed result. No key → a valid-shaped
//? STUB (so the pipeline runs on dummy data). When `req.workspaceId` is set, the per-workspace Settings
//? config (ADR 0086) is consumed (FIX-A): its `__media_provider_<feature>` override picks the provider and
//? its decrypted `__provider_key_<providerId>` key drives dispatch — falling back to the env key. An
//? explicit `overrides` arg (rare) still wins over the stored per-workspace override.
export async function runMediaGeneration(req: MediaGenerationRequest, overrides?: Partial<Record<MediaFeature, MediaProviderId>>): Promise<MediaGenerationResult> {
  const cfg = req.workspaceId ? await loadWorkspaceMediaConfig(getPrismaClient(), req.workspaceId) : null;
  const providerId = resolveMediaAssignment(req.feature, { ...cfg?.overrides, ...overrides });
  const apiKey = req.apiKey ?? cfg?.keys[providerId];
  const provider = MEDIA_PROVIDERS[providerId];
  if (!provider.supports.includes(req.feature)) {
    return { ok: false, providerId, costCents: 0, stub: false, error: 'media.featureUnsupported' };
  }
  const available = await provider.available(apiKey);
  if (!available) return stubMediaResult(req.feature, providerId, req);
  return provider.generate({ ...req, ...(apiKey ? { apiKey } : {}) });
}

//? Which media providers are usable right now (for the settings/health UI).
export async function availableMediaProviders(): Promise<{ id: MediaProviderId; label: string; available: boolean }[]> {
  return Promise.all(Object.values(MEDIA_PROVIDERS).map(async (p) => ({ id: p.id, label: p.label, available: await p.available() })));
}

//? The current media feature→provider wiring (defaults; merge overrides at the call site).
export function currentMediaAssignments(): Record<MediaFeature, MediaProviderId> {
  return defaultMediaAssignments();
}
