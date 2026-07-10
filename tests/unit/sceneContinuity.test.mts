//? F3 — scene-continuity plumbing (pure parts). (1) buildLastFrameArgs grabs the clip's LAST frame (seek-to-eof
//? before -i, a single frame, written as jpg). (2) composeFalInput conditions a video-gen on a supplied
//? referenceUrl (the previous clip's last frame) via `image_url` — the i2v hook — but a video-gen WITHOUT a
//? referenceUrl stays a plain text-to-video request (fallback, zero regression). The runtime extraction is
//? best-effort (no Docker in unit tests).

import { assert, eq, report } from '../_helpers.mts';

const { buildLastFrameArgs } = await import('../../server/content/render.ts');
const { composeFalInput } = await import('../../server/media/providers/fal.ts');

const a = buildLastFrameArgs('scene2.mp4', 'scene2-lastframe.jpg');
const j = a.join(' ');
assert(a.indexOf('-sseof') < a.indexOf('-i'), 'the eof-seek is BEFORE -i (grabs from the end)');
assert(j.includes('-sseof -0.5'), 'it seeks 0.5s before the end');
eq(a[a.indexOf('-frames:v') + 1], '1', 'exactly one frame');
assert(j.endsWith('scene2-lastframe.jpg'), 'the last frame is written as a jpg');

// video-gen WITH a conditioning frame → image_url set (i2v)
const cond = composeFalInput({ feature: 'video-gen', prompt: 'a running fox', referenceUrl: '/media/prev-lastframe.jpg' });
eq(cond.input.image_url, '/media/prev-lastframe.jpg', 'the previous last-frame conditions the next clip (image_url)');
// video-gen WITHOUT one → plain text-to-video (no image_url), the zero-regression fallback
const plain = composeFalInput({ feature: 'video-gen', prompt: 'a running fox' });
assert(!('image_url' in plain.input), 'a video-gen with no conditioning frame stays text-to-video');

report('tests/unit/sceneContinuity.test.mts');
