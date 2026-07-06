//? Unit test for the real render pipeline (M4) — the pure ffmpeg PLAN + the media download path-safety +
//? asset localization. No Docker/DB. Verifies: the concat plan lists images with per-beat durations
//? (last repeated) + wires audio + output; no images → not renderable; the /media route rejects
//? traversal; localizeAsset classifies stub/local/empty urls.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { assert, eq, report } from '../_helpers.mts';

const { buildFfmpegPlan, localizeAsset } = await import('../../server/content/render.ts');
const { safeMediaPath } = await import('../../server/media/download.ts');
const { MEDIA_DIR } = await import('../../server/media/store.ts');

// 1) buildFfmpegPlan — images + audio
{
  const plan = buildFfmpegPlan([{ imageFile: 'a.png', durationMs: 3000 }, { imageFile: 'b.png', durationMs: 4500 }], 'voice.mp3', 'list.txt', 'out.mp4');
  assert(plan.hasVideo, 'has video with images');
  assert(plan.concatList.includes("file 'a.png'") && plan.concatList.includes('duration 3.00'), 'beat 1 image + duration');
  assert(plan.concatList.includes('duration 4.50'), 'beat 2 duration');
  eq((plan.concatList.match(/file 'b.png'/g) ?? []).length, 2, 'last image repeated (concat demuxer quirk)');
  assert(plan.args.includes('/media/voice.mp3') && plan.args.includes('-shortest'), 'audio wired + -shortest');
  assert(plan.args.at(-1) === '/media/out.mp4', 'output is the last arg');
  assert(plan.args.includes('-c:v') && plan.args.includes('libx264'), 'encodes h264');
}

// 2) buildFfmpegPlan — no renderable images
{
  const plan = buildFfmpegPlan([{ imageFile: null, durationMs: 3000 }], null, 'l.txt', 'o.mp4');
  assert(!plan.hasVideo, 'no images → not renderable');
  assert(!plan.args.includes('-shortest'), 'no audio → no -shortest');
}

// 3) safeMediaPath — valid vs traversal
{
  assert(safeMediaPath('/media/abc-123.mp4') === path.join(MEDIA_DIR, 'abc-123.mp4'), 'valid file → path under MEDIA_DIR');
  eq(safeMediaPath('/media/../secret'), null, 'traversal (..) rejected');
  eq(safeMediaPath('/media/sub/dir.mp4'), null, 'nested path rejected');
  eq(safeMediaPath('/media/'), null, 'empty name rejected');
  eq(safeMediaPath('/other/x.mp4'), null, 'non-/media prefix rejected');
}

// 4) localizeAsset — stub/empty → null; a real /media file → its name
{
  eq(await localizeAsset('stub://image/x'), null, 'stub:// → null (not renderable)');
  eq(await localizeAsset(null), null, 'null → null');
  eq(await localizeAsset('/media/does-not-exist.png'), null, 'missing /media file → null');
  mkdirSync(MEDIA_DIR, { recursive: true });
  const name = 'render-test-fixture.png';
  writeFileSync(path.join(MEDIA_DIR, name), 'x');
  try {
    eq(await localizeAsset(`/media/${name}`), name, 'existing /media file → its bare name');
  } finally {
    rmSync(path.join(MEDIA_DIR, name), { force: true });
  }
}

report('tests/unit/render.test.mts');
