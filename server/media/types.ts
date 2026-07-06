//? The MEDIA provider layer (F0.3, ADR 0052) — the asset-producing sibling of the text
//? AI-provider abstraction (server/ai/*). Media features output an ASSET (url + metadata +
//? a metered € cost), not text, so they get their own request/result/provider shape while
//? mirroring the same pattern: features resolve to a provider via ./assignments, dispatch in
//? ./registry, standalone adapters in ./providers. NO feature hardcodes a backend. (The
//? text-shaped `reference-video-analysis` stays an `AiFeature` on gemini-api — it returns a
//? blueprint, not an asset.)

//? An asset-producing media feature. Adding one = a key here + a default in ./assignments.
export type MediaFeature =
  | 'image-gen'
  | 'reference-image'   //? reference-conditioned photorealistic image-gen (the #1-priority feature)
  | 'video-gen'
  | 'tts'
  | 'music'
  | 'sfx'
  | 'avatar'
  | 'model-3d';

//? A concrete media backend. `fal` = the image/video/3d gateway; `elevenlabs` = voice/sfx/music.
//? (Assembly/render is Remotion — a distinct path in F1.5, not a gen provider. Avatar/music get
//? dedicated providers — HeyGen/Suno — later; they default to the gateway/voice adapter for now.)
export type MediaProviderId = 'fal' | 'elevenlabs';

//? The resolved style a generation composes with (from the StylePreset registry, ADR 0049).
export interface MediaStyle {
  key: string;
  systemPrompt: string;
  params?: Record<string, unknown>;
}

export interface MediaGenerationRequest {
  feature: MediaFeature;
  prompt?: string;
  referenceUrl?: string;          //? for reference-image (+ future reference-conditioned features)
  style?: MediaStyle;             //? the resolved StylePreset
  extraInstructions?: string;     //? the user's free-form per-generation instruction
  params?: Record<string, unknown>;
  workspaceId?: string;           //? display/activity tag (no tenancy enforced here)
  label?: string;
}

//? A produced asset. In stub mode `url` is a valid-shaped fake (`stub://…`).
export interface MediaAsset {
  kind: string;                   //? 'image' | 'video' | 'voice' | 'music' | 'sfx' | 'avatar' | 'model-3d'
  url: string;
  metadata: Record<string, unknown>;
}

export interface MediaGenerationResult {
  ok: boolean;
  asset?: MediaAsset;
  providerId: MediaProviderId;
  costCents: number;              //? metered € cost the caller records (recordMediaSpend)
  stub: boolean;                  //? true when produced by stub/dummy mode (no API key)
  error?: string;                 //? errorCode when ok=false
}

//? A standalone media backend. `available` gates LIVE dispatch (a key is present); when false
//? the registry falls back to a valid-shaped STUB so the pipeline runs on dummy data (no keys).
export interface MediaProvider {
  id: MediaProviderId;
  label: string;
  supports: MediaFeature[];
  available: () => Promise<boolean>;
  generate: (req: MediaGenerationRequest) => Promise<MediaGenerationResult>;
}
