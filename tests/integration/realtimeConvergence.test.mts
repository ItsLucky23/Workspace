//? Realtime convergence — every small write is live for EVERY member of a workspace room, not just the
//? initiator (the "make it a true realtime experience" pass).
//?
//? The architecture already broadcast targeted deltas for the hot paths (tickets, content) and kept every
//? client in one workspace room for its whole session. The gap was ~25 COLD settings/infra ops that ended in
//? `syncRequest(...).then(refetch())` with no room broadcast — only the initiator converged; every other
//? member stayed stale until a manual reload. This pins the general fix:
//?   P1 — one coarse `broadcastWorkspaceDirty` at the single PUBLIC-writer drain choke-point → every member
//?        debounce-refetches. Hot ticket paths are SKIPPED (they carry their own targeted delta) so board
//?        dragging never triggers a redundant full refetch.
//?   P2 — a `gone` lifecycle payload evicts OTHER members of a just-deleted workspace (an in-room refetch
//?        cannot converge a workspace that no longer exists).
//?   P4 — the optimistic AI-move `stageOverrides` is reconciled against the authoritative ticket delta, so
//?        two users can't diverge on the same ticket's column.

import { readFileSync } from 'node:fs';

import { assert, report } from '../_helpers.mts';
import { broadcastWorkspaceDirty } from '../../server/read/broadcast.ts';

const read = (p: string): string => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------ the broadcast primitive is a safe no-op sans io */

//? Best-effort by design: in a worker/test process with no io instance it must NEVER throw (mirrors every
//? other broadcast in server/read/broadcast.ts). Both the plain and the `gone` shapes.
broadcastWorkspaceDirty('000000000000000000a49001');
broadcastWorkspaceDirty('000000000000000000a49001', { gone: true });
assert(true, 'broadcastWorkspaceDirty is a no-op (never throws) without an io instance');

/* ------------------------------------------------------------ the broadcast targets the general dirty route */

const broadcast = read('server/read/broadcast.ts');
assert(broadcast.includes('export function broadcastWorkspaceDirty'), 'the general workspace-dirty primitive exists');
assert(broadcast.includes("'sync/workspaces/workspaceDirty/v1'"), 'it emits on the workspaceDirty route the client listens on');
assert(broadcast.includes('gone: opts.gone === true'), 'it carries the gone lifecycle flag');
//? A broadcast-only carrier must exist so the route + serverOutput shape are in the generated type maps.
const carrier = read('src/workspaces/_sync/workspaceDirty_server_v1.ts');
assert(carrier.includes('gone: goneFlag()') && carrier.includes('workspaceId: goneWorkspaceId()'), 'the carrier types the gone/workspaceId payload for the client callback');

/* ------------------------------------------------------------ fired once at the PUBLIC-writer drain, ticket ops skipped */

const conductor = read('server/orchestrator/conductor.ts');
assert(conductor.includes('broadcastWorkspaceDirty') && conductor.includes("from '../read/broadcast'"), 'the conductor imports the primitive');
assert(conductor.includes("writerKind === 'public' && action.workspaceId && !WORKSPACE_DIRTY_SKIP.has(action.op)"), 'it fires ONLY for successfully drained PUBLIC control writes, gated by the skip set');
//? The skip set = the high-churn ticket ops that already push a targeted delta (else board dragging would
//? trigger a redundant full refetch), plus delete-workspace (handled by its own gone broadcast).
for (const op of ['quick-add', 'ticket-edit', 'bulk-move', 'answer-input', 'delete-workspace']) {
  assert(conductor.includes(`'${op}'`), `WORKSPACE_DIRTY_SKIP skips the hot/lifecycle op ${op}`);
}
//? A representative COLD op must NOT be skipped — it relies on workspaceDirty to reach other members.
const skipStart = conductor.indexOf('const WORKSPACE_DIRTY_SKIP = new Set<string>([');
assert(skipStart !== -1, 'the skip set is declared where the guard expects (else this check is vacuous)');
const skipList = conductor.slice(skipStart, conductor.indexOf(']', skipStart));
assert(skipList.length > 0 && skipList.includes("'quick-add'"), 'the skip-set slice is non-empty (guard is real)');
assert(!skipList.includes("'project-create'") && !skipList.includes("'save-env'"), 'cold settings/infra ops are NOT skipped — they converge via workspaceDirty');
//? P2 — delete-workspace fires the explicit gone eviction after the cascade.
assert(conductor.includes('broadcastWorkspaceDirty(action.workspaceId, { gone: true })'), 'delete-workspace emits the gone eviction signal');

