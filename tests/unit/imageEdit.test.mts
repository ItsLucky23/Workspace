//? F6 — instruct-edit (image-edit) fal input shape. Verifies composeFalInput builds the flux-kontext body: the
//? SOURCE image as `image_url` + the instruction as `prompt`, and — unlike inpaint — NO `mask_url`. Also checks
//? the feature resolves to the fal provider (the 7-Record ripple is complete).

import { assert, eq, report } from '../_helpers.mts';

const { composeFalInput } = await import('../../server/media/providers/fal.ts');
const { resolveMediaAssignment } = await import('../../server/media/assignments.ts');

const { input } = composeFalInput({ feature: 'image-edit', prompt: 'change the sky to sunset', referenceUrl: '/media/src.png' });
eq(input.image_url, '/media/src.png', 'the source image is the image_url (whole-image edit)');
eq(input.prompt, 'change the sky to sunset', 'the instruction is the prompt');
assert(!('mask_url' in input), 'image-edit is MASK-LESS (distinct from inpaint)');
assert(!('video_url' in input), 'it is an image edit, not a video op');

eq(resolveMediaAssignment('image-edit'), 'fal', 'image-edit is assigned to fal');

report('tests/unit/imageEdit.test.mts');
