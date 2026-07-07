//? Unit test for FREEDOM_PROGRAM O1 — export formats + captions. Verifies buildFfmpegPlan honours the format
//? preset (9:16 vertical scale/pad + fps in the ffmpeg args), resolveRenderFormat falls back safely, and the
//? .srt/.vtt emitters produce well-formed, evenly-timed cues from caption lines. All pure.

import { assert, eq, report } from '../_helpers.mts';

const { buildFfmpegPlan, resolveRenderFormat, buildSrt, buildVtt } = await import('../../server/content/render.ts');

const beats = [{ imageFile: 'a.png', durationMs: 2000 }, { imageFile: 'b.png', durationMs: 2000 }];

// format presets
{
  const nine = resolveRenderFormat('9:16');
  eq(nine.width, 720, '9:16 width'); eq(nine.height, 1280, '9:16 height');
  eq(resolveRenderFormat('nonsense').key, '16:9', 'unknown format → 16:9 default');
  eq(resolveRenderFormat(undefined).key, '16:9', 'no format → 16:9 default');

  const plan916 = buildFfmpegPlan(beats, 'v.mp3', 'list.txt', 'out.mp4', nine);
  const vf = plan916.args[plan916.args.indexOf('-vf') + 1];
  assert(vf.includes('scale=720:1280'), '9:16 plan scales to 720x1280');
  assert(plan916.args.includes('-shortest'), 'audio → -shortest');

  const planDefault = buildFfmpegPlan(beats, null, 'list.txt', 'out.mp4');
  const vfd = planDefault.args[planDefault.args.indexOf('-vf') + 1];
  assert(vfd.includes('scale=1280:720'), 'default plan stays 1280x720');
}

// O4 — watermark overlay
{
  const wm = buildFfmpegPlan(beats, 'v.mp3', 'list.txt', 'out.mp4', undefined, { file: 'logo.png', position: 'br' });
  assert(wm.args.includes('-filter_complex'), 'a watermark switches to filter_complex');
  const fc = wm.args[wm.args.indexOf('-filter_complex') + 1];
  assert(fc.includes('overlay=W-w-24:H-h-24'), 'br → bottom-right overlay with margin');
  assert(fc.includes('[2:v]'), 'with audio, the watermark is input index 2');
  assert(wm.args.includes('[outv]'), 'the overlaid stream is mapped out');
  assert(!wm.args.includes('-vf'), 'filter_complex replaces the -vf path');

  const wmNoAudio = buildFfmpegPlan(beats, null, 'list.txt', 'out.mp4', undefined, { file: 'logo.png', position: 'tl' });
  const fc2 = wmNoAudio.args[wmNoAudio.args.indexOf('-filter_complex') + 1];
  assert(fc2.includes('[1:v]'), 'without audio, the watermark is input index 1');
  assert(fc2.includes('overlay=24:24'), 'tl → top-left overlay');

  const noWm = buildFfmpegPlan(beats, null, 'list.txt', 'out.mp4');
  assert(noWm.args.includes('-vf') && !noWm.args.includes('-filter_complex'), 'no watermark → the simple -vf path');
}

// caption emitters
{
  const srt = buildSrt(['Hook line', 'Second line', 'Third'], 9000);
  assert(srt.startsWith('1\n'), 'srt starts with cue index 1');
  assert(srt.includes('00:00:00,000 --> 00:00:03,000'), 'first cue spans an even 3s slot');
  assert(srt.includes('Second line'), 'srt carries the caption text');
  assert(srt.includes('3\n'), 'three cues for three lines');

  const vtt = buildVtt(['Hook line', 'Second line'], 8000);
  assert(vtt.startsWith('WEBVTT'), 'vtt has the WEBVTT header');
  assert(vtt.includes('00:00:00.000 --> 00:00:04.000'), 'vtt uses a dot ms separator + even 4s slots');

  eq(buildSrt([], 5000), '', 'no captions → empty srt');
  eq(buildVtt([], 5000), 'WEBVTT\n', 'no captions → header-only vtt');
  eq(buildSrt(['  ', ''], 5000), '', 'blank caption lines are dropped');
}

report('tests/unit/renderFormats.test.mts');
