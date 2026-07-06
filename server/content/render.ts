//? Real video render (M4) — composes a piece's beats (image per beat) + the voiceover into a REAL
//? `.mp4` via ffmpeg running in a Docker container (consistent with the accepted Docker-dependency), and
//? writes it to the media store so the `/media` route can stream it. No hosted render API → costCents 0.
//? When ffmpeg/Docker is unavailable OR no beat has a renderable image, it returns a typed degrade so the
//? caller (assembly) falls back to the valid-shaped stub. The ffmpeg PLAN is pure + exported for tests;
//? the Docker run is injectable.

import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { tryCatch } from '@luckystack/core';

import { docker } from '../container/runtime';
import { MEDIA_DIR, persistMediaBytes } from '../media/store';
import { withRetry } from '../util/retry';

export interface RenderBeat { imageFile: string | null; durationMs: number }

const FFMPEG_IMAGE = (process.env.WS_FFMPEG_IMAGE ?? '').trim() || 'jrottenberg/ffmpeg:latest';

//? Build the ffmpeg concat-demuxer plan for a slideshow (one image per beat, shown for its duration) +
//? an optional audio track. `imageFile`/`audioFile`/`listName`/`outName` are BARE file names served from
//? the container's mounted `/media`. The concat demuxer needs the final image repeated (its quirk) to
//? honour the last `duration`. Pure + exported for tests.
export function buildFfmpegPlan(beats: RenderBeat[], audioFile: string | null, listName: string, outName: string): { concatList: string; args: string[]; hasVideo: boolean } {
  const usable = beats.filter((b): b is { imageFile: string; durationMs: number } => typeof b.imageFile === 'string' && b.imageFile.length > 0);
  const lines: string[] = [];
  for (const b of usable) {
    lines.push(`file '${b.imageFile}'`, `duration ${(b.durationMs / 1000).toFixed(2)}`);
  }
  const last = usable.at(-1);
  if (last) lines.push(`file '${last.imageFile}'`);
  const concatList = `${lines.join('\n')}\n`;

  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', `/media/${listName}`];
  if (audioFile !== null) args.push('-i', `/media/${audioFile}`);
  args.push('-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (audioFile !== null) args.push('-c:a', 'aac', '-shortest');
  args.push(`/media/${outName}`);
  return { concatList, args, hasVideo: usable.length > 0 };
}

//? The ffmpeg runner — runs the container with MEDIA_DIR mounted at /media. Injectable for tests.
export type FfmpegRunner = (args: string[]) => Promise<{ code: number; err: string }>;

//? Docker's `-v` host path must use forward slashes: a Windows `C:\…` path with backslashes confuses the
//? volume parser (FIX-D). The drive-letter colon is fine; on POSIX this is a no-op (no backslashes).
const dockerHostPath = (p: string): string => p.replaceAll('\\', '/');

const dockerFfmpegRunner: FfmpegRunner = (args) => docker(['run', '--rm', '-v', `${dockerHostPath(MEDIA_DIR)}:/media`, FFMPEG_IMAGE, ...args]).then((r) => ({ code: r.code, err: r.err }));

//? Localize an asset URL to a bare file name under MEDIA_DIR: a `/media/<file>` path is used directly if
//? present; an http(s) URL is downloaded + persisted; a `stub://`/unknown URL is not renderable (null).
export async function localizeAsset(url: string | null | undefined): Promise<string | null> {
  if (typeof url !== 'string' || url.length === 0) return null;
  if (url.startsWith('/media/')) {
    const name = url.slice('/media/'.length);
    return existsSync(path.join(MEDIA_DIR, name)) ? name : null;
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const [err, bytes] = await tryCatch(() => withRetry(async () => {
      //? External asset host — not a framework `/api/*` route.
      // eslint-disable-next-line luckystack/no-raw-fetch-in-src
      const r = await fetch(url);
      if (!r.ok) throw new Error(`asset ${String(r.status)}`);
      return Buffer.from(await r.arrayBuffer());
    }, { attempts: 3, baseMs: 300 }));
    if (err || !bytes) return null;
    const ext = (path.extname(new URL(url).pathname) || '.bin').slice(1);
    return persistMediaBytes(bytes, ext, randomUUID()).url.slice('/media/'.length);
  }
  return null;
}

export interface RenderResult { ok: boolean; url?: string; storageRef?: string; error?: string }

//? Render the timeline into a real mp4. `beats` carry an image asset URL + a duration; `voiceUrl` is the
//? optional voiceover. Localizes assets → writes the concat list → runs ffmpeg → returns the served url.
//? Typed degrade (`ok:false`) when nothing is renderable or ffmpeg/Docker fails, so assembly stubs.
export async function renderTimeline(
  input: { beats: { imageUrl: string | null; durationMs: number }[]; voiceUrl: string | null },
  opts: { run?: FfmpegRunner } = {},
): Promise<RenderResult> {
  const run = opts.run ?? dockerFfmpegRunner;
  const beats: RenderBeat[] = [];
  for (const b of input.beats) beats.push({ imageFile: await localizeAsset(b.imageUrl), durationMs: b.durationMs });
  const audioFile = await localizeAsset(input.voiceUrl);

  const id = randomUUID();
  const listName = `${id}.txt`;
  const outName = `${id}.mp4`;
  const plan = buildFfmpegPlan(beats, audioFile, listName, outName);
  if (!plan.hasVideo) return { ok: false, error: 'render.noRenderableAssets' };

  writeFileSync(path.join(MEDIA_DIR, listName), plan.concatList);
  const [err, res] = await tryCatch(() => run(plan.args));
  if (err || res?.code !== 0) {
    const reason = err ? err.message : (res ? res.err.slice(0, 150) : 'unknown');
    return { ok: false, error: `render.ffmpegFailed: ${reason}` };
  }
  const outPath = path.join(MEDIA_DIR, outName);
  if (!existsSync(outPath)) return { ok: false, error: 'render.noOutput' };
  return { ok: true, url: `/media/${outName}`, storageRef: outPath };
}
