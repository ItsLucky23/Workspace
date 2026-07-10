//? F9 — the audio-editor-lite ffmpeg args (pure builder). Verifies the trim window (atrim), the re-base to 0
//? (asetpts), the linear gain (volume), and clamping (a zero/negative window becomes a minimal valid one). The
//? runtime run is best-effort (no Docker in unit tests) — only the plan is asserted.

import { buildAudioTrimArgs } from '../../server/content/render';
import { assert, eq, report } from '../_helpers.mts';

const a = buildAudioTrimArgs('v.mp3', 'v-trim.mp3', 2000, 5000, 1.5);
const j = a.join(' ');
assert(j.includes('atrim=2.00:5.00'), 'the trim window is [2s,5s]');
assert(j.includes('asetpts=PTS-STARTPTS'), 'the cut is re-based to start at 0');
assert(j.includes('volume=1.50'), 'the linear gain is applied');
assert(j.startsWith('-y -i /media/v.mp3'), 'it reads the source from /media');
assert(j.endsWith('/media/v-trim.mp3'), 'it writes the trimmed asset');

// a degenerate window (end <= start) is clamped to a minimal valid clip, not an ffmpeg error.
const bad = buildAudioTrimArgs('x.mp3', 'y.mp3', 3000, 1000, 1).join(' ');
assert(bad.includes('atrim=3.00:3.10'), 'an end <= start is clamped to start+100ms');
// negative gain is floored to 0 (mute), never a negative multiplier.
eq(buildAudioTrimArgs('x.mp3', 'y.mp3', 0, 1000, -2).join(' ').includes('volume=0.00'), true, 'negative gain floors to 0');

report('tests/unit/audioTrim.test.mts');
