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

//? O1 — export format presets. Aspect drives the scale/pad target; `9:16` is the vertical TikTok/Shorts/Reels
//? format, `1:1` the square feed format, `16:9` the default landscape. fps is per-preset. Pure + exported.
export type RenderFormatKey = '16:9' | '9:16' | '1:1';
export interface RenderFormat { key: RenderFormatKey; width: number; height: number; fps: number }
const FORMAT_PRESETS: Record<RenderFormatKey, RenderFormat> = {
  '16:9': { key: '16:9', width: 1280, height: 720, fps: 30 },
  '9:16': { key: '9:16', width: 720, height: 1280, fps: 30 },
  '1:1': { key: '1:1', width: 1080, height: 1080, fps: 30 },
};
export function resolveRenderFormat(key: string | null | undefined): RenderFormat {
  return key === '9:16' || key === '1:1' || key === '16:9' ? FORMAT_PRESETS[key] : FORMAT_PRESETS['16:9'];
}

//? Build the ffmpeg concat-demuxer plan for a slideshow (one image per beat, shown for its duration) +
//? an optional audio track. `imageFile`/`audioFile`/`listName`/`outName` are BARE file names served from
//? the container's mounted `/media`. The concat demuxer needs the final image repeated (its quirk) to
//? honour the last `duration`. Pure + exported for tests.
//? O4 — an optional logo watermark overlaid on the render. `file` is a bare name under /media; `position` is
//? a corner (default bottom-right) with a 24px margin.
export type WatermarkPosition = 'br' | 'bl' | 'tr' | 'tl';
export interface Watermark { file: string; position?: WatermarkPosition }
const OVERLAY_XY: Record<WatermarkPosition, string> = { br: 'W-w-24:H-h-24', bl: '24:H-h-24', tr: 'W-w-24:24', tl: '24:24' };

