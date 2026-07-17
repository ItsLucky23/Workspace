/** @docs owner ItsLucky23 */
//? INS (DOCUMENTS_AND_SKILLS) — designer inspiration import. Three paths into the design library:
//? (1) URL-capture: a throwaway headless-chromium container screenshots any site → vision-extraction
//? distills its palette/feel into a full 30-token theme PROPOSAL (saved inactive, source 'ai' — the
//? user activates it, B-23-style consent); (2) screenshot-upload: same extraction from an uploaded
//? image; (3) side-by-side compare: your page vs the inspiration → a vision difference-analysis that
//? lands as a UiReviewRequest (the existing review inbox + ui-review-to-ticket flow turns it into a
//? redesign ticket). Plus the curated STYLE GALLERY presets seeded per workspace (source 'seed').

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { tryCatch, tryCatchSync } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { docker } from '../container/runtime';
import { persistMediaBytes } from '../media/store';
import { runAiCompletion } from '../ai/registry';
import { parseTheme, type GeneratedTheme } from './generateTheme';
import { saveDesignArtifact } from './library';

const CHROME_IMAGE = (process.env.WS_EXPORT_CHROME_IMAGE ?? '').trim() || 'zenika/alpine-chrome:124';

//? Screenshot a URL in a throwaway chromium container (full-page-ish tall viewport). Networked (the
//? target is external); output lands in the media store. null on any failure — callers surface it.
export async function captureUrlScreenshot(url: string): Promise<string | null> {
  if (!/^(https?:|data:)/.test(url)) return null;
  //? Percent-encode spaces/quotes: Windows spawn quotes args with spaces and chromium mangles the
  //? embedded quotes (a data: URL test-case artifact; harmless for real http(s) URLs).
  const safeUrl = encodeURI(url).replaceAll('"', '%22');
  const dir = mkdtempSync(path.join(tmpdir(), 'ws-inspire-'));
  const [err, saved] = await tryCatch(async () => {
    const mount = `${dir.replaceAll('\\', '/')}:/data`;
    const res = await docker(['run', '--rm', '-v', mount, CHROME_IMAGE, '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,2200', '--screenshot=/data/shot.png', safeUrl]);
    if (res.code !== 0) throw new Error(`capture container exited ${String(res.code)}`);
    const bytes = readFileSync(path.join(dir, 'shot.png'));
    return persistMediaBytes(bytes, 'png', `inspire-${randomUUID().slice(0, 8)}`).url;
  });
  tryCatchSync(() => { rmSync(dir, { recursive: true, force: true }); });
  return err ? null : saved;
}

const EXTRACT_SYSTEM = [
  'You are a design-system analyst. You get a screenshot of a UI/website. Extract its VISUAL STYLE into a theme.',
  'Return ONLY a JSON object: { "name": string, "description": string (2 sentences: the look + typography/spacing/mood notes), "light": {token: color}, "dark": {token: color} }.',
  'Tokens: background, container1, container1-hover, container1-border, container2, container2-hover, container2-border, title, common, muted, disabled, overlay, focus-ring, divider, title-primary, common-primary, title-secondary, common-secondary, primary, primary-hover, primary-border, secondary, secondary-hover, secondary-border, correct, correct-hover, warning, warning-hover, wrong, wrong-hover.',
  'Derive the accent (primary) from the site\'s dominant brand color; derive surfaces/text from its neutrals; invent a coherent dark variant if the site is light-only (and vice versa). Keep contrast accessible.',
].join('\n');

//? Vision-extract a theme proposal from a screenshot (uploaded or captured). Uses the multimodal
//? 'image-critique' feature (Gemini vision by default). null = provider unavailable / parse failure.
export async function extractThemeFromScreenshot(workspaceId: string, imageUrl: string, hint = ''): Promise<GeneratedTheme | null> {
  const prompt = `Extract the visual style of this UI into a theme.${hint.trim().length > 0 ? ` Focus: ${hint.trim()}` : ''}`;
  const [err, res] = await tryCatch(() => runAiCompletion('image-critique', { prompt, system: EXTRACT_SYSTEM, imageUrls: [imageUrl], workspaceId, label: 'Inspiration → theme', timeoutMs: 180_000 }));
  if (err || !res?.ok) return null;
  return parseTheme(res.text, 'Inspiration theme');
}

