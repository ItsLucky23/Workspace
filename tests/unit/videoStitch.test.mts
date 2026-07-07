//? Unit test for V2 (IDEA_TO_OUTCOME) — the real multi-clip stitch plan. Pure ffmpeg-arg assertions (the
//? actual run is proven by the opt-in live render test). Verifies: real clips are concatenated with per-scene
//? trim; a still is looped for its duration; a crossfade produces an xfade chain with monotonic offsets;
//? audio is mapped; an empty scene list degrades.

import { assert, eq, report } from '../_helpers.mts';
import { buildVideoStitchPlan, resolveRenderFormat, type RenderScene } from '../../server/content/render';

const fmt = resolveRenderFormat('16:9');
const clip = (videoFile: string, durationMs: number, startTrimMs = 0, transitionIn: RenderScene['transitionIn'] = 'cut'): RenderScene => ({ videoFile, imageFile: null, startTrimMs, durationMs, transitionIn });

try {
  //? 1) two real clips, hard cuts → a single concat over 2 inputs, with a trim per clip.
  const cut = buildVideoStitchPlan([clip('a.mp4', 4000, 1000), clip('b.mp4', 4000)], null, 'out.mp4', fmt);
  assert(cut.hasVideo, 'a 2-clip plan has video');
  const cutStr = cut.args.join(' ');
  assert(cutStr.includes('-i /media/a.mp4') && cutStr.includes('-i /media/b.mp4'), 'both clips are inputs in order');
  assert(cutStr.includes('trim=1.00:5.00'), 'clip A is trimmed from its 1s in-point for 4s (1..5)');
  assert(cutStr.includes('concat=n=2:v=1:a=0[outv]'), 'hard cuts use the exact concat filter');
  assert(cutStr.includes('-map [outv]'), 'the composited video is mapped out');
  assert(!cutStr.includes('xfade'), 'no crossfade when every transition is a cut');

  //? 2) a still scene → looped for its duration (becomes a clip).
  const still = buildVideoStitchPlan([{ videoFile: null, imageFile: 's.jpg', startTrimMs: 0, durationMs: 3000, transitionIn: 'cut' }, clip('b.mp4', 2000)], null, 'out.mp4', fmt);
  assert(still.args.join(' ').includes('-loop 1 -t 3.00 -i /media/s.jpg'), 'a still is looped + time-bounded to its duration');

  //? 3) a crossfade scene → an xfade chain; offsets are non-negative + strictly increasing.
  const fade = buildVideoStitchPlan([clip('a.mp4', 4000), clip('b.mp4', 4000, 0, 'xfade'), clip('c.mp4', 4000, 0, 'fade')], null, 'out.mp4', fmt);
  const fadeStr = fade.args.join(' ');
  assert(fadeStr.includes('xfade=transition=fade'), 'a crossfade scene emits an xfade');
  const offsets = [...fadeStr.matchAll(/offset=([0-9.]+)/g)].map((m) => Number(m[1]));
  assert(offsets.length === 2, 'a 3-scene xfade chain has 2 transitions');
  assert(offsets.every((o) => o >= 0), 'all xfade offsets are non-negative');
  assert((offsets[1] ?? 0) > (offsets[0] ?? 0), 'offsets increase along the chain');
  assert(fadeStr.includes('[outv]'), 'the xfade chain ends at [outv]');

  //? 4) audio → the voice input is the LAST input and is mapped.
  const withAudio = buildVideoStitchPlan([clip('a.mp4', 4000), clip('b.mp4', 4000)], 'voice.mp3', 'out.mp4', fmt);
  const aStr = withAudio.args.join(' ');
  assert(aStr.includes('-i /media/voice.mp3'), 'the voice track is an input');
  assert(aStr.includes('-map 2:a'), 'the audio (input index 2 = after the 2 clips) is mapped');
  assert(aStr.includes('-shortest'), 'the render is bounded to the shortest stream');

  //? 5) nothing renderable → degrade.
  eq(buildVideoStitchPlan([], null, 'out.mp4', fmt).hasVideo, false, 'an empty scene list has no video');
  eq(buildVideoStitchPlan([{ videoFile: null, imageFile: null, startTrimMs: 0, durationMs: 1000, transitionIn: 'cut' }], null, 'out.mp4', fmt).hasVideo, false, 'a scene with no clip/still is not renderable');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/videoStitch.test.mts');
