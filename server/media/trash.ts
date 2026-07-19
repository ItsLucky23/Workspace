//? F48 — media garbage collection, as a TRASH rather than a shredder.
//?
//? Deleting an asset row removed the row and left its bytes on disk forever: no GC existed, so a workspace
//? deleted a year ago still occupied its full media footprint. The obvious fix — unlink on delete — trades
//? one bad property for a worse one: a misclick becomes unrecoverable, and "delete workspace" turns into an
//? irreversible wipe of everything anyone in it ever made.
//?
//? So a delete TRASHES the file: the bytes stay, the UI shows how many days remain, and the user can
//? restore it or wipe it permanently on the spot. A sweep does the final unlink once the window passes.
//? That makes the destructive step either time-delayed or explicitly chosen — never a side effect.

import { existsSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';

import { tryCatch, tryCatchSync } from '@luckystack/core';

import { MEDIA_DIR } from './store';

//? How long trashed bytes are kept. Deliberately generous: disk is cheap, a lost render is not.
export const TRASH_DAYS = Math.max(1, Number(process.env.WS_MEDIA_TRASH_DAYS ?? '30'));
export const TRASH_WINDOW_MS = TRASH_DAYS * 86_400_000;

//? A `/media/<file>` url → the bare file name we may touch. Anything else (external URL, traversal
//? attempt, nested path) is refused: the trash must never be able to unlink outside the media dir.
export function trashableName(url: string): string | null {
  if (!url.startsWith('/media/')) return null;
  const name = url.slice('/media/'.length).split('?')[0] ?? '';
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) ? name : null;
}

//? Bytes one `/media/...` url occupies on disk, or 0 when it is external/missing.
function sizeOf(url: string | null): number {
  const name = url === null ? null : trashableName(url);
  if (name === null) return 0;
  const abs = path.join(MEDIA_DIR, name);
  if (!existsSync(abs)) return 0;
  const [, size] = tryCatchSync(() => statSync(abs).size);
  return size ?? 0;
}

export interface TrashInput { workspaceId: string; url: string; label: string; kind?: string; reason?: string }

//? Move a file to the trash. Idempotent per url: trashing the same file twice keeps the FIRST deadline,
//? so re-deleting something does not silently extend its life.
export async function trashMedia(prisma: PrismaClient, input: TrashInput, now = Date.now()): Promise<boolean> {
  if (trashableName(input.url) === null) return false;
  const existing = await prisma.trashedMedia.findFirst({ where: { workspaceId: input.workspaceId, url: input.url, purgedAt: null }, select: { id: true } });
  if (existing) return true;
  const [error] = await tryCatch(() => prisma.trashedMedia.create({
    data: {
      workspaceId: input.workspaceId, url: input.url, label: input.label.slice(0, 200),
      kind: input.kind ?? 'file', reason: input.reason ?? 'deleted',
      purgeAfter: new Date(now + TRASH_WINDOW_MS),
      //? Written EXPLICITLY rather than left off: on MongoDB an omitted optional field is ABSENT, and
      //? `{ purgedAt: null }` does not match an absent field — the row would be invisible to every query
      //? below. Costly to discover, trivial to prevent.
      purgedAt: null,
    },
  }));
  return !error;
}

export interface TrashEntry { id: string; url: string; label: string; kind: string; reason: string; daysLeft: number; bytes: number }

//? What the UI shows: what is in the bin and how long each item still has. `daysLeft` is rounded UP, so an
//? item with hours left reads as "1 day" rather than "0" — telling someone they have zero days left on
//? something that is still there is worse than a rounding error.
export async function listTrash(prisma: PrismaClient, workspaceId: string, now = Date.now()): Promise<TrashEntry[]> {
  const rows = await prisma.trashedMedia.findMany({
    where: { workspaceId, purgedAt: null }, orderBy: { purgeAfter: 'asc' }, take: 200,
  });
  return rows.map((r) => {
    const name = trashableName(r.url);
    const abs = name === null ? null : path.join(MEDIA_DIR, name);
    const [, stat] = tryCatchSync(() => (abs !== null && existsSync(abs) ? statSync(abs).size : 0));
    return {
      id: r.id, url: r.url, label: r.label, kind: r.kind, reason: r.reason,
      daysLeft: Math.max(0, Math.ceil((r.purgeAfter.getTime() - now) / 86_400_000)),
      bytes: stat ?? 0,
    };
  });
}

