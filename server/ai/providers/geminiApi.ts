//? `gemini-api` provider — a HEADLESS AI backend (Google Generative Language API). A
//? different billing driver than the Claude PTY: it bills the API key, so unlike
//? `claude-cli` it MAY run headless. `available()` gates on the key being present; with
//? no key the provider is simply unavailable (dispatch surfaces that, never crashes).

import { tryCatch } from '@luckystack/core';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from '../types';

const API_KEY = process.env.GEMINI_API_KEY ?? '';
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const ENDPOINT = (model: string): string => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

interface GeminiPart { text?: string }
interface GeminiResponse { candidates?: { content?: { parts?: GeminiPart[] } }[] }

function firstText(body: unknown): string {
  const parts = (body as GeminiResponse | null)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('').trim();
}

export const geminiApiProvider: AiProvider = {
  id: 'gemini-api',
  label: 'Gemini API',
  available: () => Promise.resolve(API_KEY.length > 0),
  complete: async (req: AiCompletionRequest): Promise<AiCompletionResult> => {
    if (API_KEY.length === 0) return { ok: false, text: '', providerId: 'gemini-api', error: 'ai.providerUnavailable' };
    const payload = {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, req.timeoutMs ?? 60_000);
    const [error, text] = await tryCatch(async () => {
      const res = await fetch(`${ENDPOINT(MODEL)}?key=${API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!res.ok) throw new Error(`gemini ${String(res.status)}`);
      return firstText(await res.json());
    });
    clearTimeout(timer);
    if (error) return { ok: false, text: '', providerId: 'gemini-api', error: error.message };
    return { ok: true, text: text ?? '', providerId: 'gemini-api' };
  },
};
