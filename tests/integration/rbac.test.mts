//? Integration test for the shared `hasCapability` RBAC gate used by the Fase-0
//? per-action typed `_api` write routes (quickAdd/sprintCreate/…). Runs against the
//? REAL Mongo: builds a workspace, adds a plain 'member', and asserts the B-28
//? capability matrix is enforced (owner all-true; member limited; non-member none;
//? null-cap = login-only always allowed). This locks the security posture the whole
//? typed-route family depends on.

import { db, cleanupWorkspace, assert, report } from '../_helpers.mts';

const prisma = await db();
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { hasCapability, CAP } = await import('../../server/control/rbac');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rbac-owner-${String(stamp)}@youcomm.nl`, name: 'RBAC Owner' } });
const member = await prisma.user.create({ data: { email: `rbac-member-${String(stamp)}@youcomm.nl`, name: 'RBAC Member' } });
const stranger = await prisma.user.create({ data: { email: `rbac-stranger-${String(stamp)}@youcomm.nl`, name: 'RBAC Stranger' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'RBAC WS');
  workspaceId = created.workspaceId;
  await prisma.workspaceMember.create({ data: { workspaceId, userId: member.id, roleKey: 'member' } });

  assert(await hasCapability(prisma, workspaceId, owner.id, CAP.workTickets), 'owner may work tickets');
  assert(await hasCapability(prisma, workspaceId, owner.id, CAP.ownerActions), 'owner may perform owner-only actions');
  assert(await hasCapability(prisma, workspaceId, member.id, CAP.workTickets), 'member may work tickets (MEMBER_PERMS[0] = true)');
  assert(!(await hasCapability(prisma, workspaceId, member.id, CAP.ownerActions)), 'member may NOT perform owner-only actions');
  assert(!(await hasCapability(prisma, workspaceId, member.id, CAP.manageMembers)), 'member may NOT manage members');
  assert(!(await hasCapability(prisma, workspaceId, stranger.id, CAP.workTickets)), 'a non-member has no capability');
  assert(await hasCapability(prisma, workspaceId, stranger.id, null), 'null cap = login-only own-resource op, always allowed');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, member.id, stranger.id]).catch(() => undefined);
  else await Promise.all([owner, member, stranger].map((u) => prisma.user.delete({ where: { id: u.id } }).catch(() => undefined)));
}

report('tests/integration/rbac.test.mts');
