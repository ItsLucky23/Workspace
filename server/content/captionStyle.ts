//? GAP_SCAN F2 — caption STYLING + word-by-word reveal + a second-language dub.
//?
//? Captions existed (burn/soft) but looked like a DVD player from 2004: ffmpeg's default white Arial with a
//? thin outline, one static line per segment. On short-form, captions are the format — bold, high-contrast,
//? word-by-word text is what holds a scroller. And the whole library was single-language: a piece that
//? worked in one market had to be regenerated from scratch for another.
//?
//? Three pure pieces here (styling args, word-timing, dub mux args) + one orchestrated dub pass. Pure so
//? the escaping and timing maths are testable without Docker — same split the rest of the render uses.

import { tryCatch } from '@luckystack/core';

import { runAiCompletion } from '../ai/registry';

export interface CaptionStyle {
  fontName?: string;
  fontSize?: number;
  //? Fill / outline as plain hex RGB ('ffffff'); converted to libass's &HBBGGRR below.
  color?: string;
  outlineColor?: string;
  outlineWidth?: number;
  //? 'box' draws an opaque band behind the text — the most readable option over busy footage.
  boxed?: boolean;
  //? 2 = bottom-centre (libass numpad alignment), 5 = middle-centre. Shorts usually want mid-screen.
  alignment?: number;
  marginV?: number;
}

