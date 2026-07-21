//? GAP_SCAN F1 — the raster thumbnail studio.
//?
//? A short-form video's thumbnail is the single biggest lever on whether anyone watches it, and the product
//? shipped none: every upload used whatever frame the platform picked. This composes a real thumbnail from
//? a TEMPLATE (background + bold headline + optional logo) with an OPTIONAL AI-generated background — the
//? owner's decision was "both", so the template path works with no key and no spend, and the AI background
//? is an upgrade on top of the same composite.
//?
//? Rendering runs in the same throwaway ffmpeg tool container the rest of the media pipeline uses (no host
//? binaries, no network). The ffmpeg PLAN is pure + exported so the composition is unit-testable without
//? Docker — the same split render.ts already uses.

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { runToolContainer } from '../container/toolHarness';
import { checkMediaBudget, recordMediaSpend } from '../media/budget';
import { runMediaGeneration, estimateMediaCostCents } from '../media/registry';

import { persistMediaBytes, MEDIA_DIR } from '../media/store';

export const THUMB_IMAGE = process.env.WS_FFMPEG_IMAGE ?? 'linuxserver/ffmpeg:latest';
export const THUMB_WIDTH = 1280;
export const THUMB_HEIGHT = 720;

export interface ThumbnailSpec {
  headline: string;
  //? A file already inside the container's /data dir (the caller stages it), or none for a solid colour.
  backgroundFile?: string;
  logoFile?: string;
  //? Hex without '#'. Defaults chosen for contrast, not taste — the user's brand tokens can override.
  bgColor?: string;
  textColor?: string;
}

//? Escape a headline for ffmpeg's drawtext filter: it is a filtergraph mini-language, so a stray colon or
//? quote in a user-authored title silently breaks the whole render (or worse, changes the filter).
const BACKSLASH = String.fromCodePoint(92);

export function escapeDrawText(text: string): string {
  return text
    //? A lone backslash cannot be written as a raw template (it would escape the backtick), so name it.
    .replaceAll(BACKSLASH, BACKSLASH + BACKSLASH)
    .replaceAll(':', String.raw`\:`)
    .replaceAll("'", "’")
    .replaceAll('%', String.raw`\%`)
    .replaceAll('\n', ' ');
}

//? Wrap a headline onto at most `maxLines` lines of ~`perLine` characters. Long words are left intact —
//? breaking mid-word looks worse than a slightly long line.
export function wrapHeadline(text: string, perLine = 18, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > perLine && current.length > 0) { lines.push(current); current = word; } else { current = candidate; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current.length > 0) lines.push(current);
  return lines.slice(0, maxLines);
}

//? The pure ffmpeg argv for one thumbnail: background (image or solid colour) → scale/crop to 1280x720 →
//? one drawtext per headline line → optional logo overlay bottom-right → single JPEG frame.
export function buildThumbnailPlan(spec: ThumbnailSpec): string[] {
  const bgColor = spec.bgColor ?? '101014';
  const textColor = spec.textColor ?? 'ffffff';
  const lines = wrapHeadline(spec.headline);

  const inputs = spec.backgroundFile
    ? ['-i', `/data/${spec.backgroundFile}`]
    : ['-f', 'lavfi', '-i', `color=c=0x${bgColor}:s=${String(THUMB_WIDTH)}x${String(THUMB_HEIGHT)}`];
  const logoInput = spec.logoFile ? ['-i', `/data/${spec.logoFile}`] : [];

  //? Scale-then-crop keeps the subject centred instead of squashing a portrait source into 16:9.
  const base = `[0:v]scale=${String(THUMB_WIDTH)}:${String(THUMB_HEIGHT)}:force_original_aspect_ratio=increase,crop=${String(THUMB_WIDTH)}:${String(THUMB_HEIGHT)}`;
  //? A dark scrim under the text — white-on-bright-photo is the classic unreadable thumbnail.
  const scrim = `drawbox=x=0:y=${String(Math.round(THUMB_HEIGHT * 0.55))}:w=${String(THUMB_WIDTH)}:h=${String(Math.round(THUMB_HEIGHT * 0.45))}:color=black@0.55:t=fill`;
  const textFilters = lines.map((line, i) => {
    const y = Math.round(THUMB_HEIGHT * 0.6) + i * 90;
    return `drawtext=text='${escapeDrawText(line)}':fontcolor=0x${textColor}:fontsize=72:x=(w-text_w)/2:y=${String(y)}:box=0:shadowcolor=black@0.8:shadowx=3:shadowy=3`;
  });

  const chain = [base, scrim, ...textFilters].join(',');
  const filter = spec.logoFile
    ? `${chain}[bg];[1:v]scale=180:-1[logo];[bg][logo]overlay=W-w-40:40`
    : chain;

  return [
    THUMB_IMAGE, '-y',
    ...inputs, ...logoInput,
    '-filter_complex', filter,
    '-frames:v', '1', '-q:v', '3',
    '/data/thumb.jpg',
  ];
}

