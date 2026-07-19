//? F48 · F20 · F06 — the three gaps this tranche closes, each asserted against the behaviour that was
//? actually wrong before, not just against "the function exists".
//?
//?   F48 — deleting media left its bytes on disk FOREVER (no GC at all). The fix is a trash rather than a
//?          shredder, so the assertions are about the grace window, the countdown the UI shows, and the
//?          fact that only an explicit purge (or an expired window) destroys anything.
//?   F20 — the audit mirror swallowed every failure with `.catch(() => null)`, so a trail could silently
//?          stop being a trail; and nothing made tampering detectable afterwards.
//?   F06 — storage was unmeasurable. The owner chose measurement over a limit, so this asserts the number
//?          is real (it reflects bytes actually on disk), not that anything gets blocked.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { MEDIA_DIR } from '../../server/media/store.ts';
import {
  trashMedia, listTrash, restoreFromTrash, purgeTrashItem, runTrashSweep, workspaceStorage,
  trashableName, TRASH_DAYS,
} from '../../server/media/trash.ts';
import { auditRowHash, verifyAuditChain, auditHealth, noteAuditFailure, resetAuditHealth } from '../../server/control/audit.ts';

const prisma = await db();
const workspaceId = '000000000000000000f48001';

/* ------------------------------------------------------------ F48: what may be touched at all */

//? The trash unlinks files. Anything that is not a plain name inside the media dir must be refused
//? OUTRIGHT — a traversal here would delete outside the media directory.
eq(trashableName('/media/clip.mp4'), 'clip.mp4', 'a plain media file resolves');
eq(trashableName('/media/../../etc/passwd'), null, 'traversal is refused');
eq(trashableName('/media/sub/dir.mp4'), null, 'nested paths are refused');
eq(trashableName('https://example.com/x.mp4'), null, 'external URLs are not ours to delete');
eq(trashableName('/media/'), null, 'an empty name is refused');

/* ------------------------------------------------------------ F48: the trash itself */

//? A bare workspace row is enough — this tranche only touches media/audit tables, so seeding a full
//? workspace would test nothing extra and cost a second.
const existing = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
if (existing) await cleanupWorkspace(prisma, workspaceId);
await prisma.workspace.create({ data: { id: workspaceId, name: 'F48 trash', slug: `f48-trash-${String(Date.now())}`, ownerId: '000000000000000000f48fff' } });
mkdirSync(MEDIA_DIR, { recursive: true });

const makeFile = (name: string, bytes: number): string => {
  writeFileSync(path.join(MEDIA_DIR, name), Buffer.alloc(bytes, 1));
  return `/media/${name}`;
};

const url = makeFile('f48-clip.mp4', 4096);
const abs = path.join(MEDIA_DIR, 'f48-clip.mp4');

assert(await trashMedia(prisma, { workspaceId, url, label: 'A clip', kind: 'video' }), 'the file is trashed');
//? THE point of the trash model: the bytes survive the delete.
assert(existsSync(abs), 'trashing does NOT destroy the bytes — that is the whole difference from an unlink');

const listed = await listTrash(prisma, workspaceId);
eq(listed.length, 1, 'it shows up in the bin');
eq(listed[0]?.label, 'A clip', 'with the label the user recognises it by');
eq(listed[0]?.bytes, 4096, 'and its real size on disk');
//? The countdown the owner explicitly asked to see. Rounded UP, so an item with hours left never reads
//? as "0 days" while it is still there.
eq(listed[0]?.daysLeft, TRASH_DAYS, 'a fresh item shows the full window');

//? Re-deleting the same file must not silently extend its life.
const firstDeadline = listed[0]?.daysLeft;
await trashMedia(prisma, { workspaceId, url, label: 'A clip again', kind: 'video' }, Date.now() + 5 * 86_400_000);
const afterRetrash = await listTrash(prisma, workspaceId);
eq(afterRetrash.length, 1, 'trashing twice does not create a second row');
eq(afterRetrash[0]?.daysLeft, firstDeadline, 'and keeps the FIRST deadline');

/* ------------------------------------------------------------ F06: measurement, not a limit */

const piece = await prisma.contentProject.create({ data: { workspaceId, projectId: '000000000000000000f48aaa', title: 'F48', format: 'image', stageId: 'idea', status: 'idle' } });
const liveUrl = makeFile('f48-live.png', 2048);
await prisma.contentAsset.create({ data: { workspaceId, contentProjectId: piece.id, kind: 'image', url: liveUrl, status: 'ready' } });

const storage = await workspaceStorage(prisma, workspaceId);
eq(storage.liveBytes, 2048, 'live bytes reflect what is actually on disk');
eq(storage.files, 1, 'and how many files that is');
eq(storage.trashBytes, 4096, 'trashed bytes are counted separately — they are still occupying the disk');

/* ------------------------------------------------------------ F48: restore + explicit purge */