//? libass wants &HBBGGRR (reversed byte order), which is the single most common way styled captions come
//? out the wrong colour.
export function toAssColor(hex: string): string {
  const clean = hex.replace('#', '').padStart(6, '0').slice(-6);
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${b}${g}${r}`.toUpperCase();
}

//? Commas separate force_style fields and quotes end the filter argument, so any value carrying one would
//? silently corrupt the style — they are stripped rather than escaped.
const cleanStyleValue = (v: string): string => v.replaceAll(',', ' ').replaceAll("'", '').trim();

//? The `force_style` payload for ffmpeg's subtitles filter. Commas separate fields, so any value carrying
//? one would silently corrupt the style — they are stripped rather than escaped (a font name with a comma
//? is not worth a broken render).
export function buildForceStyle(style: CaptionStyle): string {
  const parts = [
    `FontName=${cleanStyleValue(style.fontName ?? 'DejaVu Sans')}`,
    `FontSize=${String(style.fontSize ?? 28)}`,
    `PrimaryColour=${toAssColor(style.color ?? 'ffffff')}`,
    `OutlineColour=${toAssColor(style.outlineColor ?? '000000')}`,
    `Outline=${String(style.outlineWidth ?? 3)}`,
    `BorderStyle=${style.boxed === true ? '3' : '1'}`,
    'Bold=1',
    `Alignment=${String(style.alignment ?? 2)}`,
    `MarginV=${String(style.marginV ?? 60)}`,
  ];
  return parts.join(',');
}

//? The styled burn-in filter. Kept separate from `buildCaptionPassArgs` so the existing unstyled path is
//? untouched; callers opt in by passing a style.
export function buildStyledCaptionArgs(inName: string, srtName: string, outName: string, style: CaptionStyle): string[] {
  const forceStyle = buildForceStyle(style);
  return [
    '-y', '-i', `/media/${inName}`,
    '-vf', `subtitles=/media/${srtName}:force_style='${forceStyle}'`,
    '-c:a', 'copy', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `/media/${outName}`,
  ];
}

/* ------------------------------------------------------------------ word-by-word reveal */

export interface CaptionSegmentInput { text: string; startMs: number; durationMs: number }
export interface WordCue { text: string; startMs: number; durationMs: number }

//? Split a timed segment into per-word cues, each showing the words revealed SO FAR (the cumulative style
//? every short-form editor uses — a single word alone reads as flicker). Time is shared proportionally to
//? word length, so long words hold longer, which tracks how they are actually spoken.
export function buildWordCues(segments: CaptionSegmentInput[]): WordCue[] {
  const cues: WordCue[] = [];
  for (const seg of segments) {
    const words = seg.text.trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;
    const totalChars = words.reduce((sum, w) => sum + w.length, 0);
    let offset = 0;
    for (const [i, word] of words.entries()) {
      const share = totalChars > 0 ? word.length / totalChars : 1 / words.length;
      //? The last word absorbs any rounding drift so the cues end exactly on the segment boundary.
      const duration = i === words.length - 1 ? Math.max(1, seg.durationMs - offset) : Math.max(1, Math.round(seg.durationMs * share));
      cues.push({ text: words.slice(0, i + 1).join(' '), startMs: seg.startMs + offset, durationMs: duration });
      offset += duration;
    }
  }
  return cues;
}

/* ------------------------------------------------------------------ dubbing / localization */

//? Translate caption lines for a dub. One call for the whole script (context matters for tone), with a
//? strict line-count contract so timing survives; a mismatched answer falls back to the original rather
//? than silently desyncing the audio from the captions.
export async function translateLines(workspaceId: string, lines: string[], targetLanguage: string): Promise<{ ok: boolean; lines: string[] }> {
  const source = lines.filter((l) => l.trim().length > 0);
  if (source.length === 0) return { ok: false, lines };
  const system = [
    `You translate short-form video narration into ${targetLanguage}.`,
    'Keep each line SHORT enough to be spoken in the same time as the original.',
    `Output EXACTLY ${String(source.length)} lines, one translation per input line, no numbering, no commentary.`,
  ].join('\n');
  const [err, res] = await tryCatch(() => runAiCompletion('script', { prompt: source.join('\n'), system, workspaceId, label: `Dub → ${targetLanguage}` }));
  if (err || !res?.ok) return { ok: false, lines: source };
  const out = res.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  //? The line-count contract IS the timing guarantee — refuse a drifted answer.
  if (out.length !== source.length) return { ok: false, lines: source };
  return { ok: true, lines: out };
}

//? Mux a dubbed audio track into the finished mp4. The original audio stays as track 0 (default) and the
//? dub becomes track 1 with its language tag, so one file serves both markets instead of two renders.
export function buildDubMuxArgs(inName: string, dubAudioName: string, outName: string, language: string): string[] {
  const tag = language.toLowerCase().slice(0, 3).replaceAll(/[^a-z]/g, '') || 'und';
  return [
    '-y', '-i', `/media/${inName}`, '-i', `/media/${dubAudioName}`,
    '-map', '0:v', '-map', '0:a?', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac',
    '-metadata:s:a:1', `language=${tag}`,
    '-disposition:a:0', 'default',
    `/media/${outName}`,
  ];
}

//? GAP_SCAN F2 — narrow a stored `ContentProject.captionStyle` Json blob into a real style. Every field is
//? validated and out-of-range values are dropped rather than clamped silently, because a 400px font is far
//? more likely to be a bug than an intent. Returns null for "no style configured" (the plain ffmpeg default).
export interface StoredCaptionStyle extends CaptionStyle { wordByWord?: boolean }

const HEX = /^[\da-f]{6}$/i;

export function parseCaptionStyle(raw: unknown): StoredCaptionStyle | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string): string | undefined => (typeof o[k] === 'string' && o[k].trim().length > 0 ? o[k].trim() : undefined);
  const hex = (k: string): string | undefined => { const v = str(k)?.replace('#', ''); return v !== undefined && HEX.test(v) ? v : undefined; };
  const int = (k: string, min: number, max: number): number | undefined => {
    const v = o[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined;
  };

  const style: StoredCaptionStyle = {
    ...(str('fontName') === undefined ? {} : { fontName: str('fontName') }),
    ...(int('fontSize', 8, 120) === undefined ? {} : { fontSize: int('fontSize', 8, 120) }),
    ...(hex('color') === undefined ? {} : { color: hex('color') }),
    ...(hex('outlineColor') === undefined ? {} : { outlineColor: hex('outlineColor') }),
    ...(int('outlineWidth', 0, 10) === undefined ? {} : { outlineWidth: int('outlineWidth', 0, 10) }),
    ...(o.boxed === true ? { boxed: true } : {}),
    ...(int('alignment', 1, 9) === undefined ? {} : { alignment: int('alignment', 1, 9) }),
    ...(int('marginV', 0, 400) === undefined ? {} : { marginV: int('marginV', 0, 400) }),
    ...(o.wordByWord === true ? { wordByWord: true } : {}),
  };
  //? An object with nothing recognizable in it is "no style", not an empty style.
  return Object.keys(style).length > 0 ? style : null;
}
