//? Unit test for the REAL Fal.ai media adapter (server/media/providers/fal, M1). No key, no network —
//? the HTTP transport is injected with fixtures. Verifies: the prompt is composed from style + prompt +
//? extra; the request carries the model + (for reference-image) the reference image_url; the produced
//? asset is extracted per model shape (image/video/3d); failures + no-asset are typed; `available()`
//? gates on FAL_KEY (so the registry stub-fallback stays intact without a key).

import { assert, eq, report } from '../_helpers.mts';

const { composeMediaPrompt, composeFalInput, extractFalAsset, createFalProvider, liveMediaCostCents } =
  await import('../../server/media/providers/fal.ts');

// 0) cheap-test mode (WS_MEDIA_CHEAP) — cheapest model + lowest resolution + a single output
{
  const prev = process.env.WS_MEDIA_CHEAP;
  process.env.WS_MEDIA_CHEAP = '1';
  const cheap = composeFalInput({ feature: 'image-gen', prompt: 'a cat' });
  assert(cheap.model.includes('schnell'), 'cheap mode → the fast/low-cost schnell image model');
  const ci = cheap.input as { image_size?: string; num_inference_steps?: number; num_images?: number; prompt?: string };
  eq(ci.image_size, 'square', 'cheap mode → low resolution (square)');
  eq(ci.num_inference_steps, 4, 'cheap mode → few steps');
  eq(ci.num_images, 1, 'cheap mode → a single image');
  eq(ci.prompt, 'a cat', 'the prompt is preserved');
  // explicit params win over cheap defaults
  const override = composeFalInput({ feature: 'image-gen', prompt: 'x', params: { image_size: 'landscape_16_9' } });
  eq((override.input as { image_size?: string }).image_size, 'landscape_16_9', 'an explicit param overrides the cheap default');
  if (prev === undefined) delete process.env.WS_MEDIA_CHEAP; else process.env.WS_MEDIA_CHEAP = prev;
  // off by default → full-quality model, no cheap params
  const full = composeFalInput({ feature: 'image-gen', prompt: 'y' });
  assert(!full.model.includes('schnell') && (full.input as { num_inference_steps?: number }).num_inference_steps === undefined, 'cheap mode OFF by default (full quality)');
}

// 1) prompt composition (style + prompt + extra)
{
  const p = composeMediaPrompt({ feature: 'image-gen', prompt: 'a red car', style: { key: 'realistic', systemPrompt: 'photorealistic, 4k' }, extraInstructions: 'in the rain' });
  eq(p, 'photorealistic, 4k. a red car. in the rain', 'prompt = style + prompt + extra');
}

// 2) input carries model + prompt; reference-image adds image_url
{
  const img = composeFalInput({ feature: 'image-gen', prompt: 'x' });
  assert(img.model.length > 0, 'image-gen resolves a model');
  eq((img.input as { prompt?: string }).prompt, 'x', 'input carries the prompt');
  const ref = composeFalInput({ feature: 'reference-image', prompt: 'like this', referenceUrl: 'https://ref/img.png' });
  eq((ref.input as { image_url?: string }).image_url, 'https://ref/img.png', 'reference-image carries the reference image_url');
  //? F7 — video-restyle (video-to-video): the SOURCE video goes in as `video_url`, the style as the prompt.
  const restyle = composeFalInput({ feature: 'video-restyle', prompt: 'cinematic, warm grade', referenceUrl: 'https://cdn/src.mp4' });
  assert(restyle.model.length > 0, 'video-restyle resolves a v2v model');
  eq((restyle.input as { video_url?: string }).video_url, 'https://cdn/src.mp4', 'video-restyle carries the source as video_url (not image_url)');
  eq((restyle.input as { image_url?: string }).image_url, undefined, 'video-restyle does NOT send an image_url');
  eq((restyle.input as { prompt?: string }).prompt, 'cinematic, warm grade', 'the style is the prompt');
  eq(extractFalAsset('video-restyle', { video: { url: 'https://cdn/out.mp4' } })?.kind, 'video', 'video-restyle produces a video asset');
  assert(liveMediaCostCents('video-restyle') > 0, 'video-restyle has a live cost');
}

// 3) asset extraction per model shape
{
  eq(extractFalAsset('image-gen', { images: [{ url: 'https://cdn/x.png' }] })?.url, 'https://cdn/x.png', 'image url from images[0]');
  eq(extractFalAsset('image-gen', { images: [{ url: 'https://cdn/x.png' }] })?.kind, 'image', 'image kind');
  eq(extractFalAsset('video-gen', { video: { url: 'https://cdn/v.mp4' } })?.url, 'https://cdn/v.mp4', 'video url from video.url');
  eq(extractFalAsset('model-3d', { model_mesh: { url: 'https://cdn/m.glb' } })?.kind, 'model-3d', '3d kind');
  eq(extractFalAsset('image-gen', { nope: true }), null, 'no url → null');
}

// 4) generate() over a fixture transport — captures the request, returns a real asset
{
  let capturedModel = '';
  let capturedInput: Record<string, unknown> = {};
  const provider = createFalProvider({
    submit: async (model, input) => { capturedModel = model; capturedInput = input; return { images: [{ url: 'https://cdn/out.png' }] }; },
  });
  const res = await provider.generate({ feature: 'image-gen', prompt: 'a cat', style: { key: 'anime', systemPrompt: 'anime style' } });
  assert(res.ok && res.asset?.kind === 'image', 'generate returns a real image asset');
  eq(res.asset?.url, 'https://cdn/out.png', 'asset url from the fixture');
  assert(!res.stub, 'live result is NOT a stub');
  eq(res.costCents, liveMediaCostCents('image-gen'), 'carries the live cost');
  assert(capturedModel.length > 0, 'the transport received a model');
  eq((capturedInput as { prompt?: string }).prompt, 'anime style. a cat', 'the request prompt was composed with the style');
}

// 5) transport failure + no-asset → typed errors
{
  const failing = createFalProvider({ submit: async () => { throw new Error('boom'); } });
  const r1 = await failing.generate({ feature: 'image-gen', prompt: 'x' });
  assert(!r1.ok && (r1.error ?? '').startsWith('media.falFailed'), 'a transport throw → media.falFailed');

  const empty = createFalProvider({ submit: async () => ({ unexpected: 1 }) });
  const r2 = await empty.generate({ feature: 'image-gen', prompt: 'x' });
  assert(!r2.ok && r2.error === 'media.falNoAsset', 'a result with no url → media.falNoAsset');
}

// 6) available() gates on FAL_KEY
{
  const provider = createFalProvider({ submit: async () => ({}) });
  const prev = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
  eq(await provider.available(), false, 'no FAL_KEY → not available (stub-fallback stays)');
  process.env.FAL_KEY = 'test-fal-key';
  eq(await provider.available(), true, 'FAL_KEY set → available (live path)');
  if (prev === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = prev;
}

report('tests/unit/falProvider.test.mts');
