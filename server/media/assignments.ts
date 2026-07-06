//? Media feature → provider assignment (F0.3, ADR 0052) — mirrors server/ai/assignments.ts.
//? The single place deciding which media backend runs each feature; the `overrides` seam is the
//? per-workspace picker (a DB setting surfaced in the settings UI, F4.2). Kept pure.

import type { MediaFeature, MediaProviderId } from './types';

//? Defaults: the Fal gateway for image/video/3d/avatar (one key, many models), ElevenLabs for
//? voice/sfx/music. Avatar (HeyGen) + music (Suno) get dedicated providers later; they route to
//? the gateway/voice adapter for now (overridable per workspace once those adapters land).
const DEFAULT_MEDIA_ASSIGNMENTS: Record<MediaFeature, MediaProviderId> = {
  'image-gen': 'fal',
  'reference-image': 'fal',
  'video-gen': 'fal',
  'model-3d': 'fal',
  'avatar': 'fal',
  'tts': 'elevenlabs',
  'sfx': 'elevenlabs',
  'music': 'elevenlabs',
};

//? Resolve the provider for a media feature. `overrides` = the per-workspace map (unset → default).
export function resolveMediaAssignment(feature: MediaFeature, overrides?: Partial<Record<MediaFeature, MediaProviderId>>): MediaProviderId {
  return overrides?.[feature] ?? DEFAULT_MEDIA_ASSIGNMENTS[feature];
}

//? The full default media map (for the settings UI).
export function defaultMediaAssignments(): Record<MediaFeature, MediaProviderId> {
  return { ...DEFAULT_MEDIA_ASSIGNMENTS };
}
