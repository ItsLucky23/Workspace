import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/invite/v1` — creates a pending `Invite` via the
//? Conductor (op `invite`, requires manageMembers) and broadcasts it.
//?  [1] happy path — owner invites an email; asserted via the REAL Prisma
//?      post-condition (a pending `Invite` row), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and no invite is created.

interface InviteInput {
  email: string;
  roleKey: string;
  clientRequestId: string;
}
interface InviteOk {
  status: 'success';
  invite: { id: string; email: string } | null;
}
interface InviteErr {
  status: 'error';
  errorCode: string;
}
type InviteResponse = InviteOk | InviteErr;

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
    name: 'happy path creates a pending invite (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'invite_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const email = `lstest_invite_c1_${String(Date.now())}@youcomm.nl`;
        const res = await ctx.callSync<InviteInput, InviteResponse>(
          { email, roleKey: 'member', clientRequestId: `inv-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'invite returns status "success"');

        const invite = await poll(() => ctx.prisma.invite.findFirst({ where: { workspaceId, email } }));
        ctx.expect.ok(invite !== null, 'the Conductor persisted the pending invite (post-condition, not just the ack)');
        ctx.expect.eq(invite?.status, 'pending', 'a fresh invite lands with status "pending"');
        ctx.expect.eq(invite?.roleKey, 'member', 'the invite carries the requested roleKey');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'invite_c2');
      const outsider = await createRealUser(ctx.prisma, 'invite_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const email = `lstest_invite_c2_${String(Date.now())}@youcomm.nl`;
        const res = await ctx.callSync<InviteInput, InviteResponse>(
          { email, roleKey: 'member', clientRequestId: `inv-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const invite = await ctx.prisma.invite.findFirst({ where: { workspaceId, email } });
        ctx.expect.ok(invite === null, 'no invite was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
