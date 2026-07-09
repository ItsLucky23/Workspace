//? FASE SEC (COMPLETION) — RBAC/priv-esc hardening through the REAL Conductor + Mongo. Locks down:
//? SEC1 change-role privilege-ceiling (promoteAdmin needed to hand out an admin-tier role;
//? demoteAdmin needed to re-role a current admin) + owner-protection, SEC2 role-create/update
//? capability-ceiling + built-in immutability, SEC3 remove-member owner-protection, SEC5
//? mark-read userId-scoping, SEC7 the direct prod env-deploy bypass is closed.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sec-owner-${String(stamp)}@youcomm.nl`, name: 'Owner' } });
const mgr = await prisma.user.create({ data: { email: `sec-mgr-${String(stamp)}@youcomm.nl`, name: 'Mgr' } });
const plain = await prisma.user.create({ data: { email: `sec-plain-${String(stamp)}@youcomm.nl`, name: 'Plain' } });
let workspaceId: string | null = null;
const req = (k: string) => `sec-${k}-${String(stamp)}`;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Sec WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  //? A custom role with ONLY manageMembers (idx 3) — the SEC1 attacker profile; created by the
  //? owner (full perms, ceiling passes). And an admin-tier target role holding promoteAdmin (5).
  const mgrPerms = [false, false, false, true, false, false, false, false];
  const superPerms = [true, true, true, true, true, true, false, false];
  await enqueueControlAction({ workspaceId: wsId, op: 'role-create', target: {}, payload: { key: 'mgr', label: 'Mgr', perms: mgrPerms }, userId: owner.id, clientRequestId: req('r1') });
  await enqueueControlAction({ workspaceId: wsId, op: 'role-create', target: {}, payload: { key: 'super', label: 'Super', perms: superPerms }, userId: owner.id, clientRequestId: req('r2') });
  assert((await prisma.workspaceRole.findFirst({ where: { workspaceId: wsId, key: 'super' } })) !== null, 'owner (full perms) can create an admin-tier role');
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: mgr.id, roleKey: 'mgr' } });
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: plain.id, roleKey: 'member' } });

  // ---- SEC1 — privilege-ceiling on change-role
  await enqueueControlAction({ workspaceId: wsId, op: 'change-role', target: { memberId: plain.id }, payload: { roleKey: 'super' }, userId: mgr.id, clientRequestId: req('c1') });
  eq((await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: plain.id } }))?.roleKey, 'member', 'a manageMembers-only holder CANNOT promote into an admin-tier role');
  await enqueueControlAction({ workspaceId: wsId, op: 'change-role', target: { memberId: owner.id }, payload: { roleKey: 'member' }, userId: mgr.id, clientRequestId: req('c2') });
  eq((await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: owner.id } }))?.roleKey, 'owner', 'the OWNER membership cannot be re-roled via change-role');
  await enqueueControlAction({ workspaceId: wsId, op: 'change-role', target: { memberId: plain.id }, payload: { roleKey: 'super' }, userId: owner.id, clientRequestId: req('c3') });
  eq((await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: plain.id } }))?.roleKey, 'super', 'the owner (promoteAdmin) CAN hand out the admin-tier role');
  //? Demoting a current admin-tier holder needs demoteAdmin — mgr lacks it.
  await enqueueControlAction({ workspaceId: wsId, op: 'change-role', target: { memberId: plain.id }, payload: { roleKey: 'member' }, userId: mgr.id, clientRequestId: req('c4') });
  eq((await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: plain.id } }))?.roleKey, 'super', 'a manageMembers-only holder CANNOT strip an admin-tier member');

  // ---- SEC2 — role-create/update ceiling + built-in immutability
  await enqueueControlAction({ workspaceId: wsId, op: 'role-create', target: {}, payload: { key: 'sneaky', label: 'Sneaky', perms: [true, true, true, true, true, true, true, true] }, userId: mgr.id, clientRequestId: req('r3') });
  eq(await prisma.workspaceRole.findFirst({ where: { workspaceId: wsId, key: 'sneaky' } }), null, 'an actor cannot mint a role holding perms he lacks');
  await enqueueControlAction({ workspaceId: wsId, op: 'role-update', target: { roleKey: 'mgr' }, payload: { perms: [true, true, true, true, true, true, true, true] }, userId: mgr.id, clientRequestId: req('r4') });
  const mgrRole = await prisma.workspaceRole.findFirst({ where: { workspaceId: wsId, key: 'mgr' } });
  assert(mgrRole?.perms[7] !== true, 'an actor cannot self-escalate by updating his own role past his ceiling');
  await enqueueControlAction({ workspaceId: wsId, op: 'role-update', target: { roleKey: 'member' }, payload: { label: 'Hacked' }, userId: owner.id, clientRequestId: req('r5') });
  const builtIn = await prisma.workspaceRole.findFirst({ where: { workspaceId: wsId, key: 'member' } });
  assert(builtIn?.label !== 'Hacked', 'built-in roles are immutable server-side');
  //? Role creation is audited (governance event).
  const audit = await prisma.auditLog.findFirst({ where: { workspaceId: wsId, action: 'role-create', target: 'super' } });
  assert(audit !== null, 'role-create writes an audit row');

  // ---- SEC3 — remove-member owner-protection
  await enqueueControlAction({ workspaceId: wsId, op: 'remove-member', target: { memberId: owner.id }, payload: {}, userId: owner.id, clientRequestId: req('m1') });
  assert((await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: owner.id } })) !== null, 'the owner membership cannot be removed (no dangling ownerId)');

  // ---- SEC5 — mark-read is caller-scoped
  const notif = await prisma.notification.create({ data: { workspaceId: wsId, userId: owner.id, type: 'automation', title: 'For owner', body: 'x' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'mark-read', target: { notificationId: notif.id }, payload: {}, userId: mgr.id, clientRequestId: req('n1') });
  eq((await prisma.notification.findFirst({ where: { id: notif.id } }))?.read, false, 'another member cannot mark my notification read');
  await enqueueControlAction({ workspaceId: wsId, op: 'mark-read', target: { notificationId: notif.id }, payload: {}, userId: owner.id, clientRequestId: req('n2') });
  eq((await prisma.notification.findFirst({ where: { id: notif.id } }))?.read, true, 'the recipient CAN mark it read');

  // ---- SEC7 — no direct prod deploys (prod only via the gated promote; refused before any resolution)
  const { result } = await enqueueControlAction({ workspaceId: wsId, op: 'env-deploy', target: {}, payload: { kind: 'prod' }, userId: owner.id, clientRequestId: req('d1') });
  const res = result as Record<string, unknown> | null;
  assert(res !== null && res.ok === false && res.error === 'env.prodViaPromote', 'a direct prod env-deploy is refused with a typed error');
  eq(await prisma.environment.findFirst({ where: { workspaceId: wsId, kind: 'prod' } }), null, 'no prod environment row was created');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, mgr.id, plain.id]).catch(() => undefined);
  else await prisma.user.deleteMany({ where: { id: { in: [owner.id, mgr.id, plain.id] } } }).catch(() => undefined);
}

report('tests/integration/securityHardening.test.mts');
