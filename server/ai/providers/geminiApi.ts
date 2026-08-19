//? `gemini-api` provider — a HEADLESS AI backend (Google Generative Language API). A
//? different billing driver than the Claude PTY: it bills the API key, so unlike
//? `claude-cli` it MAY run headless. `available()` gates on the key being present; with
//? no key the provider is simply unavailable (dispatch surfaces that, never crashes).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { tryCatch } from '@luckystack/core';
import { MEDIA_DIR } from '../../media/store';
import { resolveProviderConfig } from '../providerConfig';
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from '../types';

//? F5 — resolve an image URL to a base64 `inline_data` part for a multimodal turn. Local `/media/<file>`
//? URLs are read straight off the media store on disk; http(s) URLs are fetched. Returns null on any failure
//? (the turn then just proceeds text-only). Bounded to ~8MB so a huge asset can't blow the request.
const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
//? VO (DOCUMENTS_AND_SKILLS) — audio mime types for speech-to-text (Gemini reads audio inline_data).
const AUDIO_MIME_BY_EXT: Record<string, string> = { '.mp3': 'audio/mp3', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac' };
async function mediaPart(url: string, mimeMap: Record<string, string>, fallbackMime: string, maxBytes = 20_000_000): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  const [err, part] = await tryCatch(async () => {
    let bytes: Buffer | null = null;
    const ext = path.extname(new URL(url, 'http://x').pathname).toLowerCase();
    if (url.startsWith('/media/')) {
      const file = path.join(MEDIA_DIR, url.slice('/media/'.length));
      if (!existsSync(file)) return null;
      bytes = readFileSync(file);
    } else if (/^https?:\/\//.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      bytes = Buffer.from(await res.arrayBuffer());
    } else {
      return null;
    }
    if (bytes.length === 0 || bytes.length > maxBytes) return null;
    return { inline_data: { mime_type: mimeMap[ext] ?? fallbackMime, data: bytes.toString('base64') } };
  });
  return err ? null : (part ?? null);
}
async function audioPart(url: string): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  return mediaPart(url, AUDIO_MIME_BY_EXT, 'audio/webm');
}
async function imagePart(url: string): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
  const [err, part] = await tryCatch(async () => {
    let bytes: Buffer | null = null;
    let ext = path.extname(new URL(url, 'http://x').pathname).toLowerCase();
    if (url.startsWith('/media/')) {
      const file = path.join(MEDIA_DIR, url.slice('/media/'.length));
      if (!existsSync(file)) return null;
      bytes = readFileSync(file);
    } else if (/^https?:\/\//.test(url)) {
      const res = await fetch(url);
      if (!res.ok) return null;
      bytes = Buffer.from(await res.arrayBuffer());
      if (!ext) ext = (MIME_BY_EXT[`.${(res.headers.get('content-type') ?? '').split('/')[1] ?? ''}`] ? `.${(res.headers.get('content-type') ?? '').split('/')[1]}` : '.png');
    } else {
      return null;
    }
    if (bytes.length === 0 || bytes.length > 8_000_000) return null;
    return { inline_data: { mime_type: MIME_BY_EXT[ext] ?? 'image/png', data: bytes.toString('base64') } };
  });
  return err ? null : (part ?? null);
}

//? Read env LAZILY (at call time), not at module load: `GEMINI_API_KEY` is a @luckystack/secret-manager
//? pointer that resolves into process.env only AFTER boot's secret resolution — capturing it at import time
//? would freeze the unresolved pointer (a subtle "key present but 401" / "unavailable" bug).
const envKey = (): string => process.env.GEMINI_API_KEY ?? '';
const envModel = (): string => process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
//? X4 — the default (Google) base; overridable by env or per-workspace for a custom/self-hosted endpoint
//? (an OpenAI-compatible Gemini proxy, a regional mirror, …). Trailing slash trimmed for a clean join.
const envBase = (): string => (process.env.WS_GEMINI_BASE_URL ?? '').trim() || 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiConfig { apiKey: string; model: string; temperature: number | null; baseUrl: string }

