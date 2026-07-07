//? Off-chain realtime broadcast — emit a ticket delta to a workspace room from server code that
//? is NOT a `_sync` route (the engine's autonomous auto-advance). Replicates the framework's
//? sync fan-out exactly: the same `"sync"` socket event + the `bulkMove` envelope the client's
//? `upsertSyncEventCallback('workspaces/bulkMove')` already merges (mergeTickets, upsert-by-id),
//? so every board in the room updates live with no refetch. Fans across instances via the Redis
//? adapter. Best-effort: no io instance (a worker process) ⇒ no-op.

import { getIoInstance, formatRoomName, socketEventNames } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { toContentAssetSummary, toTicket } from './mappers';

//? The full route key the client keys its bulkMove callback on (the framework derives this from
//? the emitted `fullName`). Re-broadcasting a ticket already present just replaces it by id.
const BULK_MOVE_ROUTE = 'sync/workspaces/bulkMove/v1';
//? The content-asset delta route the client's `upsertSyncEventCallback('workspaces/contentAssetDelta')`
//? merges (upsert-by-id into the owning piece). Type carrier: `_sync/contentAssetDelta_server_v1.ts`.
const CONTENT_ASSET_DELTA_ROUTE = 'sync/workspaces/contentAssetDelta/v1';

//? Broadcast the current DB state of the given ticket keys to the workspace room.
export async function broadcastTicketDelta(prisma: PrismaClient, workspaceId: string, ticketKeys: string[]): Promise<void> {
  const io = getIoInstance();
  if (!io || ticketKeys.length === 0) return;
  const rows = await prisma.ticket.findMany({ where: { workspaceId, key: { in: ticketKeys } } });
  if (rows.length === 0) return;
  const room = formatRoomName(workspaceId, { purpose: 'broadcast', userId: null });
  io.to(room).emit(socketEventNames.sync, {
    cb: BULK_MOVE_ROUTE,
    fullName: BULK_MOVE_ROUTE,
    serverOutput: { status: 'success', tickets: rows.map((t) => toTicket(t)) },
    clientOutput: {},
    message: `${BULK_MOVE_ROUTE} sync success`,
    status: 'success',
  });
}

//? Broadcast the current DB state of ONE content asset (its live queue/timer status) to the
//? workspace room, so every open content-piece view upserts it by id with no refetch. Called
//? mid-generation from the Conductor's media path (queued → running → done). Joins the asset's
//? MediaJob for the queuePosition/startedAt the UI needs. Best-effort: no io ⇒ no-op.
export async function broadcastContentAssetDelta(prisma: PrismaClient, workspaceId: string, contentProjectId: string, assetId: string): Promise<void> {
  const io = getIoInstance();
  if (!io) return;
  const asset = await prisma.contentAsset.findFirst({ where: { id: assetId, workspaceId } });
  if (!asset) return;
  const job = asset.mediaJobId ? await prisma.mediaJob.findUnique({ where: { id: asset.mediaJobId } }) : null;
  const room = formatRoomName(workspaceId, { purpose: 'broadcast', userId: null });
  io.to(room).emit(socketEventNames.sync, {
    cb: CONTENT_ASSET_DELTA_ROUTE,
    fullName: CONTENT_ASSET_DELTA_ROUTE,
    serverOutput: { status: 'success', contentProjectId, asset: toContentAssetSummary(asset, job) },
    clientOutput: {},
    message: `${CONTENT_ASSET_DELTA_ROUTE} sync success`,
    status: 'success',
  });
}
