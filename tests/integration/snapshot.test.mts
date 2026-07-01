//? Integration test — the Fase-1 read snapshot end-to-end against real Mongo.
//?
//? Seeds a demo workspace for a throwaway owner, builds the frontend snapshot via
//? `buildSnapshot`, and asserts the shape the screens render: active workspace,
//? membership + role, 12 demo tickets keyed by "DEV-####" (not ObjectIds), 7 pipeline
//? stages keyed by slug, the owner as a member, and a budget. Also checks the empty
//? path (a user with no workspaces → null active id + empty arrays). Cleans up after.

import type { TicketStatus } from '../../src/workspaces/_data/types';
import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const OBJECT_ID_RE = /^[0-9a-f]{24}$/;
const VALID_STATUSES: TicketStatus[] = ['idle', 'needs-input', 'busy', 'done', 'paused', 'stuck'];

//? Resolve secrets + build the real client FIRST. The server modules under test
//? (`tenantDb`, …) call `getPrismaClient()` at import time, so they must be loaded
//? AFTER `db()` has resolved DATABASE_URL — hence the dynamic imports below.
const prisma = await db();
const { seedDemoWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

//? Throwaway owner for the seeded workspace, plus a second owner that never gets one.
const stamp = Date.now().toString(36);
const owner = await prisma.user.create({ data: { email: `snapshot-owner-${stamp}@test.local`, name: 'Snapshot Owner' } });
const loner = await prisma.user.create({ data: { email: `snapshot-loner-${stamp}@test.local`, name: 'Snapshot Loner' } });

let seededWorkspaceId: string | null = null;

try {
  const { workspaceId } = await seedDemoWorkspace(prisma, owner.id);
  seededWorkspaceId = workspaceId;

  const snap = await buildSnapshot(prisma, owner.id);

  // ---- active workspace + membership ----
  eq(snap.activeWorkspaceId, workspaceId, 'activeWorkspaceId equals the seeded workspace id');
  eq(snap.workspaces.length, 1, 'exactly one workspace for the owner');
  eq(snap.workspaces[0]?.id, workspaceId, 'the listed workspace is the seeded one');
  eq(snap.workspaces[0]?.role, 'owner', "the owner's role on the workspace is 'owner'");

  // ---- tickets: keyed by DEV-#### (not ObjectId), valid status ----
  eq(snap.tickets.length, 12, 'twelve demo tickets in the snapshot');
  const dev1240 = snap.tickets.find((t) => t.id === 'DEV-1240');
  assert(dev1240 !== undefined, "a ticket has id 'DEV-1240' (the KEY, not an ObjectId)");
  assert(!OBJECT_ID_RE.test(dev1240?.id ?? ''), "DEV-1240's id is a key, not a 24-hex ObjectId");
  assert(dev1240 !== undefined && VALID_STATUSES.includes(dev1240.status), 'DEV-1240 has a valid TicketStatus');

  // ---- stages: slug ids (not ObjectId), first is the 'unrefined' refine stage ----
  eq(snap.stages.length, 7, 'seven pipeline stages in the snapshot');
  eq(snap.stages[0]?.id, 'unrefined', "stages[0].id is the slug 'unrefined'");
  assert(!OBJECT_ID_RE.test(snap.stages[0]?.id ?? ''), 'stages[0].id is a slug, not a 24-hex ObjectId');
  eq(snap.stages[0]?.kind, 'refine', "stages[0].kind is 'refine'");

  // ---- members: the owner is present as an owner ----
  const ownerMember = snap.members.find((m) => m.id === owner.id);
  assert(ownerMember !== undefined, 'the owner is present in the members list');
  eq(ownerMember?.role, 'owner', "the owner member has role 'owner'");

  // ---- budget ----
  assert(snap.budget !== null, 'budget is non-null');

  // ---- empty path: a user with no workspaces ----
  const empty = await buildSnapshot(prisma, loner.id);
  eq(empty.activeWorkspaceId, null, 'no-workspace user → activeWorkspaceId null');
  eq(empty.workspaces.length, 0, 'no-workspace user → empty workspaces');
  eq(empty.tickets.length, 0, 'no-workspace user → empty tickets');
  eq(empty.stages.length, 0, 'no-workspace user → empty stages');
  eq(empty.members.length, 0, 'no-workspace user → empty members');
  eq(empty.budget, null, 'no-workspace user → null budget');
} finally {
  // ---- best-effort cleanup (deletes the workspace, tenant rows, demo member Users + the owner) ----
  if (seededWorkspaceId) await cleanupWorkspace(prisma, seededWorkspaceId).catch(() => undefined);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: loner.id } }).catch(() => undefined);
}

report('tests/integration/snapshot.test.mts');
