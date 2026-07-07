//? Unit test for FREEDOM_PROGRAM E1 (backend half) — the inpaint MediaFeature. Verifies composeFalInput builds
//? the fal flux-inpaint input shape: the SOURCE image_url + the MASK mask_url + the instruction as the prompt,
//? routed to the (env-overridable) inpaint model. This is the "mask + prompt reach the provider" fixture; the
//? Fabric.js canvas that PRODUCES the mask is a separate follow-up. Pure.

import { assert, eq, report } from '../_helpers.mts';

const { composeFalInput } = await import('../../server/media/providers/fal.ts');

{
  const out = composeFalInput({ feature: 'inpaint', prompt: 'make the car red', referenceUrl: '/media/src.png', maskUrl: '/media/mask.png' });
  eq(out.input.image_url, '/media/src.png', 'the source image reaches the provider as image_url');
  eq(out.input.mask_url, '/media/mask.png', 'the mask reaches the provider as mask_url');
  eq(out.input.prompt, 'make the car red', 'the instruction reaches the provider as the prompt');
  assert(out.model.includes('inpaint'), 'inpaint routes to the flux-inpaint model');

  // a per-request model override still wins (P3), and cheap/model routing params are stripped
  const overridden = composeFalInput({ feature: 'inpaint', prompt: 'x', referenceUrl: '/media/s.png', maskUrl: '/media/m.png', params: { model: 'fal-ai/custom-inpaint' } });
  eq(overridden.model, 'fal-ai/custom-inpaint', 'a per-request model override wins for inpaint too');
  assert(!('model' in overridden.input), 'the model routing param is stripped from the input');
}

report('tests/unit/inpaint.test.mts');
