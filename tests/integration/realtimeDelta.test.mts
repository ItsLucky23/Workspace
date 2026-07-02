//? Integration test for the REALTIME delta returns (server/orchestrator/conductor.ts
//? + server/read/mappers.ts). The per-action `_sync` write routes broadcast the
//? Conductor's op result mapped through the delta-mappers; this asserts the op result
//? IS the affected row(s) and that the mappers narrow them to the frontend shape the
//? client merges — the contract the realtime board relies on (no refetch).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { ticketListDelta, sprintDelta, noteDelta, repoDelta } from '../../server/read/mappers';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `delta-${String(stamp)}@youcomm.nl`, name: 'Delta Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Delta WS');
  workspaceId = created.workspaceId;

  // quick-add returns the created ticket row → ticketDelta narrows to a Ticket
  const add = await enqueueControlAction({ workspaceId, op: 'quick-add', target: {}, payload: { title: 'Delta ticket', description: 'Delta desc', labels: ['bug', 'urgent'] }, userId: owner.id, clientRequestId: `d-add-${String(stamp)}` });
  const addedList = ticketListDelta(Array.isArray(add.result) ? add.result : [add.result]);
  assert(addedList.length === 1, 'quick-add op result maps to one ticket delta');
  const key = addedList[0]?.id ?? '';
  assert(key.startsWith('DEV-'), 'the ticket delta id is the DEV-#### key');
  eq(addedList[0]?.description, 'Delta desc', 'quick-add persists the description');
  eq(addedList[0]?.labels.join(','), 'bug,urgent', 'quick-add persists the labels');

  // ticket-edit returns the affected rows → ticketListDelta
  const edit = await enqueueControlAction({ workspaceId, op: 'ticket-edit', target: { ticketId: key }, payload: { title: 'Delta renamed' }, userId: owner.id, clientRequestId: `d-edit-${String(stamp)}` });
  const editList = ticketListDelta(edit.result);
  eq(editList[0]?.title, 'Delta renamed', 'ticket-edit delta carries the new title');
  eq(editList[0]?.id, key, 'ticket-edit delta keeps the DEV key as id');

  // archive returns the affected rows with archived:true
  const arch = await enqueueControlAction({ workspaceId, op: 'archive', target: { ticketId: key }, payload: {}, userId: owner.id, clientRequestId: `d-arch-${String(stamp)}` });
  const archList = ticketListDelta(arch.result);
  eq(archList[0]?.archived, true, 'archive delta carries archived=true');

  // bulk-move returns the affected rows → ticketListDelta (same path the bulk-* ops share)
  const mv = await enqueueControlAction({ workspaceId, op: 'bulk-move', target: { ticketIds: [key] }, payload: { stageId: 'coding' }, userId: owner.id, clientRequestId: `d-mv-${String(stamp)}` });
  const mvList = ticketListDelta(mv.result);
  eq(mvList[0]?.stageId, 'coding', 'bulk-move delta carries the new stageId');
  eq(mvList[0]?.id, key, 'bulk-move delta keeps the DEV key as id');

  // link-repo with an invalid URL → a scrubbed error delta (no clone), repoDelta maps it
  const badRepo = await enqueueControlAction({ workspaceId, op: 'link-repo', target: {}, payload: { gitUrl: 'not-a-valid-url' }, userId: owner.id, clientRequestId: `d-repo-${String(stamp)}` });
  const repo = repoDelta(badRepo.result);
  eq(repo?.linked, false, 'link-repo with a bad url returns not-linked');
  assert((repo?.error ?? '').length > 0, 'link-repo failure carries a (scrubbed) error message');

  // sprint-create returns the created sprint → sprintDelta
  const sp = await enqueueControlAction({ workspaceId, op: 'sprint-create', target: {}, payload: { name: 'Delta sprint', active: false }, userId: owner.id, clientRequestId: `d-sp-${String(stamp)}` });
  const sprint = sprintDelta(sp.result);
  eq(sprint?.name, 'Delta sprint', 'sprint-create delta carries the sprint name');
  eq(sprint?.ticketCount, 0, 'a fresh sprint delta has ticketCount 0');

  // add-comment returns the created note → noteDelta (mapped to the DEV key)
  const cm = await enqueueControlAction({ workspaceId, op: 'add-comment', target: { ticketId: key }, payload: { body: 'Delta comment' }, userId: owner.id, clientRequestId: `d-cm-${String(stamp)}` });
  const note = noteDelta(cm.result, key);
  eq(note?.body, 'Delta comment', 'add-comment delta carries the body');
  eq(note?.ticketId, key, 'add-comment delta maps ticketId to the DEV key');
  eq(note?.author, owner.id, 'add-comment delta carries the author user id');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/realtimeDelta.test.mts');
