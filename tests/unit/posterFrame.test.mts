//? F4 — the render poster-frame ffmpeg args (pure builder). Verifies the args grab exactly one frame, seek a
//? touch in (so a black first frame isn't the poster), seek BEFORE `-i` (fast seek), and write a `.jpg` under
//? /media. The extraction itself is best-effort at runtime (no Docker in unit tests) — only the plan is asserted.

import { buildPosterArgs } from '../../server/content/render';
import { assert, eq, report } from '../_helpers.mts';

const args = buildPosterArgs('abc.mp4', 'abc-poster.jpg');
const joined = args.join(' ');

eq(joined, '-y -ss 0.5 -i /media/abc.mp4 -frames:v 1 -q:v 3 /media/abc-poster.jpg', 'the poster args are exact');
assert(args.indexOf('-ss') < args.indexOf('-i'), 'the seek is BEFORE -i (fast input seek, not a slow output seek)');
eq(args[args.indexOf('-frames:v') + 1], '1', 'exactly one frame is grabbed');
assert(joined.endsWith('.jpg'), 'the poster is written as a jpg');
assert(joined.includes('/media/abc.mp4'), 'it reads the rendered mp4 from /media');

report('tests/unit/posterFrame.test.mts');
