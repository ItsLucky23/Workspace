//? Unit test for the REAL Fal.ai media adapter (server/media/providers/fal, M1). No key, no network —
//? the HTTP transport is injected with fixtures. Verifies: the prompt is composed from style + prompt +
//? extra; the request carries the model + (for reference-image) the reference image_url; the produced
//? asset is extracted per model shape (image/video/3d); failures + no-asset are typed; `available()`
//? gates on FAL_KEY (so the registry stub-fallback stays intact without a key).

import { assert, eq, report } from '../_helpers.mts';

const { composeMediaPrompt, composeFalInput, extractFalAsset, createFalProvider, liveMediaCostCents } =
  await import('../../server/media/providers/fal.ts');

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
