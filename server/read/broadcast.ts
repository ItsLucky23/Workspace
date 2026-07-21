//? Off-chain realtime broadcast — emit a ticket delta to a workspace room from server code that
//? is NOT a `_sync` route (the engine's autonomous auto-advance). Replicates the framework's
//? sync fan-out exactly: the same `"sync"` socket event + the `bulkMove` envelope the client's
//? `upsertSyncEventCallback('workspaces/bulkMove')` already merges (mergeTickets, upsert-by-id),
//? so every board in the room updates live with no refetch. Fans across instances via the Redis
//? adapter. Best-effort: no io instance (a worker process) ⇒ no-op.

import { getIoInstance, formatRoomName, socketEventNames } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { toContentAssetSummary, toContentPieceSummary, toVideoSceneSummary, toTicket } from './mappers';

//? The full route key the client keys its bulkMove callback on (the framework derives this from
//? the emitted `fullName`). Re-broadcasting a ticket already present just replaces it by id.
const BULK_MOVE_ROUTE = 'sync/workspaces/bulkMove/v1';
//? The content-asset delta route the client's `upsertSyncEventCallback('workspaces/contentAssetDelta')`
//? merges (upsert-by-id into the owning piece). Type carrier: `_sync/contentAssetDelta_server_v1.ts`.
const CONTENT_ASSET_DELTA_ROUTE = 'sync/workspaces/contentAssetDelta/v1';
//? The content-dirty nudge route: a coarse "the content slice changed" signal so EVERY client in the
//? room refetches (debounced) — covers the structural content mutations that carry no fine-grained delta
//? (piece create/advance/archive, script gen, settings). Type carrier: `_sync/contentDirty_server_v1.ts`.
const CONTENT_DIRTY_ROUTE = 'sync/workspaces/contentDirty/v1';
//? #20 — the live agent-terminal tail route: throttled PTY chunks of the CODE agent's turn, keyed by ticket.
//? Type carrier: `_sync/agentTerm_server_v1.ts`; the client's `upsertSyncEventCallback('workspaces/agentTerm')`
//? appends each chunk to that ticket's Live-agent buffer. Observability only — never authoritative state.
const AGENT_TERM_ROUTE = 'sync/workspaces/agentTerm/v1';

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

//? The per-PIECE content delta route: the client's `upsertSyncEventCallback('workspaces/contentPieceDelta')`
//? upserts the piece by id into `snap.content.pieces`. Type carrier: `_sync/contentPieceDelta_server_v1.ts`.
const CONTENT_PIECE_DELTA_ROUTE = 'sync/workspaces/contentPieceDelta/v1';

//? Broadcast ONE content piece's fresh DB state to the workspace room, so every board upserts it by id with
//? NO full refetch — the granular alternative to `broadcastContentDirty` for single-piece structural ops
//? (advance/archive/unarchive). Reads the same rows the snapshot does for a piece + assembles via the SHARED
//? `toContentPieceSummary`, so the shape matches the first-load projection exactly. Best-effort: no io ⇒ no-op.
export async function broadcastContentPieceDelta(prisma: PrismaClient, workspaceId: string, contentProjectId: string): Promise<void> {
  const io = getIoInstance();
  if (!io) return;
  const piece = await prisma.contentProject.findFirst({ where: { id: contentProjectId, workspaceId } });
  if (!piece) return;
  const assetRows = await prisma.contentAsset.findMany({ where: { workspaceId, contentProjectId }, orderBy: { createdAt: 'asc' } });
  const jobIds = assetRows.map((a) => a.mediaJobId).filter((id): id is string => typeof id === 'string' && id.length > 0);
  const jobById = new Map((jobIds.length > 0 ? await prisma.mediaJob.findMany({ where: { id: { in: jobIds } } }) : []).map((j) => [j.id, j])); // luckystack-allow tenant-scope: jobIds from this workspace's already-scoped assetRows
  const assetIds = assetRows.map((a) => a.id);
  const publishJobRows = assetIds.length > 0 ? await prisma.publishJob.findMany({ where: { workspaceId, assetId: { in: assetIds } } }) : [];
  //? Same publish-state projection the snapshot applies (publishedOn = platforms with a 'done' job; publishJobs
  //? = every job's honest status). Kept in sync with server/read/workspaceSnapshot.ts's asset loop.
  const publishedByAsset = new Map<string, string[]>();
  const jobsByAsset = new Map<string, NonNullable<ReturnType<typeof toContentAssetSummary>['publishJobs']>>();
  for (const j of publishJobRows) {
    if (j.status === 'done') { const l = publishedByAsset.get(j.assetId) ?? []; if (!l.includes(j.platform)) l.push(j.platform); publishedByAsset.set(j.assetId, l); }
    const jl = jobsByAsset.get(j.assetId) ?? [];
    jl.push({ platform: j.platform, status: j.status, ...(j.externalUrl ? { externalUrl: j.externalUrl } : {}), ...(j.scheduledAt ? { scheduledAt: j.scheduledAt.toISOString() } : {}), ...(j.error ? { error: j.error } : {}), ...(j.attempts > 0 ? { attempts: j.attempts } : {}) });
    jobsByAsset.set(j.assetId, jl);
  }
  const assets = assetRows.map((a) => {
    const summary = toContentAssetSummary(a, a.mediaJobId ? jobById.get(a.mediaJobId) : null);
    const pub = publishedByAsset.get(a.id);
    if (pub && pub.length > 0) summary.publishedOn = pub;
    const jobs = jobsByAsset.get(a.id);
    if (jobs && jobs.length > 0) summary.publishJobs = jobs;
    return summary;
  });
  const sceneRows = await prisma.videoScene.findMany({ where: { workspaceId, contentProjectId }, orderBy: { order: 'asc' } });
  const scenes = sceneRows.map((s) => toVideoSceneSummary(s));
  const spendRows = await prisma.mediaSpend.findMany({ where: { workspaceId, contentProjectId }, select: { costCents: true } });
  const spentCents = spendRows.reduce((n, s) => n + s.costCents, 0);
  const room = formatRoomName(workspaceId, { purpose: 'broadcast', userId: null });
  io.to(room).emit(socketEventNames.sync, {
    cb: CONTENT_PIECE_DELTA_ROUTE,
    fullName: CONTENT_PIECE_DELTA_ROUTE,
    serverOutput: { status: 'success', piece: toContentPieceSummary(piece, assets, scenes, spentCents) },
    clientOutput: {},
    message: `${CONTENT_PIECE_DELTA_ROUTE} sync success`,
    status: 'success',
  });
}

