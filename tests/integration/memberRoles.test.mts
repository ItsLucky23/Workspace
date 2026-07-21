//? Integration test for the member / RBAC / invite control-ops (server/orchestrator/
//? conductor.ts): role-create / change-role / invite / revoke-invite. Runs against the
//? REAL Conductor + Mongo: create a workspace, then exercise each op and assert the
//? WorkspaceRole / WorkspaceMember / Invite rows persisted the change.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction, isControlActionFailure } = await import('../../server/orchestrator/conductor');
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
const manager = await prisma.user.create({ data: { email: `roles3-${String(stamp)}@youcomm.nl`, name: 'Scoped Manager' } });
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

  //? A manageMembers-only custom role may manage ordinary members, but may not promote/invite/remove
  //? built-in admins. A custom role carrying ownerActions still cannot transfer the actual ownership.
  await enqueueControlAction({ workspaceId: wsId, op: 'role-create', target: {}, payload: { key: 'manager', label: 'Manager', perms: [true, false, false, true, false, false, false, false] }, userId: owner.id, clientRequestId: `role-manager-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'role-create', target: {}, payload: { key: 'fake-owner', label: 'Fake owner', perms: [true, true, true, true, true, true, true, true] }, userId: owner.id, clientRequestId: `role-fake-owner-${String(stamp)}` });
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: manager.id, roleKey: 'manager' } });

  const forbiddenAdminInvite = await enqueueControlAction({ workspaceId: wsId, op: 'invite', target: {}, payload: { email: `admin-target-${String(stamp)}@youcomm.nl`, roleKey: 'admin' }, userId: manager.id, clientRequestId: `invite-admin-${String(stamp)}` });
  assert(isControlActionFailure(forbiddenAdminInvite.result), 'manageMembers alone cannot invite a built-in admin');
  eq(await prisma.invite.count({ where: { workspaceId: wsId, email: `admin-target-${String(stamp)}@youcomm.nl` } }), 0, 'a forbidden admin invite creates no row');

  const forbiddenAdminRemoval = await enqueueControlAction({ workspaceId: wsId, op: 'remove-member', target: { memberId: second.id }, payload: {}, userId: manager.id, clientRequestId: `remove-admin-${String(stamp)}` });
  assert(isControlActionFailure(forbiddenAdminRemoval.result), 'manageMembers alone cannot remove a built-in admin');
  assert(await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: second.id } }) !== null, 'the protected admin membership remains');

  await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: wsId, userId: manager.id } }, data: { roleKey: 'fake-owner' } });
  const forbiddenTransfer = await enqueueControlAction({ workspaceId: wsId, op: 'transfer-ownership', target: { memberId: second.id }, payload: {}, userId: manager.id, clientRequestId: `fake-owner-transfer-${String(stamp)}` });
  assert(isControlActionFailure(forbiddenTransfer.result), 'a custom role with ownerActions is still not the actual owner');
  eq((await prisma.workspace.findUnique({ where: { id: wsId } }))?.ownerId, owner.id, 'a forged owner-capability role cannot change workspace ownership');

  const forbiddenOwnerInvite = await enqueueControlAction({ workspaceId: wsId, op: 'invite', target: {}, payload: { email: `owner-target-${String(stamp)}@youcomm.nl`, roleKey: 'owner' }, userId: owner.id, clientRequestId: `invite-owner-${String(stamp)}` });
  assert(isControlActionFailure(forbiddenOwnerInvite.result), 'even the owner must use transfer-ownership rather than invite an owner');

  //? invite → payload { email, roleKey }. Assert a pending Invite row. The token is a crypto-random secret
  //? (F3 hardening — no longer the guessable `inv-<clientRequestId>`), so find the invite by its unique email.
  const inviteReqId = `invite-${String(stamp)}`;
  const inviteEmail = `invitee-${String(stamp)}@youcomm.nl`;
  await enqueueControlAction({ workspaceId: wsId, op: 'invite', target: {}, payload: { email: inviteEmail, roleKey: 'member' }, userId: owner.id, clientRequestId: inviteReqId });
  const invite = await poll(() => prisma.invite.findFirst({ where: { workspaceId: wsId, email: inviteEmail } }));
  assert(invite !== null, 'invite created an Invite row');
  assert((invite?.token ?? '').length >= 24 && !(invite?.token ?? '').startsWith('inv-'), 'the invite token is a crypto-random secret, not the guessable inv-<reqId>');
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
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, second.id, manager.id]).catch(() => undefined);
  else await prisma.user.deleteMany({ where: { id: { in: [owner.id, second.id, manager.id] } } }).catch(() => undefined);
}

report('tests/integration/memberRoles.test.mts');
