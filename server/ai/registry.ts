//? The AI-provider registry + dispatch (project rule: ai-provider-abstraction). Feature
//? code calls `runAiCompletion(feature, req)` and NEVER names a provider — the registry
//? resolves the assigned provider, checks it is available, and invokes its handler. Add a
//? backend = one entry in PROVIDERS + a union member; add a feature = one key in
//? ./assignments. This is the ONLY module features import to reach an AI.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { resolveAssignment, defaultAssignments } from './assignments';
import { recordAiRun } from './activity';
import { claudeCliProvider } from './providers/claudeCli';
import { geminiApiProvider } from './providers/geminiApi';
import type { AiCompletionRequest, AiCompletionResult, AiFeature, AiProvider, AiProviderId } from './types';

//? Q4 + K4 — the workspace-wide AI steering prepended to EVERY feature's system prompt at this single
//? choke-point: the "how the AI should work here" instruction (Workspace.aiInstruction) + a strong output-
//? LANGUAGE directive (Workspace.outputLanguage). Best-effort: any read failure ⇒ no prefix.
async function workspaceAiPrefix(workspaceId?: string): Promise<string> {
  if (!workspaceId) return '';
  const [err, ws] = await tryCatch(() => getPrismaClient().workspace.findUnique({ where: { id: workspaceId }, select: { aiInstruction: true, outputLanguage: true } }));
  if (err || !ws) return '';
  const parts: string[] = [];
  const lang = ws.outputLanguage.trim();
  if (lang.length > 0) parts.push(`Write all output in ${lang}.`);
  const instruction = ws.aiInstruction.trim();
  if (instruction.length > 0) parts.push(instruction);
  return parts.join('\n\n');
}

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
  const startedAt = Date.now();
  const available = await provider.available(req.workspaceId);
  if (!available) {
    recordAiRun({ ...(req.workspaceId ? { workspaceId: req.workspaceId } : {}), feature, ...(req.label ? { label: req.label } : {}), prompt: req.prompt, output: '', providerId, status: 'error', error: 'ai.providerUnavailable', startedAt });
    return { ok: false, text: '', providerId, error: 'ai.providerUnavailable' };
  }
  //? Q4 + K4 — prepend the workspace AI steer (instruction + output language) to the system prompt (one
  //? point → every feature is steered).
  const prefix = await workspaceAiPrefix(req.workspaceId);
  const groundedReq = prefix ? { ...req, system: [prefix, req.system ?? ''].map((s) => s.trim()).filter((s) => s.length > 0).join('\n\n') } : req;
  const result = await provider.complete(groundedReq);
  //? Feed the central AI-activity view (the "Activity" tab of the Workspace-AI panel).
  recordAiRun({ ...(req.workspaceId ? { workspaceId: req.workspaceId } : {}), feature, ...(req.label ? { label: req.label } : {}), prompt: req.prompt, output: result.text, providerId: result.providerId, status: result.ok ? 'ok' : 'error', ...(result.error ? { error: result.error } : {}), startedAt });
  return result;
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
