import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/acceptInvite/v1` — the login-only route that
//? enqueues `accept-invite` (the caller may have no workspace yet, so this runs on
//? the Conductor's login-only path). The auto-sweep already covers contract/auth/
//? rate-limit/fuzz; these cases assert the business-logic the sweep can't reach:
//?  [1] a pending invite whose email matches the caller creates a real
//?      WorkspaceMember row (with the invite's `roleKey`) and flips the invite to
//?      'accepted' — the actual tenant-join effect, not just the ACK envelope.
//?  [2] F3's email-binding guard: a token whose invite email does NOT match the
//?      caller's own email is silently ignored (still ACKs `accepted: true` — the op
//?      never fails, it just no-ops) — no WorkspaceMember is created and the invite
//?      stays 'pending'.
//?
//? Integration test: `loginSeededUser` seeds the inviting workspace (owner); a second
//? real user (`createRealUser`) is the invitee, created + logged in per case. The
//? Invite row is created directly via `ctx.prisma` (mirrors the Conductor's `invite`
//? op shape) rather than round-tripping through that separate route. Teardown via
//? `cleanupWorkspace` (covers the Invite row too) plus the extra invitee user.

interface AcceptOk {
  status: 'success';
  result: { accepted: true; signalSeq: number };
}
interface AcceptErr {
  status: 'error';
  errorCode: string;
}
type AcceptResponse = AcceptOk | AcceptErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a matching-email invite creates a real WorkspaceMember and flips the invite to accepted',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'acceptInvite_c1_owner');
      const invitee = await createRealUser(ctx.prisma, 'acceptInvite_c1_invitee');
      try {
        const invite = await ctx.prisma.invite.create({
          data: { workspaceId, email: invitee.email, roleKey: 'member', invitedById: ownerId, token: `tok-${String(Date.now())}`, status: 'pending', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        });
        await ctx.session.login({ id: invitee.id, email: invitee.email, name: invitee.name });
        const res = await ctx.callApi<{ inviteToken: string; clientRequestId: string }, AcceptResponse>({
          inviteToken: invite.token,
          clientRequestId: `acceptinv-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'success', 'acceptInvite returns status "success"');
        const member = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: invitee.id }, select: { roleKey: true } });
        ctx.expect.ok(member !== null, 'a WorkspaceMember row was created for the invitee');
        if (member) ctx.expect.eq(member.roleKey, 'member', 'the member gets the invite\'s roleKey');
        const inviteRow = await ctx.prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true } });
        ctx.expect.eq(inviteRow?.status, 'accepted', 'the invite row flips to "accepted"');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, invitee.id]);
      }
    },
  },
  {
    name: 'a mismatched-email invite is silently ignored (no membership created)',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'acceptInvite_c2_owner');
      const stranger = await createRealUser(ctx.prisma, 'acceptInvite_c2_stranger');
      try {
        const invite = await ctx.prisma.invite.create({
          data: { workspaceId, email: 'someone-else@youcomm.nl', roleKey: 'member', invitedById: ownerId, token: `tok-mismatch-${String(Date.now())}`, status: 'pending', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        });
        await ctx.session.login({ id: stranger.id, email: stranger.email, name: stranger.name });
        const res = await ctx.callApi<{ inviteToken: string; clientRequestId: string }, AcceptResponse>({
          inviteToken: invite.token,
          clientRequestId: `acceptinv-mismatch-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'success', 'the op still ACKs (it no-ops rather than fails)');
        const member = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: stranger.id }, select: { id: true } });
        ctx.expect.eq(member, null, 'no WorkspaceMember row was created for the mismatched caller');
        const inviteRow = await ctx.prisma.invite.findUnique({ where: { id: invite.id }, select: { status: true } });
        ctx.expect.eq(inviteRow?.status, 'pending', 'the invite stays "pending"');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, stranger.id]);
      }
    },
  },
];
