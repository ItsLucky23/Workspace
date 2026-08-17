//? Owner decision 6 — "Use as brand" before/after diff. Mirrors EXACTLY the fields
//? server/../_api/studioBrand_v1.ts's `op:'promote'` branch overwrites (palette, typography, voice,
//? taglines, logoIdeas — `name` is always retained from the current library, never touched), so this
//? confirm can never claim a change the server won't actually make.

import type { StudioBrandLibrary } from '../../_data/types';

function asRecord(v: unknown): Record<string, unknown> { return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}; }
function asStr(v: unknown): string { return typeof v === 'string' ? v : ''; }
function asStrArr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }

export type BrandDiffField = 'palette' | 'typography' | 'voice' | 'taglines' | 'logoIdeas';
export interface BrandDiffRow { field: BrandDiffField; before: string; after: string; changed: boolean }

function summarizePalette(p: { name: string; hex: string }[]): string {
  return p.map((c) => c.hex || c.name).join(', ');
}
function summarizeList(items: string[]): string {
  return items.length > 0 ? `${String(items.length)} — ${items.join(' · ')}` : '';
}

/** Build the before/after rows for a promote confirm. `current` is the workspace's live Brand
 *  Library (before); `artifactContent` is a ready `brand`-kind StudioArtifact's `content` (after). */
export function buildBrandDiff(current: StudioBrandLibrary | null, artifactContent: unknown): BrandDiffRow[] {
  const c = asRecord(artifactContent);
  const nextPalette = Array.isArray(c.palette) ? c.palette.map((x) => { const r = asRecord(x); return { name: asStr(r.name), hex: asStr(r.hex) }; }) : [];
  const nextTypo = asRecord(c.typography);
  const nextVoice = asStr(c.voice);
  const nextTaglines = asStrArr(c.taglines);
  const nextLogoIdeas = asStrArr(c.logoIdeas);

  const beforePalette = current?.palette ?? [];
  const beforeTypo = current?.typography ?? { heading: '', body: '' };
  const beforeVoice = current?.voice ?? '';
  const beforeTaglines = current?.taglines ?? [];
  const beforeLogoIdeas = current?.logoIdeas ?? [];

  const beforePaletteStr = summarizePalette(beforePalette);
  const afterPaletteStr = summarizePalette(nextPalette);
  const beforeTypoStr = `${beforeTypo.heading || '?'} / ${beforeTypo.body || '?'}`;
  const afterTypoStr = `${asStr(nextTypo.heading) || '?'} / ${asStr(nextTypo.body) || '?'}`;
  const beforeTaglinesStr = summarizeList(beforeTaglines);
  const afterTaglinesStr = summarizeList(nextTaglines);
  const beforeLogoStr = summarizeList(beforeLogoIdeas);
  const afterLogoStr = summarizeList(nextLogoIdeas);

  return [
    { field: 'palette', before: beforePaletteStr, after: afterPaletteStr, changed: beforePaletteStr !== afterPaletteStr },
    { field: 'typography', before: beforeTypoStr, after: afterTypoStr, changed: beforeTypoStr !== afterTypoStr },
    { field: 'voice', before: beforeVoice, after: nextVoice, changed: beforeVoice.trim() !== nextVoice.trim() },
    { field: 'taglines', before: beforeTaglinesStr, after: afterTaglinesStr, changed: beforeTaglinesStr !== afterTaglinesStr },
    { field: 'logoIdeas', before: beforeLogoStr, after: afterLogoStr, changed: beforeLogoStr !== afterLogoStr },
  ];
}