//? Save an extracted theme as an INACTIVE proposal in the design library (activating it is the
//? user's explicit step — the existing setActive flow). Returns the artifact id.
export async function saveThemeProposal(prisma: PrismaClient, workspaceId: string, theme: GeneratedTheme, origin: string): Promise<string> {
  return saveDesignArtifact(prisma, workspaceId, {
    kind: 'theme', name: theme.name, description: `${theme.description}${origin ? ` (from ${origin})` : ''}`,
    content: { light: theme.light, dark: theme.dark }, source: 'ai',
  });
}

const COMPARE_SYSTEM = [
  'You are a senior UI designer. Image 1 is OUR page; image 2 is an INSPIRATION design we admire.',
  'Compare them concretely: spacing/density, typography (scale, weight, hierarchy), color usage/contrast, component styling (buttons, cards, inputs), layout structure, overall polish.',
  'Output markdown: a short verdict line, then "## Differences" with 4-8 specific bullets ("their X vs our Y"), then "## Apply to ours" with 3-6 actionable changes ranked by impact. Be specific, never generic.',
].join('\n');

//? INS3 — the side-by-side analysis. Both screenshots go to the vision model together; the result
//? lands as a UiReviewRequest so the EXISTING review inbox + ui-review-to-ticket flow drives the
//? redesign ticket. Returns the review id, or null when the provider is unavailable.
export async function compareDesigns(prisma: PrismaClient, workspaceId: string, ownUrl: string, inspirationUrl: string, createdById?: string): Promise<string | null> {
  const [err, res] = await tryCatch(() => runAiCompletion('image-critique', {
    prompt: 'Compare our page (image 1) against the inspiration (image 2).', system: COMPARE_SYSTEM,
    imageUrls: [ownUrl, inspirationUrl], workspaceId, label: 'Inspiration compare', timeoutMs: 180_000,
  }));
  if (err || !res?.ok) return null;
  const created = await prisma.uiReviewRequest.create({
    data: {
      workspaceId, page: 'inspiration-compare', screenshots: [ownUrl, inspirationUrl], problems: [],
      notes: res.text.trim().slice(0, 8000), ...(createdById ? { createdById } : {}),
    },
  });
  return created.id;
}

/* ----------------------------------------------------------------- INS4: the curated style gallery */