export function buildFfmpegPlan(beats: RenderBeat[], audioFile: string | null, listName: string, outName: string, format?: RenderFormat, watermark?: Watermark | null): { concatList: string; args: string[]; hasVideo: boolean } {
  const fmt = format ?? FORMAT_PRESETS['16:9'];
  const usable = beats.filter((b): b is { imageFile: string; durationMs: number } => typeof b.imageFile === 'string' && b.imageFile.length > 0);
  const lines: string[] = [];
  for (const b of usable) {
    lines.push(`file '${b.imageFile}'`, `duration ${(b.durationMs / 1000).toFixed(2)}`);
  }
  const last = usable.at(-1);
  if (last) lines.push(`file '${last.imageFile}'`);
  const concatList = `${lines.join('\n')}\n`;

  const { width: w, height: h, fps } = fmt;
  const scale = `scale=${String(w)}:${String(h)}:force_original_aspect_ratio=decrease,pad=${String(w)}:${String(h)}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', `/media/${listName}`];
  if (audioFile !== null) args.push('-i', `/media/${audioFile}`);
  if (watermark) {
    //? The watermark is the LAST input; overlay it on the scaled video via filter_complex + explicit maps.
    args.push('-i', `/media/${watermark.file}`);
    const wmIndex = audioFile === null ? 1 : 2;
    const xy = OVERLAY_XY[watermark.position ?? 'br'];
    args.push('-filter_complex', `[0:v]${scale}[bg];[bg][${String(wmIndex)}:v]overlay=${xy}[outv]`, '-map', '[outv]');
    if (audioFile !== null) args.push('-map', '1:a');
  } else {
    args.push('-vf', scale);
  }
  args.push('-r', String(fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (audioFile !== null) args.push('-c:a', 'aac', '-shortest');
  args.push(`/media/${outName}`);
  return { concatList, args, hasVideo: usable.length > 0 };
}

//? E4 — an audio track to mix. `label` is the ffmpeg input specifier (e.g. '0:a'); `volume` is the linear gain
//? (voice ~1, music ducked ~0.25, sfx ~0.6). `trimMs` optionally clips the input to its first N ms.
export interface AudioTrack { label: string; volume: number; trimMs?: number }

//? Build the ffmpeg `-filter_complex` that mixes N tracks (per-track volume + optional trim) into one output
//? stream `[aout]` via `amix` (duration=longest). This is how voice + music (ducked) + sfx become one mixed
//? track the render consumes. Pure + exported for tests. Returns null for an empty track list.
export function buildAudioMixPlan(tracks: AudioTrack[]): { filter: string; map: string } | null {
  if (tracks.length === 0) return null;
  const stages: string[] = [];
  const mixInputs: string[] = [];
  for (const [i, t] of tracks.entries()) {
    const out = `a${String(i)}`;
    const parts = [`[${t.label}]`];
    if (typeof t.trimMs === 'number' && t.trimMs > 0) parts.push(`atrim=0:${(t.trimMs / 1000).toFixed(2)},asetpts=PTS-STARTPTS`);
    parts.push(`volume=${Math.max(0, t.volume).toFixed(2)}`);
    stages.push(`${parts.join('')}[${out}]`);
    mixInputs.push(`[${out}]`);
  }
  stages.push(`${mixInputs.join('')}amix=inputs=${String(tracks.length)}:duration=longest:dropout_transition=0[aout]`);
  return { filter: stages.join(';'), map: '[aout]' };
}

//? O1 — emit .srt / .vtt captions from the piece's caption LINES (which carry no per-line timing) by
//? distributing them evenly across the total duration. Pure + exported for tests.
const pad2 = (n: number, w = 2): string => String(n).padStart(w, '0');
function srtTime(ms: number, sep: string): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const msPart = clamped % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}${sep}${pad2(msPart, 3)}`;
}
export function buildSrt(captions: string[], totalMs: number): string {
  const lines = captions.map((c) => c.trim()).filter((c) => c.length > 0);
  if (lines.length === 0) return '';
  const slot = Math.max(1, Math.floor(totalMs / lines.length));
  return lines.map((text, i) => `${String(i + 1)}\n${srtTime(i * slot, ',')} --> ${srtTime((i + 1) * slot, ',')}\n${text}\n`).join('\n');
}
export function buildVtt(captions: string[], totalMs: number): string {
  const lines = captions.map((c) => c.trim()).filter((c) => c.length > 0);
  if (lines.length === 0) return 'WEBVTT\n';
  const slot = Math.max(1, Math.floor(totalMs / lines.length));
  const cues = lines.map((text, i) => `${srtTime(i * slot, '.')} --> ${srtTime((i + 1) * slot, '.')}\n${text}`).join('\n\n');
  return `WEBVTT\n\n${cues}\n`;
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
  input: { beats: { imageUrl: string | null; durationMs: number }[]; voiceUrl: string | null; format?: string; watermarkUrl?: string | null; watermarkPosition?: string },
  opts: { run?: FfmpegRunner } = {},
): Promise<RenderResult> {
  const run = opts.run ?? dockerFfmpegRunner;
  const beats: RenderBeat[] = [];
  for (const b of input.beats) beats.push({ imageFile: await localizeAsset(b.imageUrl), durationMs: b.durationMs });
  const audioFile = await localizeAsset(input.voiceUrl);
  //? O4 — a localizable brand logo becomes a watermark; an un-localizable url is simply skipped (no watermark).
  const wmFile = input.watermarkUrl ? await localizeAsset(input.watermarkUrl) : null;
  const pos = input.watermarkPosition;
  const watermark: Watermark | null = wmFile ? { file: wmFile, position: pos === 'bl' || pos === 'tr' || pos === 'tl' ? pos : 'br' } : null;

  const id = randomUUID();
  const listName = `${id}.txt`;
  const outName = `${id}.mp4`;
  const plan = buildFfmpegPlan(beats, audioFile, listName, outName, resolveRenderFormat(input.format), watermark);
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
