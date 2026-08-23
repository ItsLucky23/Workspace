//? ONE transport, many backends — the reason "more providers" is a catalog entry rather than a project.
//?
//? `/chat/completions` is spoken by OpenAI, Google's OpenAI-compatible Gemini endpoint, OpenRouter,
//? Groq, DeepSeek, Mistral, Together, vLLM, LM Studio and a local Ollama. A provider built here is
//? therefore tested by every other provider built here: the failure modes (a trailing slash on the
//? base URL, a null temperature, a missing system message) are shared, and fixing one fixes all.
//?
//? The endpoint is resolved from the catalog with an operator env override and is never a user field.
//? Which host answers is infrastructure; putting it in front of a user turns a working default into a
//? box they can break, and the owner asked for it to be hidden.
//?
//? Deliberately text-only. Claiming multimodal per host without being able to verify it means a
//? silently dropped attachment, which is worse than a backend that never offered to take one.
//? @adr 0007

import { tryCatch } from '@luckystack/core';

import { resolveProviderConfig } from '../providerConfig';
import { providerBaseUrl, type AiProviderMeta } from './catalog';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from '../types';

/** `<base>/chat/completions`, trimming a trailing slash. Pure + exported so a test can pin it. */
export const chatCompletionsUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

interface ChatChoice { message?: { content?: string } }
interface ChatUsage { prompt_tokens?: number; completion_tokens?: number }
interface ChatResponse { choices?: ChatChoice[]; usage?: ChatUsage; model?: string }

/** The request body for one turn — the contract with every compatible host. Pure + exported. */
export function chatBody(req: Pick<AiCompletionRequest, 'prompt' | 'system'>, model: string, temperature: number | null): Record<string, unknown> {
  return {
    model,
    messages: [
      //? `system` first when present — the same role the other transports give it, so one feature's
      //? prompt behaves the same whichever backend answers it.
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      { role: 'user', content: req.prompt },
    ],
    //? Omitted, not null: several compatible hosts reject `temperature: null` outright.
    ...(temperature === null ? {} : { temperature }),
  };
}

const envKey = (meta: AiProviderMeta): string => {
  //? A host-wide fallback key, so an operator can run a backend for every workspace without anyone
  //? pasting one. Named after the provider id, uppercased: openai-api → WS_OPENAI_API_KEY.
  const varName = `WS_${meta.id.toUpperCase().replaceAll('-', '_')}_KEY`;
  return (process.env[varName] ?? '').trim();
};

/** Build the provider for one catalog entry. Adding a compatible host is exactly this call. */
export function openAiCompatibleProvider(meta: AiProviderMeta): AiProvider {
  const config = async (workspaceId?: string): Promise<{ apiKey: string; model: string; baseUrl: string }> => {
    const cfg = await resolveProviderConfig(meta.id, workspaceId, { apiKey: envKey(meta), model: meta.defaultModel, baseUrl: providerBaseUrl(meta) });
    return { apiKey: cfg.apiKey, model: cfg.model, baseUrl: providerBaseUrl(meta) };
  };

  const call = async (apiKey: string, model: string, body: Record<string, unknown>, timeoutMs: number): Promise<[Error | null, unknown]> => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
    const result = await tryCatch(async () => {
      const res = await fetch(chatCompletionsUrl(providerBaseUrl(meta)), {
        method: 'POST',
        //? A local server usually wants no auth at all; sending `Bearer` with an empty key makes some
        //? of them 401 rather than ignore it.
        headers: { 'Content-Type': 'application/json', ...(apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body), signal: controller.signal,
      });
      //? The status IS the diagnosis a user needs: a 401 (bad key) and a 404 (wrong model or host)
      //? are indistinguishable otherwise, so the code travels in the error and reaches the UI.
      if (!res.ok) throw new Error(`${meta.id} ${String(res.status)}`);
      return await res.json() as unknown;
    });
    clearTimeout(timer);
    return [result[0], result[1]];
  };

  return {
    id: meta.id,
    label: meta.label,
    available: async (workspaceId?: string) => {
      const cfg = await config(workspaceId);
      //? A local backend legitimately needs no key, so presence-of-key is the wrong test for it.
      return meta.keyUrl.length === 0 ? true : cfg.apiKey.length > 0;
    },
    //? One token out: proves the key, the model name and the endpoint in a single call. A check that
    //? only validated the key would still let someone connect a model the host does not have.
    ping: async (cfg) => {
      const [error] = await call(cfg.apiKey, cfg.model, { model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }, 15_000);
      return error ? { ok: false, error: error.message } : { ok: true };
    },
    complete: async (req: AiCompletionRequest, opts?: { model?: string }): Promise<AiCompletionResult> => {
      const cfg = await config(req.workspaceId);
      const { apiKey } = cfg;
      //? P4-2 — a per-feature model pin (`providerId:model` route) beats the connection's picked model.
      const model = opts?.model !== undefined && opts.model.length > 0 ? opts.model : cfg.model;
      if (apiKey.length === 0 && meta.keyUrl.length > 0) return { ok: false, text: '', providerId: meta.id, error: 'ai.providerUnavailable' };
      const [error, body] = await call(apiKey, model, chatBody(req, model, null), req.timeoutMs ?? 60_000);
      if (error) return { ok: false, text: '', providerId: meta.id, error: error.message };

      const parsed = body as ChatResponse | null;
      const usage = parsed?.usage;
      //? A metered backend reports its RESOLVED model (a gateway may substitute) and real token
      //? counts, so per-AI cost is measured rather than estimated from characters.
      return {
        ok: true, text: (parsed?.choices?.[0]?.message?.content ?? '').trim(), providerId: meta.id, model: parsed?.model ?? model,
        ...(typeof usage?.prompt_tokens === 'number' ? { tokensIn: usage.prompt_tokens } : {}),
        ...(typeof usage?.completion_tokens === 'number' ? { tokensOut: usage.completion_tokens } : {}),
      };
    },
  };
}
