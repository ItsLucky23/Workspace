//? Unit test for FREEDOM_PROGRAM S1 — dry-run / cheap preview. With the operator env OFF, a per-request
//? `params.cheap` flag drives the cheap model + cheap params (and is stripped from the input body); without it
//? the full-quality model/params are used. Pure.

import { assert, eq, report } from '../_helpers.mts';

//? Isolate the per-request path from the operator env (the test world sets WS_MEDIA_CHEAP).
delete process.env.WS_MEDIA_CHEAP;
const { composeFalInput } = await import('../../server/media/providers/fal.ts');

// per-request cheap → cheap model + cheap params, flag stripped
{
  const cheap = composeFalInput({ feature: 'image-gen', prompt: 'a cat', params: { cheap: true } });
  eq(cheap.model, 'fal-ai/flux/schnell', 'cheap preview → the fast schnell model');
  eq(cheap.input.num_inference_steps, 4, 'cheap preview → the low step count');
  eq(cheap.input.num_images, 1, 'cheap preview → a single output');
  assert(!('cheap' in cheap.input), 'the cheap flag is stripped from the input body');
}

// no flag, env off → full quality
{
  const full = composeFalInput({ feature: 'image-gen', prompt: 'a cat' });
  eq(full.model, 'fal-ai/flux/dev', 'no preview → the full-quality dev model');
  assert(!('num_inference_steps' in full.input), 'no preview → no forced low step count');
}

// video preview → low resolution
{
  const v = composeFalInput({ feature: 'video-gen', prompt: 'a wave', params: { cheap: true } });
  eq(v.input.resolution, '480p', 'cheap video preview → 480p');
}

report('tests/unit/cheapPreview.test.mts');
