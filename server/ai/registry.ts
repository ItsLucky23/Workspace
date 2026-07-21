//? The AI-provider registry + dispatch (project rule: ai-provider-abstraction). Feature
//? code calls `runAiCompletion(feature, req)` and NEVER names a provider — the registry
//? resolves the assigned provider, checks it is available, and invokes its handler. Add a
//? backend = one entry in PROVIDERS + a union member; add a feature = one key in
//? ./assignments. This is the ONLY module features import to reach an AI.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getPrismaClient, sleep, tryCatch, tryCatchSync } from '@luckystack/core';

import { resolveAssignment, defaultAssignments } from './assignments';
import { applyPointForFeature, skillPromptBlock } from './skills';
import { loadWorkspaceAiOverrides } from './workspaceAssignments';
import { recordAiRun } from './activity';
import { recordTurnSpend } from '../spend/record';
import { claudeCliProvider } from './providers/claudeCli';
import { geminiApiProvider } from './providers/geminiApi';
import type { AiCompletionRequest, AiCompletionResult, AiFeature, AiProvider, AiProviderId } from './types';
import { runQueued } from './jobQueue';
import { applyAiPromptBudget } from './promptBudget';

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

//? Q3 — a compact, GLOBAL product-capability index prepended to every feature's system prompt, so EVERY AI
//? feature (not just workspace-chat) knows what the product itself offers. Titles only (bounded ~15 lines,
//? not the full corpus — retrieval surfaces the detail in chat); loaded once from the compiled corpus + cached.
//? Best-effort: any read/parse failure ⇒ '' (no block).
let capIndexCache: string | null = null;
function productCapabilityIndex(): string {
  if (capIndexCache !== null) return capIndexCache;
  const [err, raw] = tryCatchSync(() => readFileSync(path.join(process.cwd(), 'docs', 'AI_PRODUCT_KNOWLEDGE.json'), 'utf8'));
  if (err || typeof raw !== 'string') { capIndexCache = ''; return capIndexCache; }
  const [perr, parsed] = tryCatchSync(() => JSON.parse(raw) as { chunks?: { kind?: string; title?: string }[] });
  const titles = (perr || !parsed?.chunks) ? [] : parsed.chunks.filter((c) => c.kind === 'capability' && typeof c.title === 'string').map((c) => `- ${String(c.title)}`);
  capIndexCache = titles.length > 0 ? `This product can do the following (ask the Workspace-AI for step-by-step help on any of these):\n${titles.join('\n')}` : '';
  return capIndexCache;
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
  //? P1 — the per-workspace provider override FEEDS the seam; an explicit call-site override still wins.
  const wsOverrides = await loadWorkspaceAiOverrides(req.workspaceId);
  const providerId = resolveAssignment(feature, { ...wsOverrides, ...overrides });
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
  //? Q3 — every feature also gets the compact product-capability index (global, cached), so the whole AI
  //? surface is product-aware, not just the chat.
  const capIdx = productCapabilityIndex();
  //? SK2 — the workspace's ENABLED skills whose apply-points match this feature's group, injected at the
  //? same single choke-point (best-effort: a failed read means no block, never a failed turn).
  const skillsBlock = await skillPromptBlock(req.workspaceId, applyPointForFeature(feature));
  const groundedReq = applyAiPromptBudget({
    request: req,
    workspaceInstruction: prefix,
    skills: skillsBlock,
    productCapabilities: capIdx,
  });
  //? Gap-fix: bounded retry with backoff around the SINGLE provider call-site (there was none anywhere
  //? in the AI layer — one transient blip failed the whole feature turn). Only failed results retry;
  //? 'ai.providerUnavailable' is permanent-for-now and never retried. WS_AI_RETRY_ATTEMPTS tunes (min 1).
  const attempts = Math.max(1, Number(process.env.WS_AI_RETRY_ATTEMPTS ?? '2'));
  //? GAP_SCAN D1 — every provider call goes through the shared queue: at most WS_AI_MAX_CONCURRENT run at
  //? once (N cron triggers no longer spawn N concurrent turns), and a provider that keeps failing trips its
  //? circuit so later callers fail FAST instead of paying the full timeout twice through the retry ladder.
  const complete = (): Promise<AiCompletionResult> => runQueued({
    key: providerId,
    run: () => provider.complete(groundedReq),
    isFailure: (r) => !r.ok,
    onCircuitOpen: () => ({ ok: false, text: '', providerId, error: 'ai.circuitOpen' }),
  });
  let result = await complete();
  //? A tripped circuit is not a transient blip — retrying it is exactly the waste the breaker exists to stop.
  for (let attempt = 1; attempt < attempts && !result.ok && result.error !== 'ai.providerUnavailable' && result.error !== 'ai.circuitOpen'; attempt++) {
    await sleep(500 * 2 ** (attempt - 1));
    result = await complete();
  }
  //? Feed the central AI-activity view (the "Activity" tab of the Workspace-AI panel).
  recordAiRun({ ...(req.workspaceId ? { workspaceId: req.workspaceId } : {}), feature, ...(req.label ? { label: req.label } : {}), prompt: req.prompt, output: result.text, providerId: result.providerId, status: result.ok ? 'ok' : 'error', ...(result.error ? { error: result.error } : {}), startedAt });
  //? Durable per-AI spend (the missing half): one-shot completions only touched the in-memory activity ring,
  //? so metered providers (Gemini) never accrued into SpendRecord/WorkspaceBudget. Record here, best-effort +
  //? only on success, with the provider's real usage when it reports it (else char-estimate). The PTY coding
  //? agent (pipeline-agent) is recorded by the stage-runner, not here. Never fails the turn.
  const wsId = req.workspaceId;
  if (wsId && result.ok) {
    await tryCatch(() => recordTurnSpend(getPrismaClient(), {
      workspaceId: wsId, sessionKey: `oneshot:${feature}`, model: result.model ?? result.providerId,
      providerId: result.providerId, feature, inputChars: (groundedReq.system?.length ?? 0) + groundedReq.prompt.length, outputChars: result.text.length,
      ...(typeof result.tokensIn === 'number' ? { tokensIn: result.tokensIn } : {}),
      ...(typeof result.tokensOut === 'number' ? { tokensOut: result.tokensOut } : {}),
    }));
  }
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