//? Q5 + P2 + X4 — resolve the Gemini config per workspace in ONE read: the encrypted key
//? (`__provider_key_gemini`) WINS over the env key (Q5 — the dead-key fix); the per-workspace model +
//? temperature (P2) + base URL (X4) win over the env/defaults. Claude has no such concept (PTY-billed) — this
//? is Gemini-only. Best-effort — any read failure ⇒ env defaults.
async function resolveGeminiConfig(workspaceId?: string): Promise<GeminiConfig> {
  //? Delegates to the generic per-provider store (ADR 0007) so Gemini stops being the one backend with
  //? bespoke columns. Its three legacy `Workspace` columns are still read there as a fallback, so a
  //? workspace configured before that existed keeps exactly what it had.
  const cfg = await resolveProviderConfig('gemini-api', workspaceId, { apiKey: envKey(), model: envModel(), baseUrl: envBase() });
  return { apiKey: cfg.apiKey, model: cfg.model, temperature: cfg.temperature, baseUrl: cfg.baseUrl };
}

//? Build the generateContent URL from a base (default or custom), trimming a trailing slash. Pure + exported.
export const geminiEndpoint = (baseUrl: string, model: string): string => `${baseUrl.replace(/\/+$/, '')}/models/${model}:generateContent`;

interface GeminiPart { text?: string }
interface GeminiUsage { promptTokenCount?: number; candidatesTokenCount?: number }
interface GeminiResponse { candidates?: { content?: { parts?: GeminiPart[] } }[]; usageMetadata?: GeminiUsage }

function firstText(body: unknown): string {
  const parts = (body as GeminiResponse | null)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('').trim();
}

export const geminiApiProvider: AiProvider = {
  id: 'gemini-api',
  label: 'Gemini API',
  //? A one-token generation: proves the key AND that this host knows this model name.
  ping: async (cfg) => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 15_000);
    const [error] = await tryCatch(async () => {
      const res = await fetch(`${geminiEndpoint(envBase(), cfg.model)}?key=${cfg.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`gemini ${String(res.status)}`);
      return true;
    });
    clearTimeout(timer);
    return error ? { ok: false, error: error.message } : { ok: true };
  },
  available: async (workspaceId?: string) => { const cfg = await resolveGeminiConfig(workspaceId); return cfg.apiKey.length > 0; },
  complete: async (req: AiCompletionRequest): Promise<AiCompletionResult> => {
    const { apiKey, model, temperature, baseUrl } = await resolveGeminiConfig(req.workspaceId);
    if (apiKey.length === 0) return { ok: false, text: '', providerId: 'gemini-api', error: 'ai.providerUnavailable' };
    //? F5 — multimodal: attach each image as an inline_data part (the model sees the actual pixels).
    //? Failed/oversized images are silently dropped so the turn still runs (text-only).
    const resolvedParts = await Promise.all((req.imageUrls ?? []).map((u) => imagePart(u)));
    const imageParts = resolvedParts.filter((p): p is { inline_data: { mime_type: string; data: string } } => p !== null);
    //? VO — audio parts for speech-to-text (Gemini transcribes audio inline_data; text-only providers ignore).
    const resolvedAudio = await Promise.all((req.audioUrls ?? []).map((u) => audioPart(u)));
    const audioParts = resolvedAudio.filter((p): p is { inline_data: { mime_type: string; data: string } } => p !== null);
    const parts: (GeminiPart | { inline_data: { mime_type: string; data: string } })[] = [{ text: req.prompt }, ...imageParts, ...audioParts];
    const payload = {
      contents: [{ role: 'user', parts }],
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      ...(temperature === null ? {} : { generationConfig: { temperature } }),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, req.timeoutMs ?? 60_000);
    const [error, body] = await tryCatch(async () => {
      const res = await fetch(`${geminiEndpoint(baseUrl, model)}?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!res.ok) throw new Error(`gemini ${String(res.status)}`);
      return await res.json() as unknown;
    });
    clearTimeout(timer);
    if (error) return { ok: false, text: '', providerId: 'gemini-api', error: error.message };
    //? Metered provider: report the resolved model + real usageMetadata token counts so per-AI cost is accurate.
    const usage = (body as GeminiResponse | null)?.usageMetadata;
    return {
      ok: true, text: firstText(body), providerId: 'gemini-api', model,
      ...(typeof usage?.promptTokenCount === 'number' ? { tokensIn: usage.promptTokenCount } : {}),
      ...(typeof usage?.candidatesTokenCount === 'number' ? { tokensOut: usage.candidatesTokenCount } : {}),
    };
  },
};
