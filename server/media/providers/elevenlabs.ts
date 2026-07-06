//? ElevenLabs media adapter (F0.3, ADR 0052) — voice/sfx/music. `available()` is false until an
//? `ELEVENLABS_KEY` is present, so the registry falls back to a valid-shaped STUB (dummy-data testing).
//? Live `generate` is a keyed follow-up (gated off by `available()` today). Music is a placeholder here
//? until a dedicated provider (Suno) lands.

import type { MediaFeature, MediaGenerationResult, MediaProvider } from '../types';

const SUPPORTED: MediaFeature[] = ['tts', 'sfx', 'music'];

export const elevenlabsProvider: MediaProvider = {
  id: 'elevenlabs',
  label: 'ElevenLabs',
  supports: SUPPORTED,
  available: () => Promise.resolve(Boolean(process.env.ELEVENLABS_KEY)),
  //? Live gen is a keyed follow-up; gated off by `available()` today (never reached in stub mode).
  generate: (): Promise<MediaGenerationResult> =>
    Promise.resolve({ ok: false, providerId: 'elevenlabs', costCents: 0, stub: false, error: 'media.notImplemented' }),
};