/* ------------------------------------------------------------ the client converges (debounced) + evicts on gone */

const provider = read('src/workspaces/_shell/WorkspacesProvider.tsx');
assert(provider.includes("name: 'workspaces/workspaceDirty'"), 'the client listens for the general dirty nudge');
//? It reuses the SAME debounce timer as contentDirty so a burst of mixed writes coalesces into one refetch.
const dirtyCb = provider.slice(provider.indexOf("name: 'workspaces/workspaceDirty'"));
assert(dirtyCb.slice(0, 800).includes('dirtyTimer.current = setTimeout(() => { refetch(); }, 400)'), 'a plain nudge debounce-refetches (coalesced with contentDirty)');
assert(dirtyCb.slice(0, 800).includes('if (serverOutput.gone)'), 'a gone nudge takes the eviction branch');
assert(dirtyCb.slice(0, 800).includes('setWantWorkspaceId(undefined)'), 'the gone branch drops the dead workspace target so the refetch falls back to the picker');

/* ------------------------------------------------------------ P4 — the optimistic override is reconciled */

assert(provider.includes('const ticket = snap.tickets.find((t) => t.id === id);') && provider.includes('ticket?.stageId === stage'), 'stageOverrides drops once the authoritative ticket stageId matches');
//? It must react to incoming ticket deltas (snap.tickets), not just local moves.
const p4 = provider.slice(provider.indexOf('setStageOverrides((prev) => {'));
assert(p4.slice(0, 600).includes('[snap.tickets]'), 'the reconcile effect runs on every incoming ticket delta');

/* ------------------------------------------------------------ P7 — granular per-piece content delta */

//? Single-piece structural content ops (advance/archive/unarchive) push ONE fresh piece the client upserts by
//? id, instead of the coarse contentDirty full refetch. The shape must come from the SAME mapper as the
//? snapshot, or a live upsert would diverge from the first-load projection.
const mappers = read('server/read/mappers.ts');
const snapshotSrc = read('server/read/workspaceSnapshot.ts');
assert(mappers.includes('export function toContentPieceSummary') && mappers.includes('export function toVideoSceneSummary'), 'the piece + scene mappers are extracted (shared by snapshot AND the delta)');
assert(snapshotSrc.includes('toContentPieceSummary(c,'), 'the snapshot assembles pieces via the shared mapper (no inline shape that could drift)');
assert(broadcast.includes('export async function broadcastContentPieceDelta') && broadcast.includes('toContentPieceSummary(piece,'), 'broadcastContentPieceDelta assembles via the SAME shared mapper');
assert(broadcast.includes("'sync/workspaces/contentPieceDelta/v1'"), 'it emits on the per-piece route');
const pieceCarrier = read('src/workspaces/_sync/contentPieceDelta_server_v1.ts');
assert(pieceCarrier.includes('ContentPieceSummary') && pieceCarrier.includes('piece: contentPieceDeltaPiece()'), 'the carrier types the piece payload for the client callback');
//? Client upserts the piece by id (idempotent — re-delivery safe).
const pieceCb = provider.slice(provider.indexOf("name: 'workspaces/contentPieceDelta'"));
assert(pieceCb.length > 0 && pieceCb.slice(0, 700).includes('s.content.pieces.some((p) => p.id === piece.id)'), 'the client upserts the piece by id into snap.content.pieces');
//? The Conductor fires the delta after apply for the 3 single-piece ops; the route skips contentDirty for them.
for (const op of ['content-advance', 'content-archive', 'content-unarchive']) {
  assert(conductor.includes(`case '${op}'`), `conductor handles ${op}`);
}
assert(conductor.includes('broadcastContentPieceDelta(prisma, action.workspaceId, contentProjectId)'), 'the Conductor pushes the granular piece delta after the write');
const route = read('src/workspaces/_sync/contentControl_server_v1.ts');
assert(route.includes("op !== 'content-advance' && op !== 'content-archive' && op !== 'content-unarchive'"), 'the route SKIPS contentDirty for the piece-delta ops (else a redundant full refetch defeats the optimization)');

report('realtimeConvergence');
