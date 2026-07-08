//? The cross-cutting STYLE/preset system (F0.4, ADR 0049). Every AI feature (text or media) composes a
//? generation from `feature + input + style + free-form extra instructions`. A `StylePreset` (F0.1 model)
//? is a curated system prompt; `workspaceId` null = a global default, set = a per-workspace (brand) style.
//? Resolution: the per-workspace style wins over the global default. Used by the content pipeline (F1.x)
//? to build gen requests. Tenant-scoped by explicit `workspaceId` filtering.

import type { PrismaClient } from '@prisma/client';

export interface ResolvedStyle {
  id: string;
  key: string;
  label: string;
  systemPrompt: string;
  previewAssetUrl?: string | null; // M1 — a sample asset showing the style's look (thumbnail gallery)
  previewKind?: string | null;     // M1 — 'image' | 'video'
}

//? R1 — a portable style-set entry (the user-authored, non-builtin styles a workspace has). Pure + exported.
export interface StyleSetEntry { feature: string; key: string; label: string; systemPrompt: string }

//? Parse/validate a portable style-set JSON (an array of entries). Drops malformed entries. Pure.
export function parseStyleSet(raw: unknown): StyleSetEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StyleSetEntry[] = [];
  for (const r of raw) {
    if (r === null || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    if (typeof e.feature === 'string' && typeof e.key === 'string' && typeof e.systemPrompt === 'string' && e.feature.length > 0 && e.key.length > 0) {
      out.push({ feature: e.feature, key: e.key, label: typeof e.label === 'string' && e.label.length > 0 ? e.label : e.key, systemPrompt: e.systemPrompt });
    }
  }
  return out;
}

//? Export a workspace's user-authored (non-builtin) styles as a portable set (no ids/timestamps/workspaceId).
export async function exportStyleSet(prisma: PrismaClient, workspaceId: string): Promise<StyleSetEntry[]> {
  const rows = await prisma.stylePreset.findMany({ where: { workspaceId, builtin: false }, orderBy: { createdAt: 'asc' } });
  return rows.map((s) => ({ feature: s.feature, key: s.key, label: s.label, systemPrompt: s.systemPrompt }));
}

//? Import a portable style-set into a workspace (upsert by feature+key; never touches builtin globals).
//? Returns the number of styles written. Best-effort per entry.
export async function importStyleSet(prisma: PrismaClient, workspaceId: string, raw: unknown): Promise<number> {
  const entries = parseStyleSet(raw);
  let written = 0;
  for (const e of entries) {
    const existing = await prisma.stylePreset.findFirst({ where: { workspaceId, feature: e.feature, key: e.key }, select: { id: true } });
    await (existing
      ? prisma.stylePreset.update({ where: { id: existing.id }, data: { label: e.label, systemPrompt: e.systemPrompt } })
      : prisma.stylePreset.create({ data: { workspaceId, feature: e.feature, key: e.key, label: e.label, systemPrompt: e.systemPrompt, builtin: false } }));
    written += 1;
  }
  return written;
}

//? The seeded global default styles (workspaceId=null, builtin). Keyed by `feature` string (matches an
//? AiFeature/MediaFeature). Users add per-workspace styles on top (save-style op).
const DEFAULT_STYLES: { feature: string; key: string; label: string; systemPrompt: string }[] = [
  { feature: 'image-gen', key: 'realistisch', label: 'Realistisch', systemPrompt: 'photorealistic, natural lighting, high detail, lifelike textures' },
  { feature: 'image-gen', key: 'cinematic', label: 'Cinematic', systemPrompt: 'cinematic composition, dramatic lighting, filmic color grade, shallow depth of field' },
  { feature: 'image-gen', key: 'anime', label: 'Anime', systemPrompt: 'anime illustration, clean linework, vibrant cel shading' },
  { feature: 'image-gen', key: 'low-poly', label: 'Low-poly', systemPrompt: 'low-poly 3d render, flat geometric shading, minimal palette' },
  { feature: 'reference-image', key: 'realistisch', label: 'Realistisch', systemPrompt: 'photorealistic, faithful to the reference subject, natural lighting, consistent identity' },
  { feature: 'video-gen', key: 'cinematic', label: 'Cinematic', systemPrompt: 'cinematic camera motion, filmic color grade, smooth pacing' },
  { feature: 'script', key: 'storytelling', label: 'Storytelling', systemPrompt: 'an engaging narrative voice: a strong hook, a clear arc, vivid concrete imagery' },
  { feature: 'script', key: 'corporate', label: 'Corporate', systemPrompt: 'a professional, concise, on-brand tone; benefit-led; no fluff' },
  { feature: 'tts', key: 'narrator', label: 'Narrator', systemPrompt: 'a warm documentary-narrator delivery, measured pace, clear diction' },
];

//? Seed the global default styles (idempotent — safe to call at boot or in a test).
export async function ensureDefaultStyles(prisma: PrismaClient): Promise<void> {
  for (const s of DEFAULT_STYLES) {
    const existing = await prisma.stylePreset.findFirst({ where: { workspaceId: null, feature: s.feature, key: s.key } });
    if (!existing) {
      await prisma.stylePreset.create({ data: { workspaceId: null, feature: s.feature, key: s.key, label: s.label, systemPrompt: s.systemPrompt, builtin: true } });
    }
  }
}

//? Resolve a style for a feature. A per-workspace style with the same key WINS over the global default.
//? No `styleKey` / no match → null (the caller uses the bare prompt).
export async function resolveStyle(prisma: PrismaClient, workspaceId: string, feature: string, styleKey?: string | null): Promise<ResolvedStyle | null> {
  if (!styleKey) return null;
  const ws = await prisma.stylePreset.findFirst({ where: { workspaceId, feature, key: styleKey } });
  const chosen = ws ?? await prisma.stylePreset.findFirst({ where: { workspaceId: null, feature, key: styleKey } });
  return chosen ? { id: chosen.id, key: chosen.key, label: chosen.label, systemPrompt: chosen.systemPrompt } : null;
}

//? Compose a style + free-form extra instructions into the final system prompt for a generation.
export function composeStylePrompt(style: ResolvedStyle | null, extraInstructions?: string): string {
  const parts: string[] = [];
  if (style) parts.push(style.systemPrompt);
  const extra = extraInstructions?.trim();
  if (extra) parts.push(extra);
  return parts.join('\n\n');
}

//? The styles available for a feature (global + this workspace) — for the style-picker UI (F4.2).
//? A per-workspace style shadows a global one with the same key.
export async function listStyles(prisma: PrismaClient, workspaceId: string, feature: string): Promise<ResolvedStyle[]> {
  const rows = await prisma.stylePreset.findMany({ where: { feature, OR: [{ workspaceId: null }, { workspaceId }] } });
  const byKey = new Map<string, ResolvedStyle>();
  for (const r of rows) {
    const cur = byKey.get(r.key);
    //? a per-workspace row (workspaceId set) shadows a global (null) one.
    if (!cur || r.workspaceId) byKey.set(r.key, { id: r.id, key: r.key, label: r.label, systemPrompt: r.systemPrompt, previewAssetUrl: r.previewAssetUrl, previewKind: r.previewKind });
  }
  return [...byKey.values()];
}
