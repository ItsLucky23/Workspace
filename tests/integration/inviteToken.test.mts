//? F3 integration — invite-token hardening through the REAL Conductor + Mongo. Verifies: a created invite gets
//? a CRYPTO-RANDOM token (not the old guessable `inv-<clientRequestId>`) + a future expiry; an invite is bound
//? to its target email (a mismatched account cannot accept it); the matched account CAN accept (→ membership);
//? and an EXPIRED invite is rejected + swept to status 'expired'. Creates + cleans up its own data.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `inv-owner-${String(stamp)}@youcomm.nl`, name: 'Owner' } });
const invitee = await prisma.user.create({ data: { email: `inv-invitee-${String(stamp)}@youcomm.nl`, name: 'Invitee' } });
const intruder = await prisma.user.create({ data: { email: `inv-intruder-${String(stamp)}@youcomm.nl`, name: 'Intruder' } });
const extra = await prisma.user.create({ data: { email: `inv-extra-${String(stamp)}@youcomm.nl`, name: 'Extra' } });
const userIds = [owner.id, invitee.id, intruder.id, extra.id];
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'Inv WS' }, userId: owner.id, clientRequestId: `inv-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  // 1) create an invite for the invitee's email → crypto-random token + a future expiry.
  await enqueueControlAction({ workspaceId: wsId, op: 'invite', target: {}, payload: { email: invitee.email, roleKey: 'member' }, userId: owner.id, clientRequestId: `inv-1-${String(stamp)}` });
  const invite = await poll(() => prisma.invite.findFirst({ where: { workspaceId: wsId, email: invitee.email } }));
  assert(invite !== null, 'the invite was created');
  assert(!invite!.token.startsWith('inv-'), 'the token is NOT the old guessable inv-<clientRequestId> form');
  assert(invite!.token.length >= 24 && !invite!.token.includes(`inv-1-${String(stamp)}`), 'the token is a long crypto-random value, not derived from the clientRequestId');
  assert(invite!.expiresAt !== null && invite!.expiresAt.getTime() > Date.now(), 'the invite has a future expiry');
  const token = invite!.token;

  // 2) a MISMATCHED account cannot accept (email-binding), even with the token.
  await enqueueControlAction({ workspaceId: '', op: 'accept-invite', target: { inviteToken: token }, payload: {}, userId: intruder.id, clientRequestId: `inv-x-${String(stamp)}` });
  const intruderMember = await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: intruder.id } });
  eq(intruderMember, null, 'an account whose email does not match the invite CANNOT accept it');
  const stillPending = await prisma.invite.findFirst({ where: { id: invite!.id } });
  eq(stillPending?.status, 'pending', 'the invite stays pending after a rejected mismatched accept');

  // 3) the matched invitee CAN accept → membership created + invite accepted.
  await enqueueControlAction({ workspaceId: '', op: 'accept-invite', target: { inviteToken: token }, payload: {}, userId: invitee.id, clientRequestId: `inv-ok-${String(stamp)}` });
  const member = await poll(() => prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: invitee.id } }));
  assert(member !== null, 'the matched-email invitee becomes a member');
  eq(member?.roleKey, 'member', 'the invited role is granted');
  const accepted = await prisma.invite.findFirst({ where: { id: invite!.id } });
  eq(accepted?.status, 'accepted', 'the invite is marked accepted');

  // 4) an EXPIRED invite is rejected + swept to 'expired'.
  const expired = await prisma.invite.create({ data: { workspaceId: wsId, email: extra.email, roleKey: 'member', token: `rnd-${String(stamp)}-expired`, status: 'pending', expiresAt: new Date(Date.now() - 60_000) } });
  await enqueueControlAction({ workspaceId: '', op: 'accept-invite', target: { inviteToken: expired.token }, payload: {}, userId: extra.id, clientRequestId: `inv-exp-${String(stamp)}` });
  const extraMember = await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: extra.id } });
  eq(extraMember, null, 'an expired invite cannot be accepted (no membership)');
  const sweptInvite = await poll(async () => { const i = await prisma.invite.findFirst({ where: { id: expired.id } }); return i && i.status === 'expired' ? i : null; });
  eq(sweptInvite?.status, 'expired', 'the expired invite is swept to status expired on touch');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, userIds).catch(() => undefined);
  else await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
}

report('tests/integration/inviteToken.test.mts');
