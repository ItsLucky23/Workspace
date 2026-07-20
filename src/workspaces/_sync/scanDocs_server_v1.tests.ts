import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/scanDocs/v1` — scans the LINKED REPO for doc files
//? and registers each as a context-doc InfoSource.
//?
//? The happy path requires a real cloned repo on disk (`cloneRepo` / `listRepoDocs`,
//? Docker/PTY-dependent per the batch's container guard) — it is deferred here rather
//? than faked. Only the RBAC/validation boundary is asserted:
//?  [1] a room member without a WorkspaceMember row is rejected with `auth.forbidden`,
//?      and no InfoSource is created (proves the rejection precedes any repo access).
//?
//? //? TODO needs Docker — happy path (scan a real linked repo, assert the InfoSource
//? rows created from `listRepoDocs`) requires a cloned repo on disk; deferred.

interface ScanDocsInput {
  clientRequestId: string;
}
interface ScanDocsOk {
  status: 'success';
  docs: unknown;
}
interface ScanDocsErr {
  status: 'error';
  errorCode: string;
}
type ScanDocsResponse = ScanDocsOk | ScanDocsErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'scandocs_c1');
      const outsider = await createRealUser(ctx.prisma, 'scandocs_c1_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const before = await ctx.prisma.infoSource.count({ where: { workspaceId, mode: 'context-doc' } });
        const res = await ctx.callSync<ScanDocsInput, ScanDocsResponse>(
          { clientRequestId: `sd-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.infoSource.count({ where: { workspaceId, mode: 'context-doc' } });
        ctx.expect.eq(after, before, 'no InfoSource was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
