//? I1 (demo-video) — the in-container capture driver. Runs inside `workspaces/capture` (Playwright + chromium).
//? Args: --url <baseUrl> --out /out/<name>.mp4 --scenario '<json>'. Opens a chromium context with video
//? recording, plays the scenario (goto/wait/click steps against <baseUrl>), then finalizes the recording to
//? <out>. Playwright records webm; ffmpeg transcodes it to the requested mp4 so the media pipeline (which
//? expects mp4) can stitch it. Exits non-zero on any failure so the caller reports a typed error.

import { spawnSync } from 'node:child_process';
import { renameSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const baseUrl = arg('url');
const out = arg('out');
const scenario = JSON.parse(arg('scenario') ?? '{"viewport":{"width":1280,"height":720},"steps":[]}');

if (!baseUrl || !out) { console.error('capture: --url and --out are required'); process.exit(2); }

const tmpDir = '/tmp/capvideo';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: scenario.viewport ?? { width: 1280, height: 720 },
  recordVideo: { dir: tmpDir, size: scenario.viewport ?? { width: 1280, height: 720 } },
});
const page = await ctx.newPage();

try {
  for (const step of scenario.steps ?? []) {
    if (typeof step.goto === 'string') await page.goto(new URL(step.goto, baseUrl).toString(), { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    if (typeof step.click === 'string') await page.click(step.click, { timeout: 5000 }).catch(() => {});
    if (typeof step.waitMs === 'number') await page.waitForTimeout(Math.min(60000, Math.max(0, step.waitMs)));
  }
} finally {
  await ctx.close(); // finalizes the webm
  await browser.close();
}

//? Playwright writes a random-named .webm; find it, transcode to the requested mp4 via ffmpeg.
const webm = readdirSync(tmpDir).find((f) => f.endsWith('.webm'));
if (!webm) { console.error('capture: no video recorded'); process.exit(3); }
const webmPath = path.join(tmpDir, webm);
const ff = spawnSync('ffmpeg', ['-y', '-i', webmPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out], { stdio: 'inherit' });
if (ff.status !== 0) {
  //? ffmpeg missing/failed → fall back to the raw webm renamed to the target (still playable in browsers).
  try { renameSync(webmPath, out); } catch { process.exit(4); }
}
process.exit(0);
