//? The AI-provider registry + dispatch (project rule: ai-provider-abstraction). Feature
//? code calls `runAiCompletion(feature, req)` and NEVER names a provider — the registry
//? resolves the assigned provider, checks it is available, and invokes its handler. Add a
//? backend = one entry in PROVIDERS + a union member; add a feature = one key in
//? ./assignments. This is the ONLY module features import to reach an AI.

import { resolveAssignment, defaultAssignments } from './assignments';
import { claudeCliProvider } from './providers/claudeCli';
import { geminiApiProvider } from './providers/geminiApi';
import type { AiCompletionRequest, AiCompletionResult, AiFeature, AiProvider, AiProviderId } from './types';

const PROVIDERS: Record<AiProviderId, AiProvider> = {
  'claude-cli': claudeCliProvider,
  'gemini-api': geminiApiProvider,
};

//? Run one AI completion for a feature. `overrides` carries the per-workspace/user
//? assignment once the picker UI exists; omitted → global defaults. Returns a typed
//? result (never throws) so callers surface `error` codes uniformly.
export async function runAiCompletion(
  feature: AiFeature,
  req: AiCompletionRequest,
  overrides?: Partial<Record<AiFeature, AiProviderId>>,
): Promise<AiCompletionResult> {
  const providerId = resolveAssignment(feature, overrides);
  const provider = PROVIDERS[providerId];
  const available = await provider.available();
  if (!available) return { ok: false, text: '', providerId, error: 'ai.providerUnavailable' };
  return provider.complete(req);
}

//? Which providers are usable right now (for a settings UI / health panel).
export async function availableProviders(): Promise<{ id: AiProviderId; label: string; available: boolean }[]> {
  return Promise.all(
    Object.values(PROVIDERS).map(async (p) => ({ id: p.id, label: p.label, available: await p.available() })),
  );
}

//? The current feature→provider wiring (defaults; merge overrides at the call site).
export function currentAssignments(): Record<AiFeature, AiProviderId> {
  return defaultAssignments();
}
