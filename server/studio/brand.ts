//? Central brand library (ADR 0013 G-MKT-2) — the workspace's single source of brand truth that
//? every Studio generation seeds from. One row per workspace (upserted). Pure-ish CRUD; the
//? generation reads it via `readBrandContext` (server/studio/generate.ts).

import { Prisma, type PrismaClient } from '@prisma/client';

const asJson = (v: unknown): Prisma.InputJsonValue => v ?? {};

export interface BrandLibraryInput {
  name?: string;
  palette?: { name: string; hex: string }[];
  typography?: { heading: string; body: string };
  voice?: string;
  taglines?: string[];
  logoIdeas?: string[];
}

//? Upsert the workspace brand library (partial — only provided fields change). Returns the id.
export async function saveBrandLibrary(prisma: PrismaClient, workspaceId: string, input: BrandLibraryInput): Promise<string> {
  const existing = await prisma.studioBrandLibrary.findFirst({ where: { workspaceId }, select: { id: true } });
  const data = {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.palette === undefined ? {} : { palette: asJson(input.palette) }),
    ...(input.typography === undefined ? {} : { typography: asJson(input.typography) }),
    ...(input.voice === undefined ? {} : { voice: input.voice }),
    ...(input.taglines === undefined ? {} : { taglines: input.taglines }),
    ...(input.logoIdeas === undefined ? {} : { logoIdeas: input.logoIdeas }),
  };
  if (existing) { await prisma.studioBrandLibrary.update({ where: { id: existing.id }, data }); return existing.id; }
  const created = await prisma.studioBrandLibrary.create({
    data: {
      workspaceId, name: input.name ?? 'Brand',
      palette: asJson(input.palette ?? []), typography: asJson(input.typography ?? { heading: '', body: '' }),
      voice: input.voice ?? '', taglines: input.taglines ?? [], logoIdeas: input.logoIdeas ?? [],
    },
  });
  return created.id;
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

//? R3 — parse a portable/imported brand-kit JSON into a validated BrandLibraryInput (same shape the UI + the
//? generation use). Returns null only if the blob isn't an object. Pure + exported for tests.
export function parseBrandKit(raw: unknown): BrandLibraryInput | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const palette = (Array.isArray(c.palette) ? c.palette : [])
    .map((p) => (p !== null && typeof p === 'object' ? { name: str((p as Record<string, unknown>).name), hex: str((p as Record<string, unknown>).hex) } : { name: '', hex: '' }))
    .filter((p) => p.hex.length > 0);
  const typo = c.typography !== null && typeof c.typography === 'object' ? (c.typography as Record<string, unknown>) : {};
  return { name: str(c.name) || 'Brand', palette, typography: { heading: str(typo.heading), body: str(typo.body) }, voice: str(c.voice), taglines: strArr(c.taglines), logoIdeas: strArr(c.logoIdeas) };
}

//? R3 — export the workspace brand library as a portable JSON kit (no ids/timestamps/workspaceId). null if
//? the workspace has no brand library yet.
export async function exportBrandKit(prisma: PrismaClient, workspaceId: string): Promise<BrandLibraryInput | null> {
  const lib = await prisma.studioBrandLibrary.findFirst({ where: { workspaceId } });
  if (!lib) return null;
  return parseBrandKit({ name: lib.name, palette: lib.palette, typography: lib.typography, voice: lib.voice, taglines: lib.taglines, logoIdeas: lib.logoIdeas });
}

//? R3 — import a portable brand-kit JSON into the workspace library (upsert). false if the blob is invalid.
export async function importBrandKit(prisma: PrismaClient, workspaceId: string, raw: unknown): Promise<boolean> {
  const parsed = parseBrandKit(raw);
  if (!parsed) return false;
  await saveBrandLibrary(prisma, workspaceId, parsed);
  return true;
}

//? Adopt a generated `brand` artifact's content INTO the central library (the "promote" action).
//? Returns false if the artifact isn't a usable brand kit.
export async function promoteArtifactToBrand(prisma: PrismaClient, workspaceId: string, artifactId: string): Promise<boolean> {
  const artifact = await prisma.studioArtifact.findFirst({ where: { workspaceId, id: artifactId, kind: 'brand' } });
  if (artifact?.content == null || typeof artifact.content !== 'object') return false;
  const c = artifact.content as Record<string, unknown>;
  const palette = (Array.isArray(c.palette) ? c.palette : [])
    .map((p) => (p !== null && typeof p === 'object' ? { name: str((p as Record<string, unknown>).name), hex: str((p as Record<string, unknown>).hex) } : { name: '', hex: '' }))
    .filter((p) => p.hex.length > 0);
  const typo = c.typography !== null && typeof c.typography === 'object' ? (c.typography as Record<string, unknown>) : {};
  await saveBrandLibrary(prisma, workspaceId, {
    palette, typography: { heading: str(typo.heading), body: str(typo.body) },
    voice: str(c.voice), taglines: strArr(c.taglines), logoIdeas: strArr(c.logoIdeas),
  });
  return true;
}
