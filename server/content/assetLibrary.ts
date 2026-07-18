//? GAP_SCAN G4 — the workspace-wide asset library.
//?
//? Every asset was siloed under the content PIECE that produced it (`ContentAsset.contentProjectId`), so a
//? brand mascot, an intro sting or a logo lockup made for one video was invisible to the next one — and got
//? regenerated, at cost, over and over. The pieces stay the source of truth for what a piece contains; this
//? is the cross-piece VIEW plus a "starred" marker for the assets a workspace reuses on purpose.
//?
//? Pairs with C2 (documents reusing approved assets): one index, surfaced in two places.

import type { PrismaClient } from '@prisma/client';

import { tryCatch } from '@luckystack/core';

//? Which kinds are worth offering for reuse. A per-piece render or script is not a library asset — it is
//? that piece's output, and surfacing it everywhere would bury the handful of assets that ARE reusable.
export const LIBRARY_KINDS = ['image', 'thumbnail', 'avatar', 'music', 'sfx', 'voice', 'video'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export function isLibraryKind(kind: string): kind is LibraryKind {
  return (LIBRARY_KINDS as readonly string[]).includes(kind);
}

export interface LibraryAsset {
  id: string;
  kind: string;
  url: string;
  pieceId: string;
  pieceTitle: string;
  starred: boolean;
  createdAt: number;
}

//? Read an asset's `starred` marker out of its metadata blob (no schema change: the metadata column is
//? already the per-asset extension point, and a boolean does not earn a migration).
export function isStarred(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).starred === true;
}

//? The workspace's reusable assets, newest first, starred ones first. `kind` narrows to one type (the
//? document picker wants images; the composer wants music).
export async function listLibrary(
  prisma: PrismaClient, workspaceId: string, opts: { kind?: string; starredOnly?: boolean; limit?: number } = {},
): Promise<LibraryAsset[]> {
  const rows = await prisma.contentAsset.findMany({
    where: {
      workspaceId, status: 'ready', url: { not: null },
      ...(opts.kind && isLibraryKind(opts.kind) ? { kind: opts.kind } : { kind: { in: [...LIBRARY_KINDS] } }),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(opts.limit ?? 60, 200),
    select: { id: true, kind: true, url: true, contentProjectId: true, metadata: true, createdAt: true },
  });

  const pieceIds = [...new Set(rows.map((r) => r.contentProjectId))];
  const pieces = pieceIds.length > 0
    ? await prisma.contentProject.findMany({ where: { workspaceId, id: { in: pieceIds } }, select: { id: true, title: true } })
    : [];
  const titleById = new Map(pieces.map((p) => [p.id, p.title]));

  const assets = rows
    .filter((r): r is typeof r & { url: string } => typeof r.url === 'string')
    .map((r) => ({
      id: r.id, kind: r.kind, url: r.url, pieceId: r.contentProjectId,
      pieceTitle: titleById.get(r.contentProjectId) ?? '', starred: isStarred(r.metadata),
      createdAt: r.createdAt.getTime(),
    }));

  const filtered = opts.starredOnly === true ? assets.filter((a) => a.starred) : assets;
  //? Starred first, then newest: the deliberate library floats above the incidental history.
  return filtered.toSorted((a, b) => (a.starred === b.starred ? b.createdAt - a.createdAt : (a.starred ? -1 : 1)));
}

//? Star / unstar an asset — the user's own answer to "which of these do we actually reuse?".
export async function setAssetStarred(prisma: PrismaClient, workspaceId: string, assetId: string, starred: boolean): Promise<{ ok: boolean }> {
  const asset = await prisma.contentAsset.findFirst({ where: { workspaceId, id: assetId }, select: { metadata: true } });
  if (!asset) return { ok: false };
  const base = asset.metadata !== null && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata) ? { ...(asset.metadata as Record<string, unknown>) } : {};
  const next = { ...base, starred };
  const [err] = await tryCatch(() => prisma.contentAsset.updateMany({ where: { workspaceId, id: assetId }, data: { metadata: next } }));
  return { ok: !err };
}
