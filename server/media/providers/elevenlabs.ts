//? ElevenLabs media adapter (F0.3 ADR 0052; M2 depth-program — REAL gen). Voice (tts) + sound-effects
//? (sfx). `available()` is false until `ELEVENLABS_KEY` is present, so the registry keeps falling back
//? to a valid-shaped STUB with no key. When a key IS present the LIVE `generate` calls the ElevenLabs
//? REST API, which returns raw audio BYTES — the real transport persists them via the media store and
//? returns a served URL. The transport is injectable so the request/asset logic is fixture-tested
//? (no key, no network). Music is a separate provider (Suno, ./suno).

import { randomUUID } from 'node:crypto';

import { sleep, tryCatch } from '@luckystack/core';

import { withRetry } from '../../util/retry';
import { composeMediaPrompt } from '../prompt';
import { persistMediaBytes } from '../store';
import type { MediaFeature, MediaGenerationRequest, MediaGenerationResult, MediaProvider, MediaAsset } from '../types';

const SUPPORTED: MediaFeature[] = ['tts', 'sfx'];
const ASSET_KIND: Partial<Record<MediaFeature, string>> = { tts: 'voice', sfx: 'sfx' };
const LIVE_COST_CENTS: Partial<Record<MediaFeature, number>> = { tts: 2, sfx: 1 };

//? The composed input for an ElevenLabs generation. Pure + exported for tests.
export interface ElevenInput { text: string; voiceId: string; durationSeconds?: number }

export function composeElevenInput(req: MediaGenerationRequest): ElevenInput {
  const text = composeMediaPrompt(req) || (req.prompt ?? '');
  //? Default to the real ElevenLabs "Rachel" VOICE ID (a name like 'Rachel' 404s — the API wants the id).
  const voiceId = (typeof req.params?.voiceId === 'string' ? req.params.voiceId : '') || (process.env.ELEVENLABS_VOICE_ID ?? '').trim() || '21m00Tcm4TlvDq8ikWAM';
  const durationSeconds = typeof req.params?.durationSeconds === 'number' ? req.params.durationSeconds : undefined;
  return { text, voiceId, ...(durationSeconds === undefined ? {} : { durationSeconds }) };
}

//? The audio transport — produce a served URL for a tts/sfx generation. Injectable so `generate` is
//? testable with a fixture (no key/network). The real one hits ElevenLabs → bytes → media store.
export interface AudioTransport {
  generate: (feature: MediaFeature, input: ElevenInput, apiKey: string, workspaceId?: string) => Promise<{ url: string }>;
}

const ELEVEN_BASE = (process.env.ELEVENLABS_BASE ?? '').trim() || 'https://api.elevenlabs.io/v1';

//? The live ElevenLabs transport: tts → /text-to-speech/<voice>, sfx → /sound-generation. Both return
//? raw mp3 bytes → persisted to the media store → a served `/media/...` url.
export const realAudioTransport: AudioTransport = {
  generate: async (feature, input, apiKey, workspaceId) => {
    const headers = { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' };
    const url = feature === 'tts'
      ? `${ELEVEN_BASE}/text-to-speech/${encodeURIComponent(input.voiceId)}`
      : `${ELEVEN_BASE}/sound-generation`;
    const body = feature === 'tts'
      ? { text: input.text, model_id: (process.env.ELEVENLABS_MODEL ?? '').trim() || 'eleven_multilingual_v2' }
      : { text: input.text, ...(input.durationSeconds === undefined ? {} : { duration_seconds: input.durationSeconds }) };
    const bytes = await withRetry(async () => {
      //? External ElevenLabs REST API — not a framework `/api/*` route.
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`elevenlabs ${String(r.status)}`);
      return Buffer.from(await r.arrayBuffer());
    }, { attempts: 3, baseMs: 500 });
    await sleep(0); // yield — keeps the persist off the fetch microtask for large blobs
    return persistMediaBytes(bytes, 'mp3', randomUUID(), workspaceId);
  },
};

//? Build the ElevenLabs provider around an audio transport (injected in tests).
export function createElevenlabsProvider(transport: AudioTransport = realAudioTransport): MediaProvider {
  return {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    supports: SUPPORTED,
    available: (apiKey?: string) => Promise.resolve(Boolean((apiKey ?? process.env.ELEVENLABS_KEY ?? '').trim())),
    //? Fase 5.2 — credential probe: `/user` is the cheapest authenticated read this API offers.
    ping: async (apiKey?: string) => {
      const key = (apiKey ?? process.env.ELEVENLABS_KEY ?? '').trim();
      if (key.length === 0) return { ok: false, error: 'media.noKey' };
      const [err, res] = await tryCatch(() =>
        // eslint-disable-next-line luckystack/no-raw-fetch-in-src
        fetch(`${ELEVEN_BASE}/user`, { headers: { 'xi-api-key': key } }));
      if (err || !res) return { ok: false, error: 'media.pingFailed' };
      return res.ok ? { ok: true } : { ok: false, error: 'media.badKey' };
    },
    generate: async (req: MediaGenerationRequest): Promise<MediaGenerationResult> => {
      if (!SUPPORTED.includes(req.feature)) return { ok: false, providerId: 'elevenlabs', costCents: 0, stub: false, error: 'media.featureUnsupported' };
      const input = composeElevenInput(req);
      const key = (req.apiKey ?? process.env.ELEVENLABS_KEY ?? '').trim();
      const [err, out] = await tryCatch(() => transport.generate(req.feature, input, key, req.workspaceId));
      if (err || !out) return { ok: false, providerId: 'elevenlabs', costCents: 0, stub: false, error: `media.elevenlabsFailed: ${err?.message ?? 'unknown'}` };
      const asset: MediaAsset = { kind: ASSET_KIND[req.feature] ?? 'voice', url: out.url, metadata: { feature: req.feature, provider: 'elevenlabs', voiceId: input.voiceId } };
      return { ok: true, asset, providerId: 'elevenlabs', costCents: LIVE_COST_CENTS[req.feature] ?? 2, stub: false };
    },
  };
}

export const elevenlabsProvider: MediaProvider = createElevenlabsProvider();
