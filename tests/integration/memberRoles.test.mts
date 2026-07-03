//? Integration test for the member / RBAC / invite control-ops (server/orchestrator/
//? conductor.ts): role-create / change-role / invite / revoke-invite. Runs against the
//? REAL Conductor + Mongo: create a workspace, then exercise each op and assert the
//? WorkspaceRole / WorkspaceMember / Invite rows persisted the change.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `roles-${String(stamp)}@youcomm.nl`, name: 'Roles Owner' } });
const second = await prisma.user.create({ data: { email: `roles2-${String(stamp)}@youcomm.nl`, name: 'Second Member' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Roles WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  //? role-create → payload { key, label, perms }. Assert a non-builtin WorkspaceRole row.
  await enqueueControlAction({ workspaceId: wsId, op: 'role-create', target: {}, payload: { key: 'reviewer', label: 'Reviewer', perms: [true, false, false, false, false, false, false, false] }, userId: owner.id, clientRequestId: `role-create-${String(stamp)}` });
  const role = await poll(() => prisma.workspaceRole.findFirst({ where: { workspaceId: wsId, key: 'reviewer' } }));
  assert(role !== null, 'role-create created a WorkspaceRole row');
  eq(role?.label ?? '', 'Reviewer', 'role-create persisted the label');
  eq(role?.builtIn ?? true, false, 'role-create marked the role as non-builtin');

  //? change-role → add a second member first (via prisma), then flip their roleKey.
  //? target.memberId = the member's userId; payload.roleKey = the new role.
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: second.id, roleKey: 'member' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'change-role', target: { memberId: second.id }, payload: { roleKey: 'admin' }, userId: owner.id, clientRequestId: `change-role-${String(stamp)}` });
  const changed = await poll(async () => {
    const m = await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: second.id } });
    return m?.roleKey === 'admin' ? m : null;
  });
  assert(changed !== null, 'change-role flipped the second member roleKey to admin');

  //? invite → payload { email, roleKey }. Assert a pending Invite row (token = inv-<clientRequestId>).
  const inviteReqId = `invite-${String(stamp)}`;
  await enqueueControlAction({ workspaceId: wsId, op: 'invite', target: {}, payload: { email: `invitee-${String(stamp)}@youcomm.nl`, roleKey: 'member' }, userId: owner.id, clientRequestId: inviteReqId });
  const invite = await poll(() => prisma.invite.findFirst({ where: { workspaceId: wsId, token: `inv-${inviteReqId}` } }));
  assert(invite !== null, 'invite created an Invite row');
  eq(invite?.status ?? '', 'pending', 'invite starts in pending status');

  //? revoke-invite → target.inviteId (the DB id). Assert status flips to revoked.
  const inviteId = invite?.id ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'revoke-invite', target: { inviteId }, payload: {}, userId: owner.id, clientRequestId: `revoke-${String(stamp)}` });
  const revoked = await poll(async () => {
    const inv = await prisma.invite.findFirst({ where: { workspaceId: wsId, id: inviteId } });
    return inv?.status === 'revoked' ? inv : null;
  });
  assert(revoked !== null, 'revoke-invite set the Invite status to revoked');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, second.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/memberRoles.test.mts');