//? Take something back out of the trash: the row goes, the bytes were never touched.
export async function restoreFromTrash(prisma: PrismaClient, workspaceId: string, id: string): Promise<boolean> {
  const res = await prisma.trashedMedia.deleteMany({ where: { workspaceId, id, purgedAt: null } });
  return res.count === 1;
}

//? Unlink the bytes for one trashed item NOW. This is the explicit "delete permanently" the owner asked
//? for — the only path in the system that destroys media without waiting, and it is always a deliberate
//? click. A missing file counts as purged: the goal is "the bytes are gone", which it already is.
export async function purgeTrashItem(prisma: PrismaClient, workspaceId: string, id: string, now = Date.now()): Promise<boolean> {
  const row = await prisma.trashedMedia.findFirst({ where: { workspaceId, id, purgedAt: null }, select: { id: true, url: true } });
  if (!row) return false;
  const name = trashableName(row.url);
  if (name !== null) {
    const abs = path.join(MEDIA_DIR, name);
    if (existsSync(abs)) tryCatchSync(() => { unlinkSync(abs); });
  }
  await tryCatch(() => prisma.trashedMedia.updateMany({ where: { id: row.id }, data: { purgedAt: new Date(now) } }));
  return true;
}

//? The sweep: unlink everything whose window has passed. Bounded per run so a large backlog degrades into
//? several passes instead of one long stall.
export async function runTrashSweep(prisma: PrismaClient, now = Date.now()): Promise<{ purged: number; bytes: number }> {
  //? luckystack-allow tenant-scope: a host-wide disk sweep; every row already carries its own workspace.
  const due = await prisma.trashedMedia.findMany({
    where: { purgedAt: null, purgeAfter: { lte: new Date(now) } },
    select: { id: true, url: true, workspaceId: true }, take: 200,
  });

  let purged = 0;
  let bytes = 0;
  for (const row of due) {
    const name = trashableName(row.url);
    if (name !== null) {
      const abs = path.join(MEDIA_DIR, name);
      if (existsSync(abs)) {
        const [, size] = tryCatchSync(() => statSync(abs).size);
        const [unlinkError] = tryCatchSync(() => { unlinkSync(abs); });
        if (!unlinkError) bytes += size ?? 0;
      }
    }
    const [error] = await tryCatch(() => prisma.trashedMedia.updateMany({ where: { id: row.id }, data: { purgedAt: new Date(now) } }));
    if (!error) purged += 1;
  }
  return { purged, bytes };
}

//? F06 — storage MEASUREMENT (the owner asked for insight, not a limit). Sums the bytes a workspace's
//? assets actually occupy on disk, plus what is sitting in its trash.
export async function workspaceStorage(prisma: PrismaClient, workspaceId: string): Promise<{ liveBytes: number; trashBytes: number; files: number }> {
  const [assets, trashed] = await Promise.all([
    prisma.contentAsset.findMany({ where: { workspaceId, url: { not: null } }, select: { url: true }, take: 20_000 }),
    prisma.trashedMedia.findMany({ where: { workspaceId, purgedAt: null }, select: { url: true }, take: 5000 }),
  ]);

  let liveBytes = 0;
  let files = 0;
  for (const a of assets) {
    const size = sizeOf(a.url);
    if (size > 0) { liveBytes += size; files += 1; }
  }
  const trashBytes = trashed.reduce((sum, t) => sum + sizeOf(t.url), 0);
  return { liveBytes, trashBytes, files };
}
