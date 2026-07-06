//? Fal.ai media adapter (F0.3, ADR 0052) — the image/video/3d/avatar gateway. `available()` is false
//? until a `FAL_KEY` is present, so the registry falls back to a valid-shaped STUB (dummy-data testing,
//? no keys). The live `generate` path lands when a key is added (a keyed follow-up) — until then it is
//? never reached (gated by `available`), and returns a typed not-implemented result defensively.

import type { MediaFeature, MediaGenerationResult, MediaProvider } from '../types';

const SUPPORTED: MediaFeature[] = ['image-gen', 'reference-image', 'video-gen', 'model-3d', 'avatar'];

export const falProvider: MediaProvider = {
  id: 'fal',
  label: 'Fal.ai',
  supports: SUPPORTED,
  available: () => Promise.resolve(Boolean(process.env.FAL_KEY)),
  //? Live gen is a keyed follow-up; gated off by `available()` today (never reached in stub mode).
  generate: (): Promise<MediaGenerationResult> =>
    Promise.resolve({ ok: false, providerId: 'fal', costCents: 0, stub: false, error: 'media.notImplemented' }),
};
