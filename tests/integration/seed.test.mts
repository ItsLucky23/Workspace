//? Integration test — server/bootstrap/seedWorkspace.seedDemoWorkspace against the
//? REAL Mongo. Creates a throwaway owner User, seeds the demo workspace, asserts the
//? row counts + a couple of key field values, then cleans everything up. Run with
//? `npx tsx tests/integration/seed.test.mts`.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { seedDemoWorkspace } from '../../server/bootstrap/seedWorkspace';
import { DOCS, SKILLS } from '../../src/workspaces/_data/seed';

const prisma = await db();

//? Throwaway owner — unique email so re-runs never collide on @@unique([email, provider]).
const owner = await prisma.user.create({
  data: { email: `seed-test-${Date.now()}@youcomm.nl`, name: 'Seed Test Owner', avatarFallback: 'S' },
});

let workspaceId = '';
try {
  const seeded = await seedDemoWorkspace(prisma, owner.id);
  workspaceId = seeded.workspaceId;
  assert(workspaceId.length > 0, 'seedDemoWorkspace returns a workspaceId');

  //? Row counts (expected values mirror the seed constants — MIGRATION §5.2).
  eq(await prisma.workspaceRole.count({ where: { workspaceId } }), 3, 'WorkspaceRole count');
  eq(await prisma.workspaceMember.count({ where: { workspaceId } }), 6, 'WorkspaceMember count');
  eq(await prisma.pipelineStage.count({ where: { workspaceId } }), 7, 'PipelineStage count');
  eq(await prisma.ticket.count({ where: { workspaceId } }), 12, 'Ticket count');
  eq(await prisma.sprint.count({ where: { workspaceId } }), 2, 'Sprint count (backlog is virtual)');
  eq(await prisma.workspaceSuggestion.count({ where: { workspaceId } }), 2, 'WorkspaceSuggestion count');
  eq(await prisma.infoSource.count({ where: { workspaceId } }), DOCS.length + SKILLS.length, 'InfoSource count (DOCS + SKILLS)');
  eq(await prisma.envVar.count({ where: { workspaceId } }), 4, 'EnvVar count');
  eq(await prisma.integrationTool.count({ where: { workspaceId } }), 2, 'IntegrationTool count');
  eq(await prisma.invite.count({ where: { workspaceId } }), 1, 'Invite count');
  eq(await prisma.ticketEvent.count({ where: { workspaceId } }), 10, 'TicketEvent count');
  eq(await prisma.workspaceBudget.count({ where: { workspaceId } }), 1, 'WorkspaceBudget count');

  //? Owner membership is roleKey 'owner' and bound to the real owner user.
  const ownerMember = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: owner.id } });
  assert(ownerMember !== null, 'owner has a WorkspaceMember row');
  eq(ownerMember?.roleKey, 'owner', "owner membership roleKey is 'owner'");

  //? The implementation stage: key 'impl' + kind 'code'.
  const implStage = await prisma.pipelineStage.findFirst({ where: { workspaceId, key: 'impl' } });
  assert(implStage !== null, "PipelineStage 'impl' exists");
  eq(implStage?.kind, 'code', "PipelineStage 'impl' has kind 'code'");
} finally {
  //? Best-effort cleanup — remove the workspace, all tenant rows, and demo/owner users.
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/seed.test.mts');
