import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/scanIndex/v1` — reads the LINKED REPO's code, chunks +
//? embeds it, and upserts the RagEntry store (07 §D).
//?
//? The happy path requires a real cloned repo on disk plus an embedder call
//? (`indexWorkspace`, Docker/PTY-dependent per the batch's container guard) — it is
//? deferred here rather than faked. Only the RBAC/validation boundary is asserted:
//?  [1] a room member without a WorkspaceMember row is rejected with `auth.forbidden`,
//?      and no RagEntry is created (proves the rejection precedes any repo/embed access).
//?
//? //? TODO needs Docker — happy path (index a real linked repo, assert `ragIndex.ok` +
//? RagEntry rows) requires a cloned repo on disk + a live embedder; deferred.

interface ScanIndexInput {
  clientRequestId: string;
}
interface ScanIndexOk {
  status: 'success';
  ragIndex: unknown;
}
interface ScanIndexErr {
  status: 'error';
  errorCode: string;
}
type ScanIndexResponse = ScanIndexOk | ScanIndexErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'scanindex_c1');
      const outsider = await createRealUser(ctx.prisma, 'scanindex_c1_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        //? NOTE: no before/after `ragEntry.count` here — `loginSeededUser`'s `seedDemoWorkspace`
        //? kicks off a fire-and-forget `scheduleWorkspaceBuiltinIndexing` background job that
        //? writes RagEntry rows for this same workspace on its own timeline, so a row-count delta
        //? would race that unrelated background write rather than prove anything about this call.
        const res = await ctx.callSync<ScanIndexInput, ScanIndexResponse>(
          { clientRequestId: `si-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
