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
  generate: (prompt: string, params: Record<string, unknown>) => Promise<{ url: string }>;
}

const SUNO_BASE = (process.env.SUNO_BASE ?? '').trim() || 'https://api.suno.ai/v1';
const POLL_MAX = Number(process.env.SUNO_POLL_MAX ?? '') || 60;
const POLL_MS = Number(process.env.SUNO_POLL_MS ?? '') || 3000;

//? The live Suno transport: submit a generation, poll the clip until it has an audio_url.
export const realMusicTransport: MusicTransport = {
  generate: async (prompt, params) => {
    const key = (process.env.SUNO_KEY ?? '').trim();
    const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const submitted = await withRetry(async () => {
      //? External Suno REST API — not a framework `/api/*` route.
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(`${SUNO_BASE}/generate`, { method: 'POST', headers, body: JSON.stringify({ prompt, ...params }) });
      if (!r.ok) throw new Error(`suno submit ${String(r.status)}`);
      return (await r.json()) as { id?: string };
    }, { attempts: 3, baseMs: 500 });
    const id = submitted.id;
    if (id === undefined) throw new Error('suno submit: missing clip id');
    for (let i = 0; i < POLL_MAX; i += 1) {
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(`${SUNO_BASE}/clips/${id}`, { headers });
      if (!r.ok) throw new Error(`suno status ${String(r.status)}`);
      const clip = (await r.json()) as { status?: string; audio_url?: string };
      if (typeof clip.audio_url === 'string' && clip.audio_url.length > 0) return { url: clip.audio_url };
      if (clip.status === 'error' || clip.status === 'failed') throw new Error('suno generation failed');
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
    available: () => Promise.resolve(Boolean((process.env.SUNO_KEY ?? '').trim())),
    generate: async (req: MediaGenerationRequest): Promise<MediaGenerationResult> => {
      if (req.feature !== 'music') return { ok: false, providerId: 'suno', costCents: 0, stub: false, error: 'media.featureUnsupported' };
      const prompt = composeMediaPrompt(req) || (req.prompt ?? '');
      const [err, out] = await tryCatch(() => transport.generate(prompt, req.params ?? {}));
      if (err || !out) return { ok: false, providerId: 'suno', costCents: 0, stub: false, error: `media.sunoFailed: ${err?.message ?? 'unknown'}` };
      const asset: MediaAsset = { kind: 'music', url: out.url, metadata: { feature: 'music', provider: 'suno' } };
      return { ok: true, asset, providerId: 'suno', costCents: LIVE_COST_CENTS, stub: false };
    },
  };
}

export const sunoProvider: MediaProvider = createSunoProvider();