const restoreId = afterRetrash[0]?.id ?? '';
assert(await restoreFromTrash(prisma, workspaceId, restoreId), 'an item can be pulled back out');
eq((await listTrash(prisma, workspaceId)).length, 0, 'and leaves the bin');
assert(existsSync(abs), 'a restore never touched the bytes');

//? Cross-tenant: another workspace must not be able to restore or purge our row.
await trashMedia(prisma, { workspaceId, url, label: 'A clip', kind: 'video' });
const mine = (await listTrash(prisma, workspaceId))[0]?.id ?? '';
eq(await restoreFromTrash(prisma, '000000000000000000f48999', mine), false, 'a foreign workspace cannot restore it');
eq(await purgeTrashItem(prisma, '000000000000000000f48999', mine), false, 'nor purge it');
assert(existsSync(abs), 'and the bytes are untouched by the attempt');

//? The explicit "delete permanently now" the owner asked for.
assert(await purgeTrashItem(prisma, workspaceId, mine), 'the owner can purge it on the spot');
assert(!existsSync(abs), 'THAT destroys the bytes');
eq((await listTrash(prisma, workspaceId)).length, 0, 'and it leaves the bin');

/* ------------------------------------------------------------ F48: the sweep */

const sweepUrl = makeFile('f48-expired.mp4', 1024);
const sweepAbs = path.join(MEDIA_DIR, 'f48-expired.mp4');
await trashMedia(prisma, { workspaceId, url: sweepUrl, label: 'Expired', kind: 'video' });

//? Not yet due: a sweep must never take something before its window is up.
const early = await runTrashSweep(prisma);
assert(existsSync(sweepAbs), 'the sweep leaves an item whose window has NOT passed');
eq(early.purged, 0, 'and reports nothing purged');

//? Due: the window has passed, so the bytes go.
const late = await runTrashSweep(prisma, Date.now() + (TRASH_DAYS + 1) * 86_400_000);
assert(!existsSync(sweepAbs), 'once the window passes the sweep unlinks it');
assert(late.purged >= 1, 'and reports it');
eq((await listTrash(prisma, workspaceId)).length, 0, 'the bin is empty afterwards');

/* ------------------------------------------------------------ F20: tamper-evidence */

const row = (seq: number, prevHash: string, action: string) =>
  ({ seq, prevHash, workspaceId, actorId: 'u1', action, target: null, metadata: null });

const a = { ...row(1, '', 'member.invite'), hash: '' };
a.hash = auditRowHash(a);
const b = { ...row(2, a.hash, 'member.role'), hash: '' };
b.hash = auditRowHash(b);
const c = { ...row(3, b.hash, 'workspace.delete'), hash: '' };
c.hash = auditRowHash(c);

assert(verifyAuditChain([a, b, c]).ok, 'an untouched chain verifies');

//? EDITING a row: the classic "make my role change look like something harmless".
const edited = { ...b, action: 'member.login' };
const editVerdict = verifyAuditChain([a, edited, c]);
eq(editVerdict.ok, false, 'an edited row breaks the chain');
eq(editVerdict.brokenAtSeq, 2, 'and it names WHICH row');

//? DELETING a row: the trail must not simply close over the hole.
const deleteVerdict = verifyAuditChain([a, c]);
eq(deleteVerdict.ok, false, 'a removed row breaks the chain');
eq(deleteVerdict.brokenAtSeq, 3, 'reported at the row whose link no longer matches');

//? The other half of the owner's decision: best-effort writes, but LOUD.
resetAuditHealth();
eq(auditHealth().failures, 0, 'health starts clean');
noteAuditFailure('member.role', 'connection lost');
eq(auditHealth().failures, 1, 'a swallowed audit write is counted, not forgotten');
eq(auditHealth().lastAction, 'member.role', 'and names what was not recorded');
resetAuditHealth();

/* ------------------------------------------------------------ reachability */

//? A capability nobody can reach is not a feature. Both ops must exist across the whole chain.
const { OP_CAPABILITY } = await import('../../server/control/rbac.ts');
const { PROPOSE_CATALOG } = await import('../../server/ai/opCatalog.ts');
const { isChatEnabledOp } = await import('../../src/workspaces/_data/chatOps.ts');
for (const op of ['media-trash-restore', 'media-trash-purge'] as const) {
  assert(OP_CAPABILITY[op] !== undefined, `${op} has an RBAC capability`);
  assert(PROPOSE_CATALOG[op] !== undefined, `${op} is proposable by the Assistant`);
  assert(isChatEnabledOp(op), `${op} is dispatchable from chat`);
}
//? Purging is the only op here that destroys bytes — it must be marked destructive so the client
//? demands a confirm before it ever reaches the Conductor.
assert(PROPOSE_CATALOG['media-trash-purge']?.destructive === true, 'permanent deletion is flagged destructive');
assert(PROPOSE_CATALOG['media-trash-restore']?.destructive !== true, 'restoring is not');

await cleanupWorkspace(prisma, workspaceId);
report('trashAndAudit');
