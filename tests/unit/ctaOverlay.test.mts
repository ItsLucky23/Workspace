//? H1 (ads) — the CTA/end-card overlay ffmpeg args (pure). A drawbox band + drawtext on the LAST seconds of
//? the ad; the text is escaped for the drawtext filter (`:` `'` `%` `\` break it). A second pass over the
//? finished mp4, so the render filtergraphs are untouched. The live overlay is the Docker render.
import { buildCtaArgs } from '../../server/content/render.ts';
import { assert, eq, report } from '../_helpers.mts';
const a = buildCtaArgs('ad.mp4', 'ad-cta.mp4', 'Shop now: 50% off', 3);
const j = a.join(' ');
assert(j.includes('drawtext=text='), 'draws the CTA text');
assert(j.includes('drawbox'), 'draws the band behind it');
assert(j.includes("enable='gte"), 'the overlay is time-gated to the tail');
assert(j.includes('-c:a copy'), 'audio is stream-copied (no re-encode)');
eq(a[0], '-y', 'overwrites output');
// escaping: a colon in the text is escaped so the drawtext filter does not break
assert(buildCtaArgs('a.mp4', 'b.mp4', 'Buy: now').join(' ').includes(String.raw`Buy\: now`), 'the colon in the CTA is escaped');
report('tests/unit/ctaOverlay.test.mts');
