//? Unit test for FREEDOM_PROGRAM O1 — export formats + captions. Verifies buildFfmpegPlan honours the format
//? preset (9:16 vertical scale/pad + fps in the ffmpeg args), resolveRenderFormat falls back safely, and the
//? .srt/.vtt emitters produce well-formed, evenly-timed cues from caption lines. All pure.

import { assert, eq, report } from '../_helpers.mts';

const { buildFfmpegPlan, resolveRenderFormat, buildSrt, buildVtt, buildTimedSrt, buildTimedVtt, parseFfprobeDurationMs } = await import('../../server/content/render.ts');

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

// E4 — audio mix plan
{
  const { buildAudioMixPlan } = await import('../../server/content/render.ts');
  assert(buildAudioMixPlan([]) === null, 'no tracks → null');
  const mix = buildAudioMixPlan([{ label: '0:a', volume: 1 }, { label: '1:a', volume: 0.25 }, { label: '2:a', volume: 0.6, trimMs: 2000 }]);
  assert(mix !== null, 'a mix plan is produced');
  assert(mix?.filter.includes('amix=inputs=3'), 'amix mixes all three tracks');
  assert(mix?.filter.includes('volume=0.25'), 'music is ducked (0.25)');
  assert(mix?.filter.includes('atrim=0:2.00'), 'the sfx track is trimmed to 2s');
  assert(mix?.filter.includes('[aout]') && mix.map === '[aout]', 'the mixed stream is mapped out');
  const solo = buildAudioMixPlan([{ label: '0:a', volume: 1 }]);
  assert(solo?.filter.includes('amix=inputs=1'), 'a single track still routes through amix → one output');
}

// F2 — beat-path audio mix (voice + ducked music + sfx) is additive; no-mix path unchanged
{
  const mixPlan = buildFfmpegPlan(beats, 'voice.mp3', 'list.txt', 'out.mp4', undefined, null, { musicFile: 'music.mp3', sfxFile: 'whoosh.mp3', musicVolume: 0.25, sfxVolume: 0.6 });
  const s = mixPlan.args.join(' ');
  assert(s.includes('-i /media/voice.mp3') && s.includes('-i /media/music.mp3') && s.includes('-i /media/whoosh.mp3'), 'voice + music + sfx are all inputs');
  assert(s.includes('amix=inputs=3'), 'the three audio tracks are amixed');
  assert(s.includes('volume=0.25') && s.includes('volume=0.60'), 'music ducked (0.25) + sfx gain (0.60)');
  assert(s.includes('-filter_complex') && s.includes('-map [outv]') && s.includes('-map [aout]'), 'mixed video + audio are both mapped via filter_complex');

  const plain = buildFfmpegPlan(beats, 'voice.mp3', 'list.txt', 'out.mp4');
  assert(plain.args.includes('-vf') && !plain.args.join(' ').includes('amix'), 'no mix → the simple -vf single-voice path is unchanged');

  const wmMix = buildFfmpegPlan(beats, 'voice.mp3', 'list.txt', 'out.mp4', undefined, { file: 'logo.png', position: 'br' }, { musicFile: 'm.mp3' });
  const ws = wmMix.args.join(' ');
  assert(ws.includes('overlay=W-w-24:H-h-24') && ws.includes('amix=inputs=2'), 'watermark + music mix compose (overlay + amix together)');
}

// F2 — timed captions (real per-segment timing) + ffprobe duration parse
{
  const segs = [{ text: 'Hello', startMs: 0, durationMs: 2000 }, { text: 'World', startMs: 2000, durationMs: 3000 }];
  const srt = buildTimedSrt(segs);
  assert(srt.includes('00:00:00,000 --> 00:00:02,000') && srt.includes('00:00:02,000 --> 00:00:05,000'), 'srt uses the real per-segment start+duration');
  assert(srt.includes('Hello') && srt.includes('World'), 'srt carries the segment text');
  const vtt = buildTimedVtt(segs);
  assert(vtt.startsWith('WEBVTT') && vtt.includes('00:00:02.000 --> 00:00:05.000'), 'vtt has the header + real timing');
  eq(buildTimedSrt([]), '', 'no segments → empty srt');
  eq(buildTimedVtt([{ text: '  ', startMs: 0, durationMs: 1000 }]), 'WEBVTT\n', 'blank-only segments → header-only vtt');

  eq(parseFfprobeDurationMs('12.345000'), 12345, 'ffprobe seconds → whole ms');
  eq(parseFfprobeDurationMs('\n7.5\n'), 7500, 'trims whitespace + parses');
  eq(parseFfprobeDurationMs('N/A'), null, 'non-numeric probe output → null');
  eq(parseFfprobeDurationMs('0'), null, 'zero duration → null');
}

report('tests/unit/renderFormats.test.mts');
