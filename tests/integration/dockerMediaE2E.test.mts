//? LIVE Docker E2E for the GAP_SCAN media work that could only be unit-tested while the engine was down:
//? the F1 thumbnail composite (ffmpeg drawtext/drawbox over a real background) and the F2 styled +
//? word-by-word caption burn-in. This runs REAL containers and writes REAL files — it proves the ffmpeg
//? argv we assemble is actually accepted by ffmpeg, which no amount of pure-function testing can.
//?
//? Skips cleanly (not fails) when Docker is unavailable, so it stays runnable on a machine without it.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { assert, eq, report } from '../_helpers.mts';

const { docker, dockerAvailable } = await import('../../server/container/runtime');
const { buildThumbnailPlan, renderThumbnail, THUMB_WIDTH, THUMB_HEIGHT } = await import('../../server/content/thumbnail');
const { buildStyledCaptionArgs, buildWordCues } = await import('../../server/content/captionStyle');
const { buildTimedSrt } = await import('../../server/content/render');
const { MEDIA_DIR, persistMediaBytes } = await import('../../server/media/store');

const available = await dockerAvailable();
if (!available) {
  console.log('[dockerMediaE2E] Docker unavailable — skipping the live media E2E.');
  report('dockerMediaE2E (skipped)');
} else {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const stamp = String(Date.now());
  const workspaceId = Date.now().toString(16).padStart(24, '0');

  /* ------------------------------------------------------------ F1: a REAL thumbnail render */

  //? No background asset → the free template path (solid colour + headline). This is the variant a user
  //? gets with no key and no spend, so it is the one that must always work.
  const thumb = await renderThumbnail({} as never, workspaceId, { headline: 'Ship it: 3 hard lessons' })
    .catch(() => ({ ok: false, url: undefined, costCents: 0, aiBackground: false, error: 'threw' }));

  assert(thumb.ok, `the template thumbnail renders in a real ffmpeg container (${thumb.error ?? ''})`);
  assert(thumb.url?.startsWith('/media/') === true, 'and is persisted as a served media file');
  eq(thumb.costCents, 0, 'the template path costs nothing');
  eq(thumb.aiBackground, false, 'and used no AI background');

  if (thumb.url) {
    const abs = path.join(MEDIA_DIR, thumb.url.slice('/media/'.length));
    assert(existsSync(abs), 'the jpg exists on disk');
    const bytes = readFileSync(abs);
    assert(bytes.length > 2000, `the jpg has real content (${String(bytes.length)} bytes)`);
    //? JPEG magic — proves ffmpeg produced an actual image, not an empty or truncated file.
    eq(bytes[0], 0xff, 'it starts with the JPEG magic byte');
    eq(bytes[1], 0xd8, 'and the second magic byte');
  }

  //? A headline full of filtergraph metacharacters must not break the render — this is the escaping
  //? contract (`escapeDrawText`) meeting real ffmpeg for the first time.
  const nasty = await renderThumbnail({} as never, workspaceId, { headline: "Time: 10:30 — 100% 'done' \\ x" })
    .catch(() => ({ ok: false, url: undefined, costCents: 0, aiBackground: false, error: 'threw' }));
  assert(nasty.ok, `a headline with colons/quotes/percent/backslash still renders (${nasty.error ?? ''})`);

  //? The plan we generate must be accepted verbatim by ffmpeg (argv shape, not just our own parsing).
  const plan = buildThumbnailPlan({ headline: 'Direct ffmpeg check' });
  const direct = await docker(['run', '--rm', '-v', `${MEDIA_DIR.replaceAll('\\', '/')}:/data`, ...plan.slice(0, 1), ...plan.slice(1).map((a) => (a === '/data/thumb.jpg' ? `/data/direct-${stamp}.jpg` : a))]);
  eq(direct.code, 0, `ffmpeg accepts the generated argv (${direct.err.slice(-200)})`);
  assert(existsSync(path.join(MEDIA_DIR, `direct-${stamp}.jpg`)), 'and writes the file we asked for');

  const probe = await docker(['run', '--rm', '-v', `${MEDIA_DIR.replaceAll('\\', '/')}:/data`, '--entrypoint', 'ffprobe', plan[0] ?? '', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', `/data/direct-${stamp}.jpg`]);
  if (probe.code === 0) eq(probe.out.trim(), `${String(THUMB_WIDTH)},${String(THUMB_HEIGHT)}`, 'the thumbnail has the right dimensions');

  /* ------------------------------------------------------------ F2: a REAL styled caption burn-in */

  //? Build a tiny source clip so the caption pass has something to burn into.
  const srcName = `cc-src-${stamp}.mp4`;
  const made = await docker(['run', '--rm', '-v', `${MEDIA_DIR.replaceAll('\\', '/')}:/data`, plan[0] ?? '', '-y', '-f', 'lavfi', '-i', 'color=c=0x223344:s=640x360:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `/data/${srcName}`]);
  eq(made.code, 0, 'a source clip is produced');

  //? The word-by-word cues become a real .srt — this is the F2 path a user gets with the toggle on.
  const cues = buildWordCues([{ text: 'hello brave new world', startMs: 0, durationMs: 1800 }]);
  eq(cues.length, 4, 'the segment split into per-word cues');
  const srt = buildTimedSrt(cues);
  assert(srt.includes('hello brave new world'), 'the final cue shows the whole line');
  const srtName = `cc-${stamp}.srt`;
  writeFileSync(path.join(MEDIA_DIR, srtName), srt, 'utf8');

  const styledArgs = buildStyledCaptionArgs(srcName, srtName, `cc-out-${stamp}.mp4`, { fontSize: 30, color: 'ffcc00', boxed: true });
  const burned = await docker(['run', '--rm', '-v', `${MEDIA_DIR.replaceAll('\\', '/')}:/media`, plan[0] ?? '', ...styledArgs]);
  eq(burned.code, 0, `ffmpeg accepts the STYLED caption filter (${burned.err.slice(-300)})`);
  const outPath = path.join(MEDIA_DIR, `cc-out-${stamp}.mp4`);
  assert(existsSync(outPath), 'the captioned mp4 exists');
  assert(readFileSync(outPath).length > 5000, 'and carries real video data');
  report('dockerMediaE2E');
}
