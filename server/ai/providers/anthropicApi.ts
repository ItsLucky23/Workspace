//? Anthropic's own messages API — the metered counterpart to the Claude Code subscription.
//?
//? It gets its own transport because its shape genuinely differs from `/chat/completions`: the system
//? prompt is a TOP-LEVEL field rather than a message, `max_tokens` is REQUIRED, the key travels in
//? `x-api-key` rather than `Authorization`, and a version header is mandatory. Routing it through the
//? OpenAI-compatible transport would have looked like it worked and 400'd on the first turn — which is
//? the class of "provider that does not actually work" this page exists to prevent.
//? @adr 0007

import { tryCatch } from '@luckystack/core';

import { resolveProviderConfig } from '../providerConfig';
import { ANTHROPIC_META, providerBaseUrl } from './catalog';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from '../types';

const META = ANTHROPIC_META;

//? Pinned rather than "latest": this API is versioned by date, and a floating version is a backend
//? that changes shape under you without a deploy.
const API_VERSION = '2023-06-01';

//? Required by the API — there is no "unset". High enough not to truncate a real answer, and the
//? caller's own budget still governs what it asks for.
const MAX_TOKENS = 4096;

export const messagesUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '')}/messages`;

interface AnthropicBlock { type?: string; text?: string }
interface AnthropicUsage { input_tokens?: number; output_tokens?: number }
interface AnthropicResponse { content?: AnthropicBlock[]; usage?: AnthropicUsage; model?: string }

/** One turn's body. `system` is top-level here, NOT a message — the difference that needs its own transport. */
export function anthropicBody(req: Pick<AiCompletionRequest, 'prompt' | 'system'>, model: string, maxTokens = MAX_TOKENS): Record<string, unknown> {
  return {
    model,
    max_tokens: maxTokens,
    ...(req.system ? { system: req.system } : {}),
    messages: [{ role: 'user', content: req.prompt }],
  };
}

/** Concatenate the text blocks; a response may carry several, and non-text blocks are skipped. */
export function anthropicText(body: unknown): string {
  const blocks = (body as AnthropicResponse | null)?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks.map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('').trim();
}

const envKey = (): string => (process.env.WS_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '').trim();

async function call(apiKey: string, body: Record<string, unknown>, timeoutMs: number): Promise<[Error | null, unknown]> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  const result = await tryCatch(async () => {
    const res = await fetch(messagesUrl(providerBaseUrl(META)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!res.ok) throw new Error(`anthropic ${String(res.status)}`);
    return await res.json() as unknown;
  });
  clearTimeout(timer);
  return [result[0], result[1]];
}

export const anthropicApiProvider: AiProvider = {
  id: 'anthropic-api',
  label: META.label,
  available: async (workspaceId?: string) => {
    const cfg = await resolveProviderConfig('anthropic-api', workspaceId, { apiKey: envKey(), model: META.defaultModel, baseUrl: providerBaseUrl(META) });
    return cfg.apiKey.length > 0;
  },
  //? One token: proves the key, the model name and the version header together.
  ping: async (cfg) => {
    const [error] = await call(cfg.apiKey, anthropicBody({ prompt: 'ping' }, cfg.model, 1), 15_000);
    return error ? { ok: false, error: error.message } : { ok: true };
  },
  complete: async (req: AiCompletionRequest, opts?: { model?: string }): Promise<AiCompletionResult> => {
    const cfg = await resolveProviderConfig('anthropic-api', req.workspaceId, { apiKey: envKey(), model: META.defaultModel, baseUrl: providerBaseUrl(META) });
    const { apiKey } = cfg;
    //? P4-2 — a per-feature model pin (`providerId:model` route) beats the connection's picked model.
    const model = opts?.model !== undefined && opts.model.length > 0 ? opts.model : cfg.model;
    if (apiKey.length === 0) return { ok: false, text: '', providerId: 'anthropic-api', error: 'ai.providerUnavailable' };
    const [error, body] = await call(apiKey, anthropicBody(req, model), req.timeoutMs ?? 60_000);
    if (error) return { ok: false, text: '', providerId: 'anthropic-api', error: error.message };
    const usage = (body as AnthropicResponse | null)?.usage;
    return {
      ok: true, text: anthropicText(body), providerId: 'anthropic-api', model: (body as AnthropicResponse | null)?.model ?? model,
      ...(typeof usage?.input_tokens === 'number' ? { tokensIn: usage.input_tokens } : {}),
      ...(typeof usage?.output_tokens === 'number' ? { tokensOut: usage.output_tokens } : {}),
    };
  },
};
