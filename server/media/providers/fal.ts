//? Fal.ai media adapter (F0.3 ADR 0052; M1 depth-program — REAL gen). The image/video/3d/reference
//? gateway. `available()` is false until `FAL_KEY` is present, so the registry keeps falling back to a
//? valid-shaped STUB when no key is configured (dummy-data testing). When a key IS present the LIVE
//? `generate` runs a real fal.ai queue request (submit → poll → fetch result) and returns a real asset
//? URL + a metered € cost. The HTTP transport is injectable so the request/extract logic is unit-tested
//? with fixtures (no key, no network); the pure prompt/model/extract helpers are exported for that.

import { sleep, tryCatch } from '@luckystack/core';

import { withRetry } from '../../util/retry';
import { composeMediaPrompt } from '../prompt';
import type { MediaFeature, MediaGenerationRequest, MediaGenerationResult, MediaProvider, MediaAsset, MediaProgressCallback } from '../types';

//? Re-exported so the fal test + callers can import the shared prompt composer from here.
export { composeMediaPrompt } from '../prompt';

const SUPPORTED: MediaFeature[] = ['image-gen', 'reference-image', 'video-gen', 'model-3d', 'avatar', 'inpaint'];

const envStr = (name: string, fallback: string): string => (process.env[name] ?? '').trim() || fallback;
const envNum = (name: string, fallback: number): number => Number(process.env[name] ?? '') || fallback;
//? Cheap-test mode (`WS_MEDIA_CHEAP=1`) — the CHEAPEST real generation so a live test costs almost
//? nothing: the fast/low-step model + the lowest resolution + a single output. Full quality is the default.
//? S1 — cheap mode is on when the operator env is set OR the request asked for a cheap "preview" (per-request
//? dry-run), so a user can rehearse a generation cheaply before the full-quality run.
const cheapMode = (reqCheap?: boolean): boolean => reqCheap === true || (process.env.WS_MEDIA_CHEAP ?? '').trim() !== '';
const firstOf = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const asUrl = (v: unknown): string | null => {
  if (v !== null && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') return (v as { url: string }).url;
  return typeof v === 'string' ? v : null;
};

//? The fal.ai model id per feature. Overridable per env so a workspace can pin a newer/cheaper model
//? without a code change; the defaults are current, widely-available fal endpoints.
function falModelFor(feature: MediaFeature, reqCheap?: boolean): string {
  const env = envStr;
  //? Cheap mode defaults to the fast/low-cost `schnell` image model (unless FAL_MODEL_IMAGE is pinned).
  const cheapImage = cheapMode(reqCheap) ? 'fal-ai/flux/schnell' : 'fal-ai/flux/dev';
  const models: Record<MediaFeature, string> = {
    'image-gen': env('FAL_MODEL_IMAGE', cheapImage),
    'reference-image': env('FAL_MODEL_REFERENCE_IMAGE', 'fal-ai/flux/dev/image-to-image'),
    'video-gen': env('FAL_MODEL_VIDEO', 'fal-ai/ltx-video'),
    'model-3d': env('FAL_MODEL_3D', 'fal-ai/triposr'),
    'avatar': env('FAL_MODEL_AVATAR', 'fal-ai/ltx-video'),
    //? E1 — flux inpaint (region-edit). Env-overridable so the operator pins their verified inpaint endpoint.
    'inpaint': env('FAL_MODEL_INPAINT', 'fal-ai/flux-general/inpainting'),
    'tts': '', 'music': '', 'sfx': '',
  };
  return models[feature];
}

//? The cheapest fal input params per feature when `WS_MEDIA_CHEAP` is on — lowest resolution + fewest
//? steps + a single output. Overridable per env; the request's own `params` always win over these.
function cheapParams(feature: MediaFeature, reqCheap?: boolean): Record<string, unknown> {
  if (!cheapMode(reqCheap)) return {};
  if (feature === 'image-gen') {
    return { image_size: envStr('FAL_IMAGE_SIZE', 'square'), num_inference_steps: envNum('FAL_IMAGE_STEPS', 4), num_images: 1, enable_safety_checker: false };
  }
  //? reference-image is image-to-image: it DERIVES the size from the input image, so `image_size` is an
  //? invalid param (422); and flux/dev requires `num_inference_steps` >= 10 (4 → 422). Cheapest valid = 10.
  if (feature === 'reference-image') {
    return { num_inference_steps: envNum('FAL_REFERENCE_IMAGE_STEPS', 10), num_images: 1, enable_safety_checker: false };
  }
  if (feature === 'video-gen' || feature === 'avatar') {
    return { num_inference_steps: envNum('FAL_VIDEO_STEPS', 8), resolution: envStr('FAL_VIDEO_RESOLUTION', '480p'), num_frames: envNum('FAL_VIDEO_FRAMES', 65) };
  }
  return {};
}

//? Build the fal model id + input body for a request. `reference-image` carries the reference as
//? `image_url` (reference-conditioned gen). Cheap-mode defaults are merged UNDER the caller's params
//? (so explicit params win) UNDER the prompt (never overridden). Pure + exported for tests.
export function composeFalInput(req: MediaGenerationRequest): { model: string; input: Record<string, unknown> } {
  //? P3 — a per-request model override (`req.params.model`, e.g. a low-poly 3d or a fast video model) picks
  //? the fal model id, falling back to the env/default. It's a routing param, so strip it from the input body.
  const params: Record<string, unknown> = req.params ?? {};
  //? S1 — a per-request cheap "preview" flag (routing param, stripped from the input body).
  const { model: modelOverride, cheap: cheapFlag, ...restParams } = params;
  const reqCheap = cheapFlag === true;
  const model = typeof modelOverride === 'string' && modelOverride.trim().length > 0 ? modelOverride.trim() : falModelFor(req.feature, reqCheap);
  //? model-3d (image-to-3D, e.g. triposr) takes ONLY the source image — a `prompt`/size params are
  //? rejected (400). It needs a reference image (chain: generate an image, then convert it).
  if (req.feature === 'model-3d') {
    return { model, input: { ...(req.referenceUrl ? { image_url: req.referenceUrl } : {}), ...restParams } };
  }
  //? E1 — inpaint (region-edit): the SOURCE image (referenceUrl) + the MASK (maskUrl, white = edit) + the
  //? instruction as the prompt. This is the fal flux-inpaint input shape.
  if (req.feature === 'inpaint') {
    return { model, input: { ...(req.referenceUrl ? { image_url: req.referenceUrl } : {}), ...(req.maskUrl ? { mask_url: req.maskUrl } : {}), ...restParams, prompt: composeMediaPrompt(req) } };
  }
  const prompt = composeMediaPrompt(req);
  const input: Record<string, unknown> = { ...cheapParams(req.feature, reqCheap), ...restParams, prompt };
  if (req.feature === 'reference-image' && req.referenceUrl) input.image_url = req.referenceUrl;
  return { model, input };
}

//? The asset kind fal produces per feature.
const FEATURE_ASSET_KIND: Record<MediaFeature, string> = {
  'image-gen': 'image', 'reference-image': 'image', 'video-gen': 'video', 'model-3d': 'model-3d',
  'avatar': 'avatar', 'tts': 'voice', 'music': 'music', 'sfx': 'sfx', 'inpaint': 'image',
};

//? Live € cost per feature (cents) — realistic magnitudes for budgeting (video » image). Overridable
//? per env; a fixed per-feature estimate because fal's response does not carry a stable per-call cost.
export function liveMediaCostCents(feature: MediaFeature): number {
  const env = envNum;
  const costs: Record<MediaFeature, number> = {
    'image-gen': env('FAL_COST_IMAGE', 4), 'reference-image': env('FAL_COST_REFERENCE_IMAGE', 5),
    'video-gen': env('FAL_COST_VIDEO', 40), 'model-3d': env('FAL_COST_3D', 20), 'avatar': env('FAL_COST_AVATAR', 30),
    'tts': 2, 'music': 6, 'sfx': 1, 'inpaint': env('FAL_COST_INPAINT', 5),
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
  submit: (model: string, input: Record<string, unknown>, apiKey: string, onProgress?: MediaProgressCallback) => Promise<Record<string, unknown>>;
}

const FAL_QUEUE_BASE = (process.env.FAL_QUEUE_BASE ?? '').trim() || 'https://queue.fal.run';
//? Poll budget: slow fal queue models (e.g. triposr 3D, when the queue is backed up) need a higher
//? ceiling. Default 120 × 2s = 4 min; bump FAL_POLL_MAX for a congested model.
const POLL_MAX = Number(process.env.FAL_POLL_MAX ?? '') || 120;
const POLL_MS = Number(process.env.FAL_POLL_MS ?? '') || 2000;
//? Hard per-request timeout — a hung fal fetch would otherwise block a whole generation forever.
const FETCH_TIMEOUT_MS = Number(process.env.FAL_FETCH_TIMEOUT_MS ?? '') || 30_000;

//? fetch with a hard abort timeout so a stalled connection can't hang the poll loop indefinitely.
async function falFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { ctrl.abort(); }, FETCH_TIMEOUT_MS);
  try {
    //? External fal.ai REST API — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

//? The live fal.ai queue transport: POST the job, poll status until COMPLETED, GET the result.
export const realFalTransport: FalTransport = {
  submit: async (model, input, apiKey, onProgress) => {
    const headers = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };
    const submitted = await withRetry(async () => {
      const r = await falFetch(`${FAL_QUEUE_BASE}/${model}`, { method: 'POST', headers, body: JSON.stringify(input) });
      if (!r.ok) throw new Error(`fal submit ${String(r.status)}`);
      return (await r.json()) as { status_url?: string; response_url?: string };
    }, { attempts: 3, baseMs: 500 });
    const statusUrl = submitted.status_url;
    const responseUrl = submitted.response_url;
    if (statusUrl === undefined || responseUrl === undefined) throw new Error('fal submit: missing status/response url');
    //? Poll until COMPLETED; a timeout throws a CLEAR error (don't fall through to fetch an incomplete
    //? result, which returns the confusing "still in progress" 400). While polling, report queue vs
    //? running transitions to `onProgress` — fal's status is IN_QUEUE (with a `queue_position`) until
    //? the job is picked up, then IN_PROGRESS. The UI's elapsed timer starts on the first `running`.
    let completed = false;
    let reportedRunning = false;
    let lastQueuePos: number | undefined;
    for (let i = 0; i < POLL_MAX; i += 1) {
      const sr = await falFetch(statusUrl, { headers });
      if (!sr.ok) throw new Error(`fal status ${String(sr.status)}`);
      const body = (await sr.json()) as { status?: string; queue_position?: number };
      const status = body.status;
      if (status === 'COMPLETED') { completed = true; break; }
      if (status === 'FAILED' || status === 'ERROR') throw new Error('fal job failed');
      if (onProgress) {
        if (status === 'IN_QUEUE') {
          //? Report on entry + whenever the position moves (so the UI can show "position N").
          if (!reportedRunning && body.queue_position !== lastQueuePos) {
            lastQueuePos = body.queue_position;
            onProgress(body.queue_position === undefined ? { state: 'queued' } : { state: 'queued', queuePosition: body.queue_position });
          }
        } else if (!reportedRunning) {
          //? Anything past the queue (IN_PROGRESS) → the job has started; fire `running` ONCE.
          reportedRunning = true;
          onProgress({ state: 'running' });
        }
      }
      await sleep(POLL_MS);
    }
    if (!completed) throw new Error('fal poll timeout');
    const rr = await falFetch(responseUrl, { headers });
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
    available: (apiKey?: string) => Promise.resolve(Boolean((apiKey ?? process.env.FAL_KEY ?? '').trim())),
    generate: async (req: MediaGenerationRequest): Promise<MediaGenerationResult> => {
      if (!SUPPORTED.includes(req.feature)) return { ok: false, providerId: 'fal', costCents: 0, stub: false, error: 'media.featureUnsupported' };
      const { model, input } = composeFalInput(req);
      const key = (req.apiKey ?? process.env.FAL_KEY ?? '').trim();
      const [err, result] = await tryCatch(() => transport.submit(model, input, key, req.onProgress));
      if (err || !result) return { ok: false, providerId: 'fal', costCents: 0, stub: false, error: `media.falFailed: ${err?.message ?? 'unknown'}` };
      const asset = extractFalAsset(req.feature, result);
      if (!asset) return { ok: false, providerId: 'fal', costCents: 0, stub: false, error: 'media.falNoAsset' };
      return { ok: true, asset, providerId: 'fal', costCents: liveMediaCostCents(req.feature), stub: false };
    },
  };
}

export const falProvider: MediaProvider = createFalProvider();