//? Broadcast a coarse "content changed" nudge to the whole workspace room. Fired after any content
//? control/settings op so EVERY member's client refetches (debounced) — this is what keeps structural
//? content changes (a new piece, a stage advance, an archive, a generated script, a settings edit) in
//? sync across the whole workspace, not just for the caller. The fine-grained per-asset timer state
//? still flows through `broadcastContentAssetDelta`; this is the catch-all for everything else.
//? #20 — tee a throttled chunk of the CODE agent's live PTY output to the workspace room, keyed by ticket, so
//? a "Live agent" view can tail the turn. Fire-and-forget; no io (worker) ⇒ no-op. NOT authoritative state.
export function broadcastAgentTerm(workspaceId: string, ticketKey: string, chunk: string): void {
  const io = getIoInstance();
  if (!io || chunk.length === 0) return;
  const room = formatRoomName(workspaceId, { purpose: 'broadcast', userId: null });
  io.to(room).emit(socketEventNames.sync, {
    cb: AGENT_TERM_ROUTE,
    fullName: AGENT_TERM_ROUTE,
    serverOutput: { status: 'success', ticketKey, chunk },
    clientOutput: {},
    message: `${AGENT_TERM_ROUTE} sync success`,
    status: 'success',
  });
}

export function broadcastContentDirty(workspaceId: string): void {
  const io = getIoInstance();
  if (!io) return;
  const room = formatRoomName(workspaceId, { purpose: 'broadcast', userId: null });
  io.to(room).emit(socketEventNames.sync, {
    cb: CONTENT_DIRTY_ROUTE,
    fullName: CONTENT_DIRTY_ROUTE,
    serverOutput: { status: 'success' },
    clientOutput: {},
    message: `${CONTENT_DIRTY_ROUTE} sync success`,
    status: 'success',
  });
}

//? The GENERAL workspace-dirty route: a coarse "some workspace slice changed" nudge that generalizes
//? `broadcastContentDirty` from the content slice to the WHOLE workspace. Fired once at the tail of every
//? successfully-drained PUBLIC control action (conductor.ts enqueueWriterAction), so every member's client
//? converges via a debounced refetch — this is what makes the ~25 cold settings/infra ops (projects,
//? services, environments, DBs, budget, gitlab, documents, skills, triggers, …) live-for-ALL, not just the
//? initiator, and lets every FUTURE op inherit realtime for free. Hot ticket paths carry their own targeted
//? deltas and are skipped at the choke-point (no redundant refetch during board dragging).
//? `gone` is the workspace-DELETED lifecycle signal (an in-room refetch cannot converge a workspace that
//? just vanished): other members drop the dead tenant + fall back to their picker. Type carrier:
//? `_sync/workspaceDirty_server_v1.ts`; client `upsertSyncEventCallback('workspaces/workspaceDirty')`.
const WORKSPACE_DIRTY_ROUTE = 'sync/workspaces/workspaceDirty/v1';
export function broadcastWorkspaceDirty(workspaceId: string, opts: { gone?: boolean } = {}): void {
  const io = getIoInstance();
  if (!io) return;
  const room = formatRoomName(workspaceId, { purpose: 'broadcast', userId: null });
  io.to(room).emit(socketEventNames.sync, {
    cb: WORKSPACE_DIRTY_ROUTE,
    fullName: WORKSPACE_DIRTY_ROUTE,
    serverOutput: { status: 'success', gone: opts.gone === true, workspaceId: opts.gone === true ? workspaceId : '' },
    clientOutput: {},
    message: `${WORKSPACE_DIRTY_ROUTE} sync success`,
    status: 'success',
  });
}
