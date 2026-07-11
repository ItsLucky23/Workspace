//? I1/I2 (demo-video) — the capture scenario builder + docker run-plan (pure). buildCaptureScenario walks every
//? app route (goto + hold) → a valid scenario; buildCaptureRunArgs mounts MEDIA_DIR as /out, joins the shared
//? net, and passes the base url + scenario json + output name to the capture driver. The live container run is
//? the infra step (workspaces/capture image); here only the deterministic plan is asserted.
import { buildCaptureScenario, buildCaptureRunArgs } from '../../server/content/capture.ts';
import { assert, eq, report } from '../_helpers.mts';

const sc = buildCaptureScenario([{ path: '/board' }, { path: 'content' }], { holdMs: 2000 });
eq(sc.steps.length, 4, 'each route → a goto + a hold');
eq(sc.steps[0]?.goto, '/board', 'the first route is visited');
eq(sc.steps[1]?.waitMs, 2000, 'the hold duration is applied');
eq(sc.steps[2]?.goto, '/content', 'a relative route is normalised to /content');
eq(buildCaptureScenario([]).steps[0]?.goto, '/', 'no routes → a single root capture');
assert(buildCaptureScenario([], { holdMs: 100 }).steps[1]?.waitMs === 500, 'the hold is floored to 500ms');

const args = buildCaptureRunArgs('http://preview.localhost', sc, 'demo.mp4').join(' ');
assert(args.includes(':/out'), 'MEDIA_DIR is mounted at /out');
assert(args.includes('--url http://preview.localhost'), 'the base url is passed');
assert(args.includes('--out /out/demo.mp4'), 'the output name is passed');
assert(args.includes('captureScript.mjs'), 'it runs the capture driver');
report('tests/unit/capture.test.mts');
