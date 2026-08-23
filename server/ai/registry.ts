//? The AI-provider registry + dispatch (project rule: ai-provider-abstraction). Feature
//? code calls `runAiCompletion(feature, req)` and NEVER names a provider — the registry
//? resolves the assigned provider, checks it is available, and invokes its handler. Add a
//? backend = one entry in PROVIDERS + a union member; add a feature = one key in
//? ./assignments. This is the ONLY module features import to reach an AI.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getPrismaClient, sleep, tryCatch, tryCatchSync } from '@luckystack/core';

import { aiRouteCandidates, defaultAssignments } from './assignments';
import { applyPointForFeature, skillPromptBlock } from './skills';
import { loadWorkspaceAiOverrides } from './workspaceAssignments';
import { recordAiRun } from './activity';
import { recordTurnSpend } from '../spend/record';
import { claudeCliProvider } from './providers/claudeCli';
import { codexCliProvider } from './providers/piCli';
import { AI_PROVIDER_CATALOG, AI_PROVIDER_LIST, providerModalities, type AiModality } from './providers/catalog';
import { listConnections } from './connections';
import { openAiCompatibleProvider } from './providers/openaiCompatible';
import { anthropicApiProvider } from './providers/anthropicApi';
import type { AiCompletionRequest, AiCompletionResult, AiFeature, AiProvider, AiProviderId } from './types';
import { runQueued } from './jobQueue';
import { applyAiPromptBudget } from './promptBudget';

//? Q4 + K4 — the workspace-wide AI steering prepended to EVERY feature's system prompt at this single
//? choke-point: the "how the AI should work here" instruction (Workspace.aiInstruction) + a strong output-
//? LANGUAGE directive (Workspace.outputLanguage). Best-effort: any read failure ⇒ no prefix.
//? EXPORTED because this choke-point only covers the one-shot completion path: the PTY stage-runner
//? renders its own prompt and therefore has to call this itself (ADR 0311). The field is documented —
//? in the op catalog and in the settings UI — as applying to EVERY AI run, so the coding agent silently
//? skipping it was a defect. One definition, both paths.
export async function workspaceAiPrefix(workspaceId?: string): Promise<string> {
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

/** One backend by id, for the settings page's credential probe. `undefined` for an unknown id. */
export function aiProviderById(id: string): AiProvider | undefined {
  return PROVIDERS[id];
}

//? Built FROM the catalog rather than hand-listed: a metered host that speaks `/chat/completions` is
//? one catalog entry and nothing else, which is what makes "more providers" a data change instead of
//? a project. The two bespoke transports — the Claude Code subscription CLI and Anthropic's messages
//? API — are named explicitly, because each is a real implementation.
const PROVIDERS: Record<string, AiProvider> = Object.fromEntries(AI_PROVIDER_LIST.map((meta) => {
  if (meta.transport === 'claude-cli') return [meta.id, claudeCliProvider];
  if (meta.transport === 'pi-cli') return [meta.id, codexCliProvider];
  if (meta.transport === 'anthropic') return [meta.id, anthropicApiProvider];
  return [meta.id, openAiCompatibleProvider(meta)];
}));

//? P4-1 — walk the candidate chain and return the first backend that exists AND is available for this
//? workspace (with the model the winning route carries, if any). Sequential on purpose: probing every
//? backend up-front would cost a Claude-CLI spawn + N key reads per turn when the first candidate is fine.
//? A candidate that cannot take the request's INPUT (images → vision, audio → audio) is skipped even when
//? it is available: a text-only backend "answering" a transcription request returned prose about a missing
//? clip, which the caller then stored as the transcript.
async function resolveAvailableRoute(candidates: { providerId: AiProviderId; model?: string }[], required: AiModality[], workspaceId?: string): Promise<{ provider: AiProvider; model?: string } | null> {
  for (const candidate of candidates) {
    const provider = PROVIDERS[candidate.providerId];
    const meta = AI_PROVIDER_CATALOG[candidate.providerId];
    if (!provider || !meta) continue;
    const supported = providerModalities(meta);
    if (!required.every((m) => supported.includes(m))) continue;
    if (await provider.available(workspaceId)) return { provider, ...(candidate.model === undefined ? {} : { model: candidate.model }) };
  }
  return null;
}

function requiredModalities(req: AiCompletionRequest): AiModality[] {
  const out: AiModality[] = ['text'];
  if ((req.imageUrls?.length ?? 0) > 0) out.push('vision');
  if ((req.audioUrls?.length ?? 0) > 0) out.push('audio');
  return out;
}

//? The fall-through rung of the chain ("any other backend") is limited to backends this WORKSPACE has
//? connected on the AI page — not to whatever happens to be installed on the host. Host availability
//? alone would silently route a workspace's unconfigured feature at the operator's Claude seat.
async function connectedCatalogIds(workspaceId?: string): Promise<AiProviderId[]> {
  if (!workspaceId) return [];
  const connections = await listConnections(workspaceId);
  const connected = new Set(connections.map((c) => c.providerId));
  return AI_PROVIDER_LIST.map((m) => m.id).filter((id) => connected.has(id));
}

//? Run one AI completion for a feature. `overrides` is the explicit CALL-SITE assignment (wins over
//? every stored choice); omitted → the workspace's stored routing, then global defaults. Returns a typed
//? result (never throws) so callers surface `error` codes uniformly.
export async function runAiCompletion(
  feature: AiFeature,
  req: AiCompletionRequest,
  overrides?: Partial<Record<AiFeature, AiProviderId>>,
): Promise<AiCompletionResult> {
  //? P1 — the per-workspace provider override FEEDS the seam; an explicit call-site override still wins.
  //? P4-1 — the chain no longer stops at the first choice: call-site → per-feature → workspace default →
  //? feature default → any other catalog backend, and the first AVAILABLE one runs. An id with no
  //? implementation (configuration that outlived its backend) is skipped like an unavailable one, so one
  //? stale override cannot crash the workspace — only when NOTHING can serve the feature does it fail.
  const wsOverrides = await loadWorkspaceAiOverrides(req.workspaceId);
  const callSite = overrides?.[feature];
  const featureOverride = wsOverrides.features[feature];
  const candidates = aiRouteCandidates({
    feature,
    ...(callSite === undefined ? {} : { callSite: { providerId: callSite } }),
    ...(featureOverride === undefined ? {} : { featureOverride }),
    ...(wsOverrides.defaultRoute === undefined ? {} : { workspaceDefault: wsOverrides.defaultRoute }),
    catalogIds: await connectedCatalogIds(req.workspaceId),
  });
  const startedAt = Date.now();
  const route = await resolveAvailableRoute(candidates, requiredModalities(req), req.workspaceId);
  if (route === null) {
    const providerId = candidates[0]?.providerId ?? '';
    recordAiRun({ ...(req.workspaceId ? { workspaceId: req.workspaceId } : {}), feature, ...(req.label ? { label: req.label } : {}), prompt: req.prompt, output: '', providerId, status: 'error', error: 'ai.providerUnavailable', startedAt });
    return { ok: false, text: '', providerId, error: 'ai.providerUnavailable' };
  }
  const { provider, model } = route;
  const providerId = provider.id;
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
    run: () => provider.complete(groundedReq, model === undefined ? undefined : { model }),
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
  recordAiRun({ ...(req.workspaceId ? { workspaceId: req.workspaceId } : {}), feature, ...(req.label ? { label: req.label } : {}), prompt: req.prompt, output: result.text, providerId: result.providerId, ...(result.model ? { model: result.model } : {}), status: result.ok ? 'ok' : 'error', ...(result.error ? { error: result.error } : {}), startedAt });
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
