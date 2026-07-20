import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/addInfoDoc/v1` — registers a USER-UPLOADED doc as a
//? context-doc InfoSource (FREEDOM_PROGRAM K2).
//?  [1] happy path — a room member uploads a doc; asserted via the REAL Prisma
//?      post-condition (the Conductor's single-writer persistence), not just the ack.
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and no InfoSource is created.

interface AddInfoDocInput {
  name: string;
  content: string;
  clientRequestId: string;
}
interface AddInfoDocOk {
  status: 'success';
  docs: unknown;
}
interface AddInfoDocErr {
  status: 'error';
  errorCode: string;
}
type AddInfoDocResponse = AddInfoDocOk | AddInfoDocErr;

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
    name: 'happy path registers a context-doc InfoSource (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'addinfodoc_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `sync-harness-doc-${String(Date.now())}.md`;
        const res = await ctx.callSync<AddInfoDocInput, AddInfoDocResponse>(
          { name, content: '# hello\nsome uploaded content', clientRequestId: `aid-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'addInfoDoc returns status "success"');

        const info = await poll(() => ctx.prisma.infoSource.findFirst({ where: { workspaceId, name, mode: 'context-doc' } }));
        ctx.expect.ok(info !== null, 'the Conductor persisted the InfoSource (post-condition, not just the ack)');
        ctx.expect.eq(info?.source, 'uploaded', 'the InfoSource is tagged as a user upload');
        ctx.expect.eq(info?.enabled, false, 'a freshly uploaded doc defaults aiEditable OFF');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'addinfodoc_c2');
      const outsider = await createRealUser(ctx.prisma, 'addinfodoc_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const name = `should-not-be-created-${String(Date.now())}.md`;
        const res = await ctx.callSync<AddInfoDocInput, AddInfoDocResponse>(
          { name, content: 'should not persist', clientRequestId: `aid-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const info = await ctx.prisma.infoSource.findFirst({ where: { workspaceId, name } });
        ctx.expect.ok(info === null, 'no InfoSource was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
