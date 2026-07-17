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

//? F2 — a shared audio-mix spec: an optional background music track (ducked) + an optional sfx track mixed
//? over the voice, with per-track linear gains. Used by BOTH the slideshow (buildFfmpegPlan) and the scene
//? stitch (buildVideoStitchPlan) so "voice + music" works on every render path, not just edited scene timelines.
export interface AudioMix { musicFile?: string | null; sfxFile?: string | null; voiceVolume?: number; musicVolume?: number; sfxVolume?: number }
const MUSIC_DUCK = 0.25;
const SFX_GAIN = 0.6;

export function buildFfmpegPlan(beats: RenderBeat[], audioFile: string | null, listName: string, outName: string, format?: RenderFormat, watermark?: Watermark | null, mix?: AudioMix | null): { concatList: string; args: string[]; hasVideo: boolean } {
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

  //? F2 — voice + music/sfx mix for the slideshow path. Purely ADDITIVE: this branch only runs when a music
  //? or sfx track is present (or a non-default voice gain), so the single-voice / no-mix path below stays
  //? byte-for-byte identical (the existing render + live tests can't regress).
  const musicFile = mix?.musicFile ?? null;
  const sfxFile = mix?.sfxFile ?? null;
  const voiceVolume = mix?.voiceVolume ?? 1;
  const useMix = audioFile !== null && (musicFile !== null || sfxFile !== null || voiceVolume !== 1);
  if (useMix) {
    const mixArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', `/media/${listName}`];
    let idx = 1;
    const voiceIdx = idx++; mixArgs.push('-i', `/media/${audioFile}`);
    let musicIdx = -1; if (musicFile !== null) { musicIdx = idx++; mixArgs.push('-i', `/media/${musicFile}`); }
    let sfxIdx = -1; if (sfxFile !== null) { sfxIdx = idx++; mixArgs.push('-i', `/media/${sfxFile}`); }
    const wmIdx = watermark ? idx : -1; if (watermark) mixArgs.push('-i', `/media/${watermark.file}`);
    const tracks: AudioTrack[] = [{ label: `${String(voiceIdx)}:a`, volume: voiceVolume }];
    if (musicIdx >= 0) tracks.push({ label: `${String(musicIdx)}:a`, volume: mix?.musicVolume ?? MUSIC_DUCK });
    if (sfxIdx >= 0) tracks.push({ label: `${String(sfxIdx)}:a`, volume: mix?.sfxVolume ?? SFX_GAIN });
    const audioPlan = buildAudioMixPlan(tracks);
    const vfilter = watermark
      ? `[0:v]${scale}[bg];[bg][${String(wmIdx)}:v]overlay=${OVERLAY_XY[watermark.position ?? 'br']}[outv]`
      : `[0:v]${scale}[outv]`;
    mixArgs.push('-filter_complex', audioPlan ? `${vfilter};${audioPlan.filter}` : vfilter, '-map', '[outv]');
    if (audioPlan) mixArgs.push('-map', audioPlan.map, '-c:a', 'aac');
    mixArgs.push('-r', String(fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', `/media/${outName}`);
    return { concatList, args: mixArgs, hasVideo: usable.length > 0 };
  }

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

//? V2 — a real MULTI-CLIP video scene: a localized video clip (trimmed) OR a still (looped for its duration),
//? with an incoming transition. This is what turns "a slideshow" into a real stitched video. Pure types.
export interface RenderScene {
  videoFile: string | null;   // a localized clip under /media (preferred)
  imageFile: string | null;   // a still fallback, looped for `durationMs`
  startTrimMs: number;        // trim in-point within the source clip
  durationMs: number;         // on-timeline duration of this scene
  transitionIn: 'cut' | 'fade' | 'xfade';
  hasAudio?: boolean;         // B5 — the source clip carries an audio track (ffprobe-detected) → preserve it in the stitch
}

//? Build the ffmpeg filter_complex plan that STITCHES real scenes: each scene is normalized (trim for a clip,
//? loop for a still) to the same size/fps, then joined — a plain `concat` when every transition is a hard cut,
//? or an `xfade` chain when any scene crossfades in. Optional audio is mapped through. Pure + exported for
//? tests; the actual ffmpeg run reuses the injectable runner. Returns hasVideo:false when nothing is usable.
export function buildVideoStitchPlan(scenes: RenderScene[], audioFile: string | null, outName: string, format: RenderFormat, mix?: AudioMix | null): { args: string[]; hasVideo: boolean } {
  const usable = scenes.filter((s) => (s.videoFile ?? s.imageFile ?? '').length > 0);
  if (usable.length === 0) return { args: [], hasVideo: false };
  const { width: w, height: h, fps } = format;
  const scale = `scale=${String(w)}:${String(h)}:force_original_aspect_ratio=decrease,pad=${String(w)}:${String(h)}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const TRANSITION_S = 0.5; // crossfade length for fade/xfade scenes

  const args: string[] = ['-y'];
  //? Inputs — a still is looped + time-bounded so it becomes a clip of the right length.
  for (const s of usable) {
    const durS = (s.durationMs / 1000).toFixed(2);
    if ((s.videoFile ?? '').length > 0) args.push('-i', `/media/${String(s.videoFile)}`);
    else args.push('-loop', '1', '-t', durS, '-i', `/media/${String(s.imageFile)}`);
  }
  //? V5 audio-track — voice at `voiceVolume`, optional background music ducked at `musicVolume`. The mix
  //? branch only kicks in when there's music OR a non-default voice gain, so the single-voice path (and the
  //? live render test) is byte-for-byte unchanged.
  const musicFile = mix?.musicFile ?? null;
  const sfxFile = mix?.sfxFile ?? null;
  const voiceVolume = mix?.voiceVolume ?? 1;
  const musicVolume = mix?.musicVolume ?? MUSIC_DUCK;
  const sfxVolume = mix?.sfxVolume ?? SFX_GAIN;
  const voiceIdx = usable.length;
  const musicIdx = usable.length + (audioFile === null ? 0 : 1);
  const sfxIdx = musicIdx + (musicFile === null ? 0 : 1);
  const useMix = audioFile !== null && (musicFile !== null || sfxFile !== null || voiceVolume !== 1);
  if (audioFile !== null) args.push('-i', `/media/${audioFile}`);
  if (musicFile !== null) args.push('-i', `/media/${musicFile}`);
  if (sfxFile !== null) args.push('-i', `/media/${sfxFile}`);

  //? Normalize each scene to one uniform stream [vN] (trim a clip; scale/fps/format everything).
  const filters: string[] = [];
  for (const [i, s] of usable.entries()) {
    const parts: string[] = [`[${String(i)}:v]`];
    if ((s.videoFile ?? '').length > 0) {
      const start = (s.startTrimMs / 1000).toFixed(2);
      const end = ((s.startTrimMs + s.durationMs) / 1000).toFixed(2);
      parts.push(`trim=${start}:${end},setpts=PTS-STARTPTS,`);
    }
    parts.push(`${scale},fps=${String(fps)},format=yuv420p[v${String(i)}]`);
    filters.push(parts.join(''));
  }

  //? Join. All cuts → a single concat (cheapest, exact). Any crossfade → an xfade chain, whose `offset` is the
  //? running length of the already-composited stream minus this transition (so the fades overlap correctly).
  const anyCrossfade = usable.slice(1).some((s) => s.transitionIn !== 'cut');
  if (anyCrossfade) {
    let prev = '[v0]';
    let acc = usable[0]?.durationMs ?? 0; // ms length of the composited stream so far
    for (let i = 1; i < usable.length; i++) {
      const scene = usable[i];
      const out = i === usable.length - 1 ? '[outv]' : `[vx${String(i)}]`;
      const crossfade = scene !== undefined && scene.transitionIn !== 'cut';
      const trans = scene?.transitionIn === 'xfade' ? 'fade' : (scene?.transitionIn ?? 'fade'); // xfade filter's crossfade look
      const dur = crossfade ? TRANSITION_S : 0.001; // a hard cut = a negligible xfade so the chain stays uniform
      const offset = Math.max(0, acc / 1000 - dur);
      filters.push(`${prev}[v${String(i)}]xfade=transition=${trans}:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}${out}`);
      acc += (usable[i]?.durationMs ?? 0) - dur * 1000;
      prev = out;
    }
  } else {
    const inputs = usable.map((_, i) => `[v${String(i)}]`).join('');
    filters.push(`${inputs}concat=n=${String(usable.length)}:v=1:a=0[outv]`);
  }

  //? V5 — when mixing, run voice (+ ducked music) through buildAudioMixPlan → [aout]; else map the single
  //? voice stream as before.
  const audioTracks: AudioTrack[] = [];
  if (useMix) {
    audioTracks.push({ label: `${String(voiceIdx)}:a`, volume: voiceVolume });
    if (musicFile !== null) audioTracks.push({ label: `${String(musicIdx)}:a`, volume: musicVolume });
    if (sfxFile !== null) audioTracks.push({ label: `${String(sfxIdx)}:a`, volume: sfxVolume });
  }
  const audioPlan = useMix ? buildAudioMixPlan(audioTracks) : null;

  //? B5 — PRESERVE the uploaded clips' OWN audio when there is NO separate voiceover and at least one scene
  //? carries an audio track. Without this a stitch of uploaded videos is SILENT (only voice/music/sfx were ever
  //? mapped). Per scene: a clip WITH audio contributes its trimmed audio; a still or audio-less clip contributes
  //? matching silence — so the audio concat lines up 1:1 with the video concat. Only on the CUT path (no
  //? crossfade) where the video is a plain concat, so audio + video stay in sync. The silence sources are
  //? appended as extra lavfi inputs AFTER the real ones (their indices start past voice/music/sfx).
  const preserveClipAudio = audioFile === null && !anyCrossfade && usable.some((s) => s.hasAudio === true && (s.videoFile ?? '').length > 0);
  let clipAudioMap: string | null = null;
  if (preserveClipAudio) {
    //? Next free input index (after the video inputs + any music/sfx that a no-voice mix might have added — here
    //? audioFile is null so voice/music/sfx were only added when present; recompute the real input count).
    let nextIdx = usable.length + (musicFile === null ? 0 : 1) + (sfxFile === null ? 0 : 1);
    const aLabels: string[] = [];
    for (const [i, s] of usable.entries()) {
      if (s.hasAudio === true && (s.videoFile ?? '').length > 0) {
        const start = (s.startTrimMs / 1000).toFixed(2);
        const end = ((s.startTrimMs + s.durationMs) / 1000).toFixed(2);
        filters.push(`[${String(i)}:a]atrim=${start}:${end},asetpts=PTS-STARTPTS[ca${String(i)}]`);
        aLabels.push(`[ca${String(i)}]`);
      } else {
        //? silence of this scene's duration (a still, or a clip with no audio track)
        args.push('-f', 'lavfi', '-t', (s.durationMs / 1000).toFixed(2), '-i', 'anullsrc=r=44100:cl=stereo');
        aLabels.push(`[${String(nextIdx)}:a]`);
        nextIdx += 1;
      }
    }
    filters.push(`${aLabels.join('')}concat=n=${String(aLabels.length)}:v=0:a=1[outa]`);
    clipAudioMap = '[outa]';
  }

  const complex = audioPlan ? [...filters, audioPlan.filter].join(';') : filters.join(';');
  args.push('-filter_complex', complex, '-map', '[outv]');
  if (audioPlan) args.push('-map', audioPlan.map, '-c:a', 'aac', '-shortest');
  else if (audioFile !== null) args.push('-map', `${String(usable.length)}:a`, '-c:a', 'aac', '-shortest');
  else if (clipAudioMap !== null) args.push('-map', clipAudioMap, '-c:a', 'aac', '-shortest');
  args.push('-r', String(fps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `/media/${outName}`);
  return { args, hasVideo: true };
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

//? F2 — captions with REAL per-segment timing (from the beats' own durations, anchored to the actual voice
//? length) instead of the even split above. Each segment carries its start + duration in ms. Pure + exported.
export interface CaptionSegment { text: string; startMs: number; durationMs: number }
export function buildTimedSrt(segments: CaptionSegment[]): string {
  const segs = segments.filter((s) => s.text.trim().length > 0);
  if (segs.length === 0) return '';
  return segs.map((s, i) => `${String(i + 1)}\n${srtTime(s.startMs, ',')} --> ${srtTime(s.startMs + Math.max(1, s.durationMs), ',')}\n${s.text.trim()}\n`).join('\n');
}
export function buildTimedVtt(segments: CaptionSegment[]): string {
  const segs = segments.filter((s) => s.text.trim().length > 0);
  if (segs.length === 0) return 'WEBVTT\n';
  const cues = segs.map((s) => `${srtTime(s.startMs, '.')} --> ${srtTime(s.startMs + Math.max(1, s.durationMs), '.')}\n${s.text.trim()}`).join('\n\n');
  return `WEBVTT\n\n${cues}\n`;
}

//? F2 — parse an ffprobe `format=duration` value (seconds, e.g. "12.345000") into whole ms. Pure + exported.
//? Returns null for a non-numeric/empty probe output (→ caller falls back to the estimated timing).
export function parseFfprobeDurationMs(out: string): number | null {
  const secs = Number.parseFloat(out.trim());
  return Number.isFinite(secs) && secs > 0 ? Math.round(secs * 1000) : null;
}

//? The ffmpeg runner — runs the container with MEDIA_DIR mounted at /media. Injectable for tests.
export type FfmpegRunner = (args: string[]) => Promise<{ code: number; err: string }>;

//? Docker's `-v` host path must use forward slashes: a Windows `C:\…` path with backslashes confuses the
//? volume parser (FIX-D). The drive-letter colon is fine; on POSIX this is a no-op (no backslashes).
const dockerHostPath = (p: string): string => p.replaceAll('\\', '/');

const dockerFfmpegRunner: FfmpegRunner = (args) => docker(['run', '--rm', '-v', `${dockerHostPath(MEDIA_DIR)}:/media`, FFMPEG_IMAGE, ...args]).then((r) => ({ code: r.code, err: r.err }));

//? F2 — probe the REAL duration (ms) of a media file under MEDIA_DIR via ffprobe-in-Docker (same image as the
//? render, `--entrypoint ffprobe`). Injectable + Docker-gated: `opts.probe` overrides the transport in tests,
//? and any failure (no Docker / bad file) yields null so the caller keeps its deterministic estimate — never
//? blocks the pipeline.
export type DurationProbe = (file: string) => Promise<string | null>;
const dockerFfprobe: DurationProbe = async (file) => {
  const [err, r] = await tryCatch(() => docker(['run', '--rm', '--entrypoint', 'ffprobe', '-v', `${dockerHostPath(MEDIA_DIR)}:/media`, FFMPEG_IMAGE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', `/media/${file}`]));
  if (err || r?.code !== 0) return null;
  return r.out;
};
export async function probeDurationMs(file: string, opts: { probe?: DurationProbe } = {}): Promise<number | null> {
  const probe = opts.probe ?? dockerFfprobe;
  const out = await probe(file);
  return out === null ? null : parseFfprobeDurationMs(out);
}

//? B5 — does `file` carry an AUDIO stream? ffprobe lists audio-stream indices; a non-empty result = has audio.
//? Docker-gated + injectable; any failure yields false so the stitch stays safe (never maps a missing track).
export type AudioProbe = (file: string) => Promise<string | null>;
const dockerFfprobeAudio: AudioProbe = async (file) => {
  const [err, r] = await tryCatch(() => docker(['run', '--rm', '--entrypoint', 'ffprobe', '-v', `${dockerHostPath(MEDIA_DIR)}:/media`, FFMPEG_IMAGE, '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'default=noprint_wrappers=1:nokey=1', `/media/${file}`]));
  if (err || r?.code !== 0) return null;
  return r.out;
};
export async function probeHasAudio(file: string, opts: { probe?: AudioProbe } = {}): Promise<boolean> {
  const probe = opts.probe ?? dockerFfprobeAudio;
  const out = await probe(file);
  return typeof out === 'string' && out.trim().length > 0;
}

//? F4 — the ffmpeg args to grab ONE poster frame from a rendered mp4 (a real thumbnail for the gallery +
//? publish; a `render` asset's url is an .mp4, so an `<img src=mp4>` was a broken thumbnail). Seek a touch
//? in (`-ss 0.5`, before `-i` for a fast seek) so a black first frame doesn't become the poster. Pure +
//? exported for tests.
export function buildPosterArgs(mp4Name: string, posterName: string): string[] {
  return ['-y', '-ss', '0.5', '-i', `/media/${mp4Name}`, '-frames:v', '1', '-q:v', '3', `/media/${posterName}`];
}

//? Extract a poster frame for a rendered mp4 → its served `/media/<name>.jpg` url. Best-effort: any
//? failure (no Docker, a 0.5s-shorter clip, ffmpeg error) yields null so the render itself still succeeds.
export async function extractPoster(mp4Name: string, opts: { run?: FfmpegRunner } = {}): Promise<string | null> {
  const run = opts.run ?? dockerFfmpegRunner;
  const posterName = `${mp4Name.replace(/\.mp4$/, '')}-poster.jpg`;
  const [err, res] = await tryCatch(() => run(buildPosterArgs(mp4Name, posterName)));
  if (err || res?.code !== 0 || !existsSync(path.join(MEDIA_DIR, posterName))) return null;
  return `/media/${posterName}`;
}

//? F2 — a SECOND-pass ffmpeg that adds the sidecar captions to a finished mp4, as a separate step so the
//? load-bearing render filtergraphs are never touched (zero regression). Two modes:
//?  • 'burn' — hard-subtitle via the `subtitles=` video filter (re-encodes video; captions are baked in).
//?  • 'soft' — mux the .srt as a `mov_text` subtitle track (stream-copy video/audio; toggleable in players).
//? The subtitle path is the container-internal `/media/<srt>` (POSIX — no Windows escaping footgun). Pure +
//? exported for tests.
export function buildCaptionPassArgs(inName: string, srtName: string, outName: string, mode: 'burn' | 'soft'): string[] {
  if (mode === 'soft') {
    return ['-y', '-i', `/media/${inName}`, '-i', `/media/${srtName}`, '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'mov_text', `/media/${outName}`];
  }
  return ['-y', '-i', `/media/${inName}`, '-vf', `subtitles=/media/${srtName}`, '-c:a', 'copy', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `/media/${outName}`];
}

//? Apply captions to a rendered mp4 → the new served `/media/<name>` url. Best-effort: any failure (no Docker,
//? a bad srt) yields null so the caller keeps the un-captioned render rather than losing the video.
export async function applyCaptions(inName: string, srtName: string, mode: 'burn' | 'soft', opts: { run?: FfmpegRunner } = {}): Promise<string | null> {
  const run = opts.run ?? dockerFfmpegRunner;
  const outName = `${inName.replace(/\.mp4$/, '')}-cc.mp4`;
  const [err, res] = await tryCatch(() => run(buildCaptionPassArgs(inName, srtName, outName, mode)));
  if (err || res?.code !== 0 || !existsSync(path.join(MEDIA_DIR, outName))) return null;
  return `/media/${outName}`;
}

//? F9 — the ffmpeg args to TRIM a standalone audio asset to [startMs,endMs] + apply a linear gain (the
//? audio-editor-lite: cut a voice/music/sfx clip + adjust its level, locally, no provider cost). `atrim`
//? is sample-accurate; `asetpts=PTS-STARTPTS` re-bases the cut to 0; `volume` is a linear multiplier. Pure +
//? exported for tests.
export function buildAudioTrimArgs(inName: string, outName: string, startMs: number, endMs: number, gain = 1): string[] {
  const start = (Math.max(0, startMs) / 1000).toFixed(2);
  const end = (Math.max(startMs + 100, endMs) / 1000).toFixed(2);
  const g = Math.max(0, gain).toFixed(2);
  return ['-y', '-i', `/media/${inName}`, '-af', `atrim=${start}:${end},asetpts=PTS-STARTPTS,volume=${g}`, `/media/${outName}`];
}

//? Trim + gain a standalone audio file → the new served `/media/<name>` url. Best-effort: any failure (no
//? Docker, bad input) yields null so the caller reports a no-op instead of losing the source. Output keeps the
//? source extension (voice/music are typically .mp3).
export async function trimAudioFile(inName: string, startMs: number, endMs: number, gain: number, opts: { run?: FfmpegRunner } = {}): Promise<string | null> {
  const run = opts.run ?? dockerFfmpegRunner;
  const ext = /\.[a-z0-9]+$/i.exec(inName)?.[0] ?? '.mp3';
  const outName = `${inName.replace(/\.[^.]+$/, '')}-trim-${randomUUID().slice(0, 8)}${ext}`;
  const [err, res] = await tryCatch(() => run(buildAudioTrimArgs(inName, outName, startMs, endMs, gain)));
  if (err || res?.code !== 0 || !existsSync(path.join(MEDIA_DIR, outName))) return null;
  return `/media/${outName}`;
}

//? F3 — the ffmpeg args to grab the LAST frame of a clip (scene-continuity: this frame conditions the next
//? scene's i2v generation so consecutive clips flow together). `-sseof -0.5` seeks 0.5s before the end (before
//? `-i`, a fast seek); `-update 1 -frames:v 1` writes the single last frame. Pure + exported for tests.
export function buildLastFrameArgs(clipName: string, outName: string): string[] {
  return ['-y', '-sseof', '-0.5', '-i', `/media/${clipName}`, '-update', '1', '-frames:v', '1', '-q:v', '3', `/media/${outName}`];
}

//? Extract a clip's last frame → its served `/media/<name>.jpg` url. Best-effort: any failure (no Docker, a
//? sub-0.5s clip, ffmpeg error) yields null so continuity simply falls back to text-only prompts.
export async function extractLastFrame(clipName: string, opts: { run?: FfmpegRunner } = {}): Promise<string | null> {
  const run = opts.run ?? dockerFfmpegRunner;
  const outName = `${clipName.replace(/\.[^.]+$/, '')}-lastframe.jpg`;
  const [err, res] = await tryCatch(() => run(buildLastFrameArgs(clipName, outName)));
  if (err || res?.code !== 0 || !existsSync(path.join(MEDIA_DIR, outName))) return null;
  return `/media/${outName}`;
}

//? H1 (ads) — the ffmpeg args to overlay a CTA / end-card text band across the LAST `tailS` seconds of a
//? finished ad video (drawtext on a translucent band, bottom third). A second pass over the rendered mp4 (like
//? the caption pass) so the render filtergraphs are untouched. `text` is escaped for the drawtext filter (the
//? special chars `:%\'` break it). Pure + exported for tests.
export function buildCtaArgs(inName: string, outName: string, text: string, tailS = 3): string[] {
  const safe = text.replaceAll('\\', String.raw`\\`).replaceAll(':', String.raw`\:`).replaceAll("'", '’').replaceAll('%', String.raw`\%`);
  const enable = String.raw`gte(t\,max(0\,t)-` + `${String(tailS)})`; // last tailS seconds (approx; the band shows near the end)
  //? The ffmpeg image has DejaVu fonts but no fontconfig default config, so `drawtext` MUST get an explicit
  //? `fontfile=` (a `font=` name would fail with "Cannot load default config file"). Env-overridable.
  const font = (process.env.WS_CTA_FONT ?? '').trim() || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  //? drawbox uses ih/iw (input dims); drawtext uses h/w — `ih` is INVALID in a drawtext expression (it errors
  //? "Failed to parse expression"). So the band (drawbox) uses ih; the text (drawtext) position uses h/w.
  const draw = `drawbox=y=ih-ih/6:w=iw:h=ih/6:color=black@0.55:t=fill:enable='${enable}',drawtext=fontfile=${font}:text='${safe}':fontcolor=white:fontsize=h/18:x=(w-text_w)/2:y=h-h/12-text_h/2:enable='${enable}'`;
  return ['-y', '-i', `/media/${inName}`, '-vf', draw, '-c:a', 'copy', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `/media/${outName}`];
}

//? Gap-fix — the brand-logo watermark as a SECOND pass over the finished mp4 (like captions/CTA), so it
//? works identically for the beat-slideshow AND the scene-stitch path. Pure args + exported for tests.
export function buildWatermarkArgs(inName: string, outName: string, logoName: string, position: WatermarkPosition): string[] {
  return ['-y', '-i', `/media/${inName}`, '-i', `/media/${logoName}`, '-filter_complex', `[0:v][1:v]overlay=${OVERLAY_XY[position]}[outv]`, '-map', '[outv]', '-map', '0:a?', '-c:a', 'copy', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `/media/${outName}`];
}

//? Apply the watermark pass → the new served url; null on any failure (the clean render is kept).
export async function applyWatermark(inName: string, logoName: string, position: string, opts: { run?: FfmpegRunner } = {}): Promise<string | null> {
  const run = opts.run ?? dockerFfmpegRunner;
  const pos: WatermarkPosition = position === 'bl' || position === 'tr' || position === 'tl' ? position : 'br';
  const outName = `${inName.replace(/\.mp4$/, '')}-wm.mp4`;
  const [err, res] = await tryCatch(() => run(buildWatermarkArgs(inName, outName, logoName, pos)));
  if (err || res?.code !== 0 || !existsSync(path.join(MEDIA_DIR, outName))) return null;
  return `/media/${outName}`;
}

//? Apply a CTA end-card overlay to a rendered ad mp4 → the new served url. Best-effort: a failure keeps the
//? un-overlaid render (never loses the video).
export async function applyCtaOverlay(inName: string, text: string, opts: { run?: FfmpegRunner } = {}): Promise<string | null> {
  const run = opts.run ?? dockerFfmpegRunner;
  const outName = `${inName.replace(/\.mp4$/, '')}-cta.mp4`;
  const [err, res] = await tryCatch(() => run(buildCtaArgs(inName, outName, text)));
  if (err || res?.code !== 0 || !existsSync(path.join(MEDIA_DIR, outName))) return null;
  return `/media/${outName}`;
}

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

export interface RenderResult { ok: boolean; url?: string; storageRef?: string; posterUrl?: string; error?: string }

//? Render the timeline into a real mp4. `beats` carry an image asset URL + a duration; `voiceUrl` is the
//? optional voiceover. Localizes assets → writes the concat list → runs ffmpeg → returns the served url.
//? Typed degrade (`ok:false`) when nothing is renderable or ffmpeg/Docker fails, so assembly stubs.
export async function renderTimeline(
  input: { beats: { imageUrl: string | null; durationMs: number }[]; voiceUrl: string | null; format?: string; watermarkUrl?: string | null; watermarkPosition?: string; musicUrl?: string | null; sfxUrl?: string | null; voiceVolume?: number; musicVolume?: number; sfxVolume?: number },
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
  //? F2 — the slideshow's audio mix: voice + optional (ducked) music + optional sfx. undefined tracks ⇒ the
  //? single-voice path (unchanged). An un-localizable music/sfx url is skipped, not fatal.
  const mix: AudioMix = {
    musicFile: input.musicUrl ? await localizeAsset(input.musicUrl) : null,
    sfxFile: input.sfxUrl ? await localizeAsset(input.sfxUrl) : null,
    ...(typeof input.voiceVolume === 'number' ? { voiceVolume: input.voiceVolume } : {}),
    ...(typeof input.musicVolume === 'number' ? { musicVolume: input.musicVolume } : {}),
    ...(typeof input.sfxVolume === 'number' ? { sfxVolume: input.sfxVolume } : {}),
  };

  const id = randomUUID();
  const listName = `${id}.txt`;
  const outName = `${id}.mp4`;
  const plan = buildFfmpegPlan(beats, audioFile, listName, outName, resolveRenderFormat(input.format), watermark, mix);
  if (!plan.hasVideo) return { ok: false, error: 'render.noRenderableAssets' };

  writeFileSync(path.join(MEDIA_DIR, listName), plan.concatList);
  const [err, res] = await tryCatch(() => run(plan.args));
  if (err || res?.code !== 0) {
    const reason = err ? err.message : (res ? res.err.slice(0, 150) : 'unknown');
    return { ok: false, error: `render.ffmpegFailed: ${reason}` };
  }
  const outPath = path.join(MEDIA_DIR, outName);
  if (!existsSync(outPath)) return { ok: false, error: 'render.noOutput' };
  //? F4 — a real poster thumbnail (best-effort; null just means the gallery falls back to the icon).
  const posterUrl = await extractPoster(outName, { run });
  return { ok: true, url: `/media/${outName}`, storageRef: outPath, ...(posterUrl ? { posterUrl } : {}) };
}

//? V2 — render the multi-clip SCENE timeline into a real mp4 (the real-video path, distinct from the beat
//? slideshow). Localizes each scene's clip/still + the voiceover, stitches via buildVideoStitchPlan, runs
//? ffmpeg. Typed degrade (ok:false) when nothing is renderable or ffmpeg/Docker fails, so assembly stubs.
export async function renderScenes(
  input: { scenes: { videoUrl: string | null; imageUrl: string | null; startTrimMs: number; durationMs: number; transitionIn: string }[]; voiceUrl: string | null; format?: string; musicUrl?: string | null; sfxUrl?: string | null; voiceVolume?: number; musicVolume?: number; sfxVolume?: number },
  opts: { run?: FfmpegRunner } = {},
): Promise<RenderResult> {
  const run = opts.run ?? dockerFfmpegRunner;
  const scenes: RenderScene[] = [];
  for (const s of input.scenes) {
    const videoFile = await localizeAsset(s.videoUrl);
    //? B5 — detect whether this clip carries its own audio, so the stitch can PRESERVE it (combine uploaded
    //? videos WITH their sound) when there's no separate voiceover. Best-effort (false without Docker).
    const hasAudio = videoFile === null ? false : await probeHasAudio(videoFile);
    scenes.push({
      videoFile,
      imageFile: await localizeAsset(s.imageUrl),
      startTrimMs: Math.max(0, s.startTrimMs),
      durationMs: Math.max(200, s.durationMs),
      transitionIn: s.transitionIn === 'fade' || s.transitionIn === 'xfade' ? s.transitionIn : 'cut',
      hasAudio,
    });
  }
  const id = randomUUID();
  const outName = `${id}.mp4`;
  //? V5/F2 audio-track — thread the piece's music + sfx + per-track gains into the stitch mix (undefined ⇒ voice-only).
  const mix: AudioMix = { musicFile: await localizeAsset(input.musicUrl), sfxFile: await localizeAsset(input.sfxUrl), ...(typeof input.voiceVolume === 'number' ? { voiceVolume: input.voiceVolume } : {}), ...(typeof input.musicVolume === 'number' ? { musicVolume: input.musicVolume } : {}), ...(typeof input.sfxVolume === 'number' ? { sfxVolume: input.sfxVolume } : {}) };
  const plan = buildVideoStitchPlan(scenes, await localizeAsset(input.voiceUrl), outName, resolveRenderFormat(input.format), mix);
  if (!plan.hasVideo) return { ok: false, error: 'render.noRenderableAssets' };
  const [err, res] = await tryCatch(() => run(plan.args));
  if (err || res?.code !== 0) {
    const reason = err ? err.message : (res ? res.err.slice(0, 150) : 'unknown');
    return { ok: false, error: `render.ffmpegFailed: ${reason}` };
  }
  const outPath = path.join(MEDIA_DIR, outName);
  if (!existsSync(outPath)) return { ok: false, error: 'render.noOutput' };
  //? F4 — a real poster thumbnail (best-effort; null just means the gallery falls back to the icon).
  const posterUrl = await extractPoster(outName, { run });
  return { ok: true, url: `/media/${outName}`, storageRef: outPath, ...(posterUrl ? { posterUrl } : {}) };
}
