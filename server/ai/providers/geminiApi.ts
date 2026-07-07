//? `gemini-api` provider — a HEADLESS AI backend (Google Generative Language API). A
//? different billing driver than the Claude PTY: it bills the API key, so unlike
//? `claude-cli` it MAY run headless. `available()` gates on the key being present; with
//? no key the provider is simply unavailable (dispatch surfaces that, never crashes).

import { getPrismaClient, tryCatch } from '@luckystack/core';
import { decryptSecret } from '../../crypto/secretBox';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from '../types';

const ENV_KEY = process.env.GEMINI_API_KEY ?? '';
const ENV_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

interface GeminiConfig { apiKey: string; model: string; temperature: number | null }

//? Q5 + P2 — resolve the Gemini config per workspace in ONE read: the encrypted key
//? (`__provider_key_gemini`) WINS over the env key (Q5 — the dead-key fix), and the per-workspace model +
//? temperature overrides (`Workspace.geminiModel`/`geminiTemperature`, P2) win over the env/defaults. Claude
//? has no such concept (PTY-billed) — this is Gemini-only. Best-effort — any read failure ⇒ env defaults.
async function resolveGeminiConfig(workspaceId?: string): Promise<GeminiConfig> {
  if (!workspaceId) return { apiKey: ENV_KEY, model: ENV_MODEL, temperature: null };
  const prisma = getPrismaClient();
  const [, keyRow] = await tryCatch(() => prisma.envVar.findFirst({ where: { workspaceId, key: '__provider_key_gemini' }, select: { value: true } }));
  const plainKey = keyRow ? decryptSecret(keyRow.value) : null;
  const apiKey = plainKey !== null && plainKey.trim().length > 0 ? plainKey.trim() : ENV_KEY;
  const [, ws] = await tryCatch(() => prisma.workspace.findUnique({ where: { id: workspaceId }, select: { geminiModel: true, geminiTemperature: true } }));
  const model = (ws?.geminiModel ?? '').trim() || ENV_MODEL;
  const tempRaw = (ws?.geminiTemperature ?? '').trim();
  const tempNum = Number(tempRaw);
  const temperature = tempRaw.length > 0 && Number.isFinite(tempNum) ? Math.min(2, Math.max(0, tempNum)) : null;
  return { apiKey, model, temperature };
}
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
  available: async (workspaceId?: string) => { const cfg = await resolveGeminiConfig(workspaceId); return cfg.apiKey.length > 0; },
  complete: async (req: AiCompletionRequest): Promise<AiCompletionResult> => {
    const { apiKey, model, temperature } = await resolveGeminiConfig(req.workspaceId);
    if (apiKey.length === 0) return { ok: false, text: '', providerId: 'gemini-api', error: 'ai.providerUnavailable' };
    const payload = {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      ...(temperature === null ? {} : { generationConfig: { temperature } }),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, req.timeoutMs ?? 60_000);
    const [error, text] = await tryCatch(async () => {
      const res = await fetch(`${ENDPOINT(model)}?key=${apiKey}`, {
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
