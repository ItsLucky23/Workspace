//? Suno music adapter (M2 depth-program) — the dedicated `music` provider (ADR 0052 foresaw it). Suno
//? generates a song from a text prompt and returns a HOSTED audio URL (async: submit → poll → url), so
//? unlike ElevenLabs no local persistence is needed. `available()` is false until `SUNO_KEY` is present
//? (registry stub-fallback with no key). The transport is injectable so the request/asset logic is
//? fixture-tested (no key/network); the real transport does the submit+poll over the Suno REST API.

import { sleep, tryCatch } from '@luckystack/core';

import { withRetry } from '../../util/retry';
import { composeMediaPrompt } from '../prompt';
import type { MediaFeature, MediaGenerationRequest, MediaGenerationResult, MediaProvider, MediaAsset } from '../types';

const SUPPORTED: MediaFeature[] = ['music'];
const LIVE_COST_CENTS = Number(process.env.SUNO_COST_CENTS ?? '') || 6;

//? The music transport — produce a hosted audio URL for a prompt. Injectable for tests.
export interface MusicTransport {
  generate: (prompt: string, params: Record<string, unknown>, apiKey: string) => Promise<{ url: string }>;
}

//? Suno API (api.sunoapi.org): submit → taskId → poll record-info until SUCCESS + an audio_url. Base +
//? model + the (required-by-the-API) callback URL are env-overridable. We POLL (record-info), so the
//? callback is never received — it only satisfies the API; any URL is fine.
const SUNO_BASE = (process.env.SUNO_BASE ?? '').trim() || 'https://api.sunoapi.org/api/v1';
const SUNO_MODEL = (process.env.SUNO_MODEL ?? '').trim() || 'V5';                         // V5 = faster generation
const SUNO_CALLBACK = (process.env.SUNO_CALLBACK_URL ?? '').trim() || 'https://example.com/suno-callback';
const POLL_MAX = Number(process.env.SUNO_POLL_MAX ?? '') || 80;
const POLL_MS = Number(process.env.SUNO_POLL_MS ?? '') || 3000;

interface SunoGenResp { code?: number; msg?: string; data?: { taskId?: string } }
//? A generated track. The full downloadable mp3 lands in `audioUrl` at status SUCCESS; `streamAudioUrl`
//? appears earlier (TEXT_SUCCESS) as a playable stream — the fallback if the final url lags.
interface SunoTrack { audioUrl?: string; streamAudioUrl?: string }
interface SunoStatusResp { code?: number; data?: { status?: string; response?: { sunoData?: SunoTrack[] } } }

//? The live Suno transport: POST /generate → taskId, then poll /generate/record-info until an audio_url.
export const realMusicTransport: MusicTransport = {
  generate: async (prompt, params, apiKey) => {
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const taskId = await withRetry(async () => {
      //? External Suno REST API — not a framework `/api/*` route.
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(`${SUNO_BASE}/generate`, { method: 'POST', headers, body: JSON.stringify({ prompt, customMode: false, instrumental: false, model: SUNO_MODEL, callBackUrl: SUNO_CALLBACK, ...params }) });
      if (!r.ok) throw new Error(`suno submit ${String(r.status)}`);
      const json = (await r.json()) as SunoGenResp;
      if (json.code !== 200 || !json.data?.taskId) throw new Error(`suno submit code ${String(json.code ?? 0)}: ${json.msg ?? ''}`);
      return json.data.taskId;
    }, { attempts: 3, baseMs: 500 });
    for (let i = 0; i < POLL_MAX; i += 1) {
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(`${SUNO_BASE}/generate/record-info?taskId=${encodeURIComponent(taskId)}`, { headers });
      if (r.ok) {
        const json = (await r.json()) as SunoStatusResp;
        const track = json.data?.response?.sunoData?.[0];
        const url = (track?.audioUrl ?? '').length > 0 ? (track?.audioUrl ?? '') : (track?.streamAudioUrl ?? '');
        if (url.length > 0) return { url };
        if (json.data?.status === 'FAILED') throw new Error('suno generation failed');
      }
      await sleep(POLL_MS);
    }
    throw new Error('suno poll timeout');
  },
};

//? Build the Suno provider around a music transport (injected in tests).
export function createSunoProvider(transport: MusicTransport = realMusicTransport): MediaProvider {
  return {
    id: 'suno',
    label: 'Suno',
    supports: SUPPORTED,
    available: (apiKey?: string) => Promise.resolve(Boolean((apiKey ?? process.env.SUNO_KEY ?? '').trim())),
    generate: async (req: MediaGenerationRequest): Promise<MediaGenerationResult> => {
      if (req.feature !== 'music') return { ok: false, providerId: 'suno', costCents: 0, stub: false, error: 'media.featureUnsupported' };
      const prompt = composeMediaPrompt(req) || (req.prompt ?? '');
      const key = (req.apiKey ?? process.env.SUNO_KEY ?? '').trim();
      const [err, out] = await tryCatch(() => transport.generate(prompt, req.params ?? {}, key));
      if (err || !out) return { ok: false, providerId: 'suno', costCents: 0, stub: false, error: `media.sunoFailed: ${err?.message ?? 'unknown'}` };
      const asset: MediaAsset = { kind: 'music', url: out.url, metadata: { feature: 'music', provider: 'suno' } };
      return { ok: true, asset, providerId: 'suno', costCents: LIVE_COST_CENTS, stub: false };
    },
  };
}

export const sunoProvider: MediaProvider = createSunoProvider();
