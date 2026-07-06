//? Fal.ai media adapter (F0.3 ADR 0052; M1 depth-program — REAL gen). The image/video/3d/reference
//? gateway. `available()` is false until `FAL_KEY` is present, so the registry keeps falling back to a
//? valid-shaped STUB when no key is configured (dummy-data testing). When a key IS present the LIVE
//? `generate` runs a real fal.ai queue request (submit → poll → fetch result) and returns a real asset
//? URL + a metered € cost. The HTTP transport is injectable so the request/extract logic is unit-tested
//? with fixtures (no key, no network); the pure prompt/model/extract helpers are exported for that.

import { sleep, tryCatch } from '@luckystack/core';

import { withRetry } from '../../util/retry';
import type { MediaFeature, MediaGenerationRequest, MediaGenerationResult, MediaProvider, MediaAsset } from '../types';

const SUPPORTED: MediaFeature[] = ['image-gen', 'reference-image', 'video-gen', 'model-3d', 'avatar'];

const envStr = (name: string, fallback: string): string => (process.env[name] ?? '').trim() || fallback;
const envNum = (name: string, fallback: number): number => Number(process.env[name] ?? '') || fallback;
const firstOf = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const asUrl = (v: unknown): string | null => {
  if (v !== null && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') return (v as { url: string }).url;
  return typeof v === 'string' ? v : null;
};

//? The fal.ai model id per feature. Overridable per env so a workspace can pin a newer/cheaper model
//? without a code change; the defaults are current, widely-available fal endpoints.
function falModelFor(feature: MediaFeature): string {
  const env = envStr;
  const models: Record<MediaFeature, string> = {
    'image-gen': env('FAL_MODEL_IMAGE', 'fal-ai/flux/dev'),
    'reference-image': env('FAL_MODEL_REFERENCE_IMAGE', 'fal-ai/flux/dev/image-to-image'),
    'video-gen': env('FAL_MODEL_VIDEO', 'fal-ai/ltx-video'),
    'model-3d': env('FAL_MODEL_3D', 'fal-ai/triposr'),
    'avatar': env('FAL_MODEL_AVATAR', 'fal-ai/ltx-video'),
    'tts': '', 'music': '', 'sfx': '',
  };
  return models[feature];
}

//? Compose the final text prompt: the resolved style's system-prompt + the caller's prompt + the
//? user's free-form extra instructions (ADR 0053). Pure + exported for tests.
export function composeMediaPrompt(req: MediaGenerationRequest): string {
  return [req.style?.systemPrompt, req.prompt, req.extraInstructions]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join('. ');
}

//? Build the fal model id + input body for a request. `reference-image` carries the reference as
//? `image_url` (reference-conditioned gen). Pure + exported for tests.
export function composeFalInput(req: MediaGenerationRequest): { model: string; input: Record<string, unknown> } {
  const prompt = composeMediaPrompt(req);
  const input: Record<string, unknown> = { prompt, ...req.params };
  if ((req.feature === 'reference-image' || req.feature === 'model-3d') && req.referenceUrl) input.image_url = req.referenceUrl;
  return { model: falModelFor(req.feature), input };
}

//? The asset kind fal produces per feature.
const FEATURE_ASSET_KIND: Record<MediaFeature, string> = {
  'image-gen': 'image', 'reference-image': 'image', 'video-gen': 'video', 'model-3d': 'model-3d',
  'avatar': 'avatar', 'tts': 'voice', 'music': 'music', 'sfx': 'sfx',
};

//? Live € cost per feature (cents) — realistic magnitudes for budgeting (video » image). Overridable
//? per env; a fixed per-feature estimate because fal's response does not carry a stable per-call cost.
export function liveMediaCostCents(feature: MediaFeature): number {
  const env = envNum;
  const costs: Record<MediaFeature, number> = {
    'image-gen': env('FAL_COST_IMAGE', 4), 'reference-image': env('FAL_COST_REFERENCE_IMAGE', 5),
    'video-gen': env('FAL_COST_VIDEO', 40), 'model-3d': env('FAL_COST_3D', 20), 'avatar': env('FAL_COST_AVATAR', 30),
    'tts': 2, 'music': 6, 'sfx': 1,
  };
  return costs[feature];
}

//? Pull the produced asset URL out of a fal result JSON. Fal shapes vary per model family: image models
//? return `images:[{url}]`, video `video:{url}` (or `video_url`), 3d `model_mesh:{url}`. Pure + exported.
export function extractFalAsset(feature: MediaFeature, result: Record<string, unknown>): MediaAsset | null {
  const kind = FEATURE_ASSET_KIND[feature];
  const url =
    asUrl(firstOf(result.images)) ??
    asUrl(result.image) ??
    asUrl(result.video) ?? asUrl(result.video_url) ??
    asUrl(result.model_mesh) ?? asUrl(result.mesh) ??
    asUrl(firstOf(result.audio_files)) ?? asUrl(result.audio) ??
    null;
  if (url === null) return null;
  return { kind, url, metadata: { feature, provider: 'fal', raw: result } };
}

//? The HTTP transport — submit a fal queue request and return the final result JSON. Injectable so
//? `generate` is testable with a fixture (no network). The real one does submit → poll → fetch.
export interface FalTransport {
  submit: (model: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const FAL_QUEUE_BASE = (process.env.FAL_QUEUE_BASE ?? '').trim() || 'https://queue.fal.run';
const POLL_MAX = Number(process.env.FAL_POLL_MAX ?? '') || 60;
const POLL_MS = Number(process.env.FAL_POLL_MS ?? '') || 2000;

//? The live fal.ai queue transport: POST the job, poll status until COMPLETED, GET the result.
export const realFalTransport: FalTransport = {
  submit: async (model, input) => {
    const key = (process.env.FAL_KEY ?? '').trim();
    const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
    const submitted = await withRetry(async () => {
      //? External fal.ai REST API — not a framework `/api/*` route.
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(`${FAL_QUEUE_BASE}/${model}`, { method: 'POST', headers, body: JSON.stringify(input) });
      if (!r.ok) throw new Error(`fal submit ${String(r.status)}`);
      return (await r.json()) as { status_url?: string; response_url?: string };
    }, { attempts: 3, baseMs: 500 });
    const statusUrl = submitted.status_url;
    const responseUrl = submitted.response_url;
    if (statusUrl === undefined || responseUrl === undefined) throw new Error('fal submit: missing status/response url');
    for (let i = 0; i < POLL_MAX; i += 1) {
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const sr = await fetch(statusUrl, { headers });
      if (!sr.ok) throw new Error(`fal status ${String(sr.status)}`);
      const status = ((await sr.json()) as { status?: string }).status;
      if (status === 'COMPLETED') break;
      if (status === 'FAILED' || status === 'ERROR') throw new Error('fal job failed');
      await sleep(POLL_MS);
    }
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const rr = await fetch(responseUrl, { headers });
    if (!rr.ok) throw new Error(`fal result ${String(rr.status)}`);
    return (await rr.json()) as Record<string, unknown>;
  },
};

//? Build the fal provider around a transport (injected in tests). `available()` still gates the stub
//? fallback (no key → the registry never calls `generate`).
export function createFalProvider(transport: FalTransport = realFalTransport): MediaProvider {
  return {
    id: 'fal',
    label: 'Fal.ai',
    supports: SUPPORTED,
    available: () => Promise.resolve(Boolean((process.env.FAL_KEY ?? '').trim())),
    generate: async (req: MediaGenerationRequest): Promise<MediaGenerationResult> => {
      if (!SUPPORTED.includes(req.feature)) return { ok: false, providerId: 'fal', costCents: 0, stub: false, error: 'media.featureUnsupported' };
      const { model, input } = composeFalInput(req);
      const [err, result] = await tryCatch(() => transport.submit(model, input));
      if (err || !result) return { ok: false, providerId: 'fal', costCents: 0, stub: false, error: `media.falFailed: ${err?.message ?? 'unknown'}` };
      const asset = extractFalAsset(req.feature, result);
      if (!asset) return { ok: false, providerId: 'fal', costCents: 0, stub: false, error: 'media.falNoAsset' };
      return { ok: true, asset, providerId: 'fal', costCents: liveMediaCostCents(req.feature), stub: false };
    },
  };
}

export const falProvider: MediaProvider = createFalProvider();
