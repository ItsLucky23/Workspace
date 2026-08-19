//? The OpenAI-COMPATIBLE text backend — the third entry in the registry, and the one that makes the
//? provider abstraction worth having.
//?
//? The product shipped with exactly two text backends: the subscription Claude CLI on the host, and
//? Gemini. The owner asked for more, and "more" here does not mean "OpenAI" specifically: the
//? /chat/completions shape is what Azure OpenAI, OpenRouter, Groq, Together, vLLM and a local
//? Ollama/llama.cpp all speak. Pointing the endpoint somewhere else is the whole configuration — and
//? that endpoint is an OPERATOR setting (`WS_OPENAI_BASE_URL`), never a field in the UI: which host
//? answers is infrastructure, and putting it in front of a user turns a working default into a box
//? they can break.
//?
//? Deliberately text-only. Gemini carries images and audio inline for the multimodal features; adding
//? that here would mean claiming a capability per model that this file cannot verify, and a silently
//? dropped attachment is worse than a backend that never offered to take one.
//? @adr 0007

import { tryCatch } from '@luckystack/core';

import { resolveProviderConfig } from '../providerConfig';
import { AI_PROVIDER_CATALOG } from './catalog';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from '../types';

const META = AI_PROVIDER_CATALOG['openai-api'];

const envConfig = (): { apiKey: string; model: string; baseUrl: string } => ({
  apiKey: (process.env.WS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? '').trim(),
  model: (process.env.WS_OPENAI_MODEL ?? '').trim(),
  baseUrl: (process.env.WS_OPENAI_BASE_URL ?? '').trim(),
});

/** `<base>/chat/completions`, trimming a trailing slash. Pure + exported so it can be pinned by a test. */
export const openAiEndpoint = (baseUrl: string): string => `${(baseUrl.trim() || META.defaultBaseUrl).replace(/\/+$/, '')}/chat/completions`;

interface OpenAiChoice { message?: { content?: string } }
interface OpenAiUsage { prompt_tokens?: number; completion_tokens?: number }
interface OpenAiResponse { choices?: OpenAiChoice[]; usage?: OpenAiUsage; model?: string }

/** The request body for one turn. Pure + exported: the shape is the contract with every compatible host. */
export function openAiBody(req: Pick<AiCompletionRequest, 'prompt' | 'system'>, model: string, temperature: number | null): Record<string, unknown> {
  return {
    model,
    messages: [
      //? `system` first when present — the same role the other backends give it, so a feature's prompt
      //? behaves the same whichever backend answers it.
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      { role: 'user', content: req.prompt },
    ],
    ...(temperature === null ? {} : { temperature }),
  };
}

export const openAiProvider: AiProvider = {
  id: 'openai-api',
  label: META.label,
  //? The cheapest turn this API offers: one token out. It proves the key, the model name AND the
  //? endpoint in one call — a key check that only validated the key would still let someone save a
  //? model the host does not have.
  ping: async (cfg) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 15_000);
    const [error] = await tryCatch(async () => {
      const res = await fetch(openAiEndpoint(envConfig().baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_completion_tokens: 1 }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`openai ${String(res.status)}`);
      return true;
    });
    clearTimeout(timer);
    return error ? { ok: false, error: error.message } : { ok: true };
  },
  available: async (workspaceId?: string) => {
    const cfg = await resolveProviderConfig('openai-api', workspaceId, envConfig());
    return cfg.apiKey.length > 0;
  },
  complete: async (req: AiCompletionRequest): Promise<AiCompletionResult> => {
    const { apiKey, model, baseUrl, temperature } = await resolveProviderConfig('openai-api', req.workspaceId, envConfig());
    if (apiKey.length === 0) return { ok: false, text: '', providerId: 'openai-api', error: 'ai.providerUnavailable' };

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, req.timeoutMs ?? 60_000);
    const [error, body] = await tryCatch(async () => {
      const res = await fetch(openAiEndpoint(baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(openAiBody(req, model, temperature)),
        signal: controller.signal,
      });
      //? The status alone is not a diagnosis — a 401 and a 404 on a wrong base URL look identical to a
      //? user otherwise, so the code travels in the error and reaches the activity feed.
      if (!res.ok) throw new Error(`openai ${String(res.status)}`);
      return await res.json() as unknown;
    });
    clearTimeout(timer);
    if (error) return { ok: false, text: '', providerId: 'openai-api', error: error.message };

    const parsed = body as OpenAiResponse | null;
    const text = (parsed?.choices?.[0]?.message?.content ?? '').trim();
    const usage = parsed?.usage;
    //? A metered provider reports its RESOLVED model (the host may substitute) and real token counts,
    //? so per-AI cost is measured rather than estimated from characters.
    return {
      ok: true, text, providerId: 'openai-api', model: parsed?.model ?? model,
      ...(typeof usage?.prompt_tokens === 'number' ? { tokensIn: usage.prompt_tokens } : {}),
      ...(typeof usage?.completion_tokens === 'number' ? { tokensOut: usage.completion_tokens } : {}),
    };
  },
};
