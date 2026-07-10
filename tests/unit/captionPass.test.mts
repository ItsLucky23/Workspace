//? F2 — the caption post-pass ffmpeg args (pure builder). Verifies burn-in uses the `subtitles=` video filter
//? (re-encode) and soft-mux uses `-c:s mov_text` with a stream-copy of video/audio, both reading the sidecar
//? .srt from the container-internal /media path (POSIX — no Windows escaping). The pass runs on the FINISHED
//? mp4, so the load-bearing render filtergraphs are never touched (zero regression). Runtime run is best-effort.

import { buildCaptionPassArgs } from '../../server/content/render';
import { assert, eq, report } from '../_helpers.mts';

// burn-in
{
  const a = buildCaptionPassArgs('r.mp4', 'r-cc.srt', 'r-cc.mp4', 'burn');
  const j = a.join(' ');
  assert(j.includes('-vf subtitles=/media/r-cc.srt'), 'burn uses the subtitles video filter on the /media srt');
  assert(j.includes('-c:v libx264'), 'burn re-encodes the video (captions baked in)');
  assert(j.includes('-c:a copy'), 'burn stream-copies the audio (no needless re-encode)');
  assert(!j.includes('mov_text'), 'burn does NOT add a soft subtitle track');
  assert(j.endsWith('/media/r-cc.mp4'), 'burn writes the captioned mp4');
}
// soft-mux
{
  const a = buildCaptionPassArgs('r.mp4', 'r-cc.srt', 'r-cc.mp4', 'soft');
  const j = a.join(' ');
  assert(j.includes('-c:s mov_text'), 'soft muxes the srt as a mov_text subtitle track');
  assert(j.includes('-c copy'), 'soft stream-copies video+audio (no re-encode)');
  assert(j.includes('-i /media/r.mp4') && j.includes('-i /media/r-cc.srt'), 'soft takes both the mp4 and the srt as inputs');
  assert(!j.includes('subtitles='), 'soft does NOT burn the captions into the video');
}
eq(buildCaptionPassArgs('x.mp4', 'x.srt', 'y.mp4', 'burn')[0], '-y', 'always overwrites the output (-y)');

report('tests/unit/captionPass.test.mts');
