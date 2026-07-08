//? V5 audio-track — the mixed-audio plan. Pure ffmpeg-arg assertions (the real run is the opt-in live test).
//? Verifies: the single-voice path is UNCHANGED (no amix) so the existing render/live test can't regress; a
//? non-default voice gain or a music track switches to the amix branch with per-track volumes → [aout].

import { assert, eq, report } from '../_helpers.mts';
import { buildVideoStitchPlan, buildAudioMixPlan, resolveRenderFormat, type RenderScene } from '../../server/content/render';

const fmt = resolveRenderFormat('16:9');
const clip = (videoFile: string, durationMs = 3000): RenderScene => ({ videoFile, imageFile: null, startTrimMs: 0, durationMs, transitionIn: 'cut' });
const scenes = [clip('a.mp4'), clip('b.mp4')];

try {
  //? buildAudioMixPlan (pure) — per-track volume + amix → [aout]; empty ⇒ null.
  assert(buildAudioMixPlan([]) === null, 'no tracks → null');
  const mix = buildAudioMixPlan([{ label: '2:a', volume: 1.5 }, { label: '3:a', volume: 0.2 }]);
  assert(mix !== null && mix.map === '[aout]', 'a mix maps [aout]');
  assert(mix !== null && mix.filter.includes('volume=1.50') && mix.filter.includes('volume=0.20'), 'each track gets its volume');
  assert(mix !== null && mix.filter.includes('amix=inputs=2'), 'the two tracks are amixed');

  //? 1) single voice, default gain → the LEGACY single-map path, NO amix (byte-identical to pre-V5).
  const voiceOnly = buildVideoStitchPlan(scenes, 'voice.mp3', 'o.mp4', fmt);
  const vs = voiceOnly.args.join(' ');
  assert(vs.includes('-i /media/voice.mp3'), 'voice is an input');
  assert(vs.includes('-map 2:a'), 'the single voice stream is mapped directly (index 2)');
  assert(!vs.includes('amix') && !vs.includes('[aout]'), 'no amix branch for a plain single-voice render');

  //? 2) a non-default voice gain → the amix branch kicks in (so the slider actually affects the mix).
  const louder = buildVideoStitchPlan(scenes, 'voice.mp3', 'o.mp4', fmt, { voiceVolume: 1.6 });
  const ls = louder.args.join(' ');
  assert(ls.includes('amix=inputs=1') && ls.includes('volume=1.60'), 'a non-1 voice gain routes voice through amix at that gain');
  assert(ls.includes('-map [aout]'), 'the mixed audio is mapped out');

  //? 3) voice + ducked music → two audio inputs, both volumes, amix of 2 → [aout].
  const withMusic = buildVideoStitchPlan(scenes, 'voice.mp3', 'o.mp4', fmt, { musicFile: 'music.mp3', voiceVolume: 1, musicVolume: 0.25 });
  const ms = withMusic.args.join(' ');
  assert(ms.includes('-i /media/voice.mp3') && ms.includes('-i /media/music.mp3'), 'voice + music are both inputs');
  assert(ms.includes('[2:a]') && ms.includes('[3:a]'), 'voice=input2, music=input3 (after the 2 scene inputs)');
  assert(ms.includes('volume=1.00') && ms.includes('volume=0.25'), 'voice at 1.0, music ducked at 0.25');
  assert(ms.includes('amix=inputs=2') && ms.includes('-map [aout]'), 'both mixed into [aout]');

  //? 4) no audio at all → no audio map (unchanged).
  const silent = buildVideoStitchPlan(scenes, null, 'o.mp4', fmt);
  const ss = silent.args.join(' ');
  assert(!ss.includes('-c:a') && !ss.includes('[aout]'), 'no audio → no audio codec/map (concat a=0 aside)');

  eq(0, 0, 'audio-mix plan verified');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/audioMix.test.mts');