//? A `/media/<file>` URL → the bare file name we may stage into the container, or null for anything that
//? is not a local, well-formed media path (never let a URL steer a container mount).
function localMediaFile(url: string | undefined): string | null {
  if (url?.startsWith('/media/') !== true) return null;
  const name = url.slice('/media/'.length);
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : null;
}

export interface ThumbnailResult { ok: boolean; url?: string; costCents: number; aiBackground: boolean; error?: string }

//? Render a thumbnail and persist it as a media file. `backgroundPrompt` opts into an AI-generated
//? background (budget-guarded + spend-recorded, exactly like every other paid generation); without it the
//? template renders on a solid colour or a supplied background asset — free, and always available.
export async function renderThumbnail(
  prisma: PrismaClient, workspaceId: string,
  input: { headline: string; backgroundUrl?: string; logoUrl?: string; backgroundPrompt?: string; bgColor?: string; textColor?: string },
): Promise<ThumbnailResult> {
  let backgroundUrl = input.backgroundUrl;
  let costCents = 0;
  let aiBackground = false;

  if (input.backgroundPrompt && input.backgroundPrompt.trim().length > 0) {
    const budget = await checkMediaBudget(prisma, workspaceId, estimateMediaCostCents('image-gen'));
    if (!budget.ok) return { ok: false, costCents: 0, aiBackground: false, error: 'media.budgetExceeded' };
    const gen = await runMediaGeneration({ feature: 'image-gen', prompt: `YouTube thumbnail background, no text, high contrast: ${input.backgroundPrompt}`, workspaceId, label: 'Thumbnail background' });
    if (gen.ok && gen.asset) {
      backgroundUrl = gen.asset.url;
      costCents = gen.costCents;
      aiBackground = true;
      await tryCatch(() => recordMediaSpend(prisma, workspaceId, { feature: 'image-gen', providerId: gen.providerId, costCents: gen.costCents }));
    }
    //? A failed background is NOT a failed thumbnail: fall through to the template on a solid colour.
  }

  const bgName = localMediaFile(backgroundUrl);
  const logoName = localMediaFile(input.logoUrl);

  const spec: ThumbnailSpec = {
    headline: input.headline,
    ...(bgName ? { backgroundFile: bgName } : {}),
    ...(logoName ? { logoFile: logoName } : {}),
    ...(input.bgColor ? { bgColor: input.bgColor } : {}),
    ...(input.textColor ? { textColor: input.textColor } : {}),
  };

  const bytes = await runToolContainer({
    buildInput: (dir) => {
      //? Stage the referenced media INTO the container's /data (the tool container has no host mount).
      for (const name of [bgName, logoName]) {
        if (!name) continue;
        //? A referenced media file may have been pruned; a missing background degrades to the solid
        //? colour template rather than failing the render.
        const [, buf] = tryCatchSync(() => readFileSync(path.join(MEDIA_DIR, name)));
        if (buf) writeFileSync(path.join(dir, name), buf);
      }
    },
    imageAndArgs: buildThumbnailPlan(spec),
    outFile: 'thumb.jpg',
    tmpPrefix: 'ws-thumb-',
  });
  if (!bytes) return { ok: false, costCents, aiBackground, error: 'thumbnail.renderFailed' };

  const { url } = persistMediaBytes(bytes, 'jpg', randomUUID(), workspaceId);
  return { ok: true, url, costCents, aiBackground };
}

//? The platform request that ACTUALLY sets the thumbnail on a published post. YouTube has a dedicated
//? `thumbnails.set` upload; TikTok has no public cover-image endpoint (the cover is chosen at publish
//? time), so it returns null and the caller keeps the composed image as an asset only — an honest no-op
//? beats pretending it shipped.
export function buildThumbnailUploadRequest(platform: string, externalId: string, accessToken: string): { url: string; method: string; headers: Record<string, string> } | null {
  if (platform !== 'youtube' || externalId.length === 0) return null;
  return {
    url: `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(externalId)}&uploadType=media`,
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/jpeg' },
  };
}