//? Six curated directions, expressed as PARTIAL token JSON run through parseTheme (which fills every
//? missing token from the accessible base sets) — so each preset is always a complete valid theme.
const GALLERY: { name: string; description: string; light: Record<string, string>; dark: Record<string, string> }[] = [
  { name: 'Brutalist', description: 'Raw, high-contrast, unapologetic: stark black-on-white, hard borders, a single loud accent.', light: { background: '#FFFFFF', container1: '#FFFFFF', 'container1-border': '#000000', container2: '#F0F0F0', 'container2-border': '#000000', title: '#000000', common: '#111111', muted: '#444444', divider: '#000000', primary: '#FF3B30', 'primary-hover': '#D70015', 'primary-border': '#B00010' }, dark: { background: '#000000', container1: '#0A0A0A', 'container1-border': '#FFFFFF', container2: '#141414', 'container2-border': '#FFFFFF', title: '#FFFFFF', common: '#EDEDED', muted: '#9A9A9A', divider: '#FFFFFF', primary: '#FF453A', 'primary-hover': '#FF6961', 'primary-border': '#FF3B30' } },
  { name: 'Glassmorphism', description: 'Frosted translucent layers over a colorful backdrop; soft borders, airy depth, cool blues.', light: { background: '#E8EEFF', container1: 'rgba(255,255,255,0.75)', 'container1-border': 'rgba(255,255,255,0.9)', container2: 'rgba(255,255,255,0.55)', 'container2-border': 'rgba(255,255,255,0.8)', title: '#1B2559', common: '#3B4478', muted: '#7A85B8', divider: 'rgba(255,255,255,0.7)', primary: '#5B8DEF', 'primary-hover': '#3F72E0', 'primary-border': '#2F5FC7' }, dark: { background: '#0E1330', container1: 'rgba(30,38,80,0.65)', 'container1-border': 'rgba(120,140,220,0.35)', container2: 'rgba(40,50,100,0.5)', 'container2-border': 'rgba(120,140,220,0.3)', title: '#EAEFFF', common: '#C3CCF5', muted: '#8792C9', divider: 'rgba(120,140,220,0.3)', primary: '#6E9BFF', 'primary-hover': '#8FB1FF', 'primary-border': '#4C7DF0' } },
  { name: 'Minimal', description: 'Quiet neutrals, generous whitespace, one restrained accent; the content is the interface.', light: { background: '#FAFAF9', container1: '#FFFFFF', 'container1-border': '#ECECEA', container2: '#F4F4F2', 'container2-border': '#E4E4E1', title: '#1A1A18', common: '#4A4A46', muted: '#8C8C86', divider: '#ECECEA', primary: '#2D2D2A', 'primary-hover': '#454540', 'primary-border': '#1A1A18' }, dark: { background: '#141413', container1: '#1C1C1B', 'container1-border': '#2A2A28', container2: '#232322', 'container2-border': '#323230', title: '#F2F2F0', common: '#C9C9C5', muted: '#8C8C86', divider: '#2A2A28', primary: '#E8E8E4', 'primary-hover': '#FFFFFF', 'primary-border': '#C9C9C5', 'title-primary': '#141413', 'common-primary': '#2D2D2A' } },
  { name: 'Editorial', description: 'Magazine-like: serif-friendly warm paper tones, strong typographic hierarchy, deep ink accents.', light: { background: '#FBF7F0', container1: '#FFFFFF', 'container1-border': '#E9E1D3', container2: '#F4EDE1', 'container2-border': '#E0D6C4', title: '#2B2118', common: '#4F4437', muted: '#8A7D6B', divider: '#E9E1D3', primary: '#8B2E2E', 'primary-hover': '#6E2222', 'primary-border': '#5A1B1B' }, dark: { background: '#1B1712', container1: '#242019', 'container1-border': '#373126', container2: '#2C2820', 'container2-border': '#403A2E', title: '#F3EDE2', common: '#CFC6B6', muted: '#948A78', divider: '#373126', primary: '#D96B5B', 'primary-hover': '#E4887A', 'primary-border': '#C15546' } },
  { name: 'Playful', description: 'Rounded, saturated and friendly: candy accents, soft shadows, upbeat energy.', light: { background: '#FFF8F0', container1: '#FFFFFF', 'container1-border': '#FFE3C7', container2: '#FFF1DE', 'container2-border': '#FFD9B3', title: '#3B2A4F', common: '#5D4A75', muted: '#9B8BB0', divider: '#FFE3C7', primary: '#FF6B9D', 'primary-hover': '#F04E86', 'primary-border': '#D93B72', secondary: '#7C5CFC', 'secondary-hover': '#6847E8', 'secondary-border': '#5636D1' }, dark: { background: '#1D1530', container1: '#281E40', 'container1-border': '#3B2E5C', container2: '#322650', 'container2-border': '#463768', title: '#F6F0FF', common: '#CDBFE8', muted: '#9384B8', divider: '#3B2E5C', primary: '#FF7FAC', 'primary-hover': '#FF9DC0', 'primary-border': '#F04E86', secondary: '#9C82FF', 'secondary-hover': '#B29DFF', 'secondary-border': '#7C5CFC' } },
  { name: 'Corporate', description: 'Trustworthy and composed: navy-and-slate professionalism, disciplined spacing, zero noise.', light: { background: '#F6F8FB', container1: '#FFFFFF', 'container1-border': '#DFE5EE', container2: '#EEF2F8', 'container2-border': '#D5DDE9', title: '#152238', common: '#3A4A63', muted: '#71809A', divider: '#DFE5EE', primary: '#1D4E89', 'primary-hover': '#163C6A', 'primary-border': '#102D50' }, dark: { background: '#0D1420', container1: '#131C2C', 'container1-border': '#22304A', container2: '#1A2437', 'container2-border': '#2A3A57', title: '#EAF0F9', common: '#B9C6DA', muted: '#7C8BA5', divider: '#22304A', primary: '#4C86D0', 'primary-hover': '#6B9DDD', 'primary-border': '#2F65AB' } },
];

//? Idempotent per-workspace seed of the gallery presets (source 'seed', inactive). Never overwrites
//? edits: a preset only inserts when NO seed-artifact with its name exists yet.
export async function ensureStyleGallery(prisma: PrismaClient, workspaceId: string): Promise<void> {
  const existing = await prisma.designArtifact.findMany({ where: { workspaceId, kind: 'theme', source: 'seed' }, select: { name: true } });
  const have = new Set(existing.map((a) => a.name));
  for (const preset of GALLERY.filter((p) => !have.has(p.name))) {
    //? parseTheme fills every omitted token from the accessible base sets → always a complete theme.
    const full = parseTheme(JSON.stringify(preset), preset.name);
    await prisma.designArtifact.create({ data: { workspaceId, kind: 'theme', name: full.name, description: full.description, content: { light: full.light, dark: full.dark }, source: 'seed', active: false } });
  }
}

export const GALLERY_PRESET_NAMES = GALLERY.map((g) => g.name);
