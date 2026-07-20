import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/revokeInvite/v1` — revokes a pending `Invite` via
//? the Conductor (op `revoke-invite`, requires manageMembers).
//?  [1] happy path — owner revokes a pending invite; asserted via the REAL Prisma
//?      post-condition (`status` flips to `revoked`), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and the invite stays pending.

interface RevokeInviteInput {
  inviteId: string;
  clientRequestId: string;
}
interface RevokeInviteOk {
  status: 'success';
  revokedInviteId: string;
}
interface RevokeInviteErr {
  status: 'error';
  errorCode: string;
}
type RevokeInviteResponse = RevokeInviteOk | RevokeInviteErr;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path revokes a pending invite (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'revokeinv_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const email = `lstest_revokeinv_c1_${String(Date.now())}@youcomm.nl`;
        const invite = await ctx.prisma.invite.create({
          data: {
            workspaceId, email, roleKey: 'member', invitedById: userId, token: `revinv-c1-${String(Date.now())}`,
            status: 'pending', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        const res = await ctx.callSync<RevokeInviteInput, RevokeInviteResponse>(
          { inviteId: invite.id, clientRequestId: `revinv-c1-req-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'revokeInvite returns status "success"');

        const revoked = await poll(async () => {
          const row = await ctx.prisma.invite.findUnique({ where: { id: invite.id } });
          return row?.status === 'revoked' ? row : null;
        });
        ctx.expect.ok(revoked !== null, 'the Conductor flipped the invite to "revoked" (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'revokeinv_c2');
      const outsider = await createRealUser(ctx.prisma, 'revokeinv_c2_outsider');
      try {
        const email = `lstest_revokeinv_c2_${String(Date.now())}@youcomm.nl`;
        const invite = await ctx.prisma.invite.create({
          data: {
            workspaceId, email, roleKey: 'member', invitedById: userId, token: `revinv-c2-${String(Date.now())}`,
            status: 'pending', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<RevokeInviteInput, RevokeInviteResponse>(
          { inviteId: invite.id, clientRequestId: `revinv-c2-req-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stillPending = await ctx.prisma.invite.findUnique({ where: { id: invite.id } });
        ctx.expect.eq(stillPending?.status, 'pending', 'the invite was not revoked by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
