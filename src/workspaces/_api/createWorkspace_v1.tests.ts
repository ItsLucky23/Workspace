import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/createWorkspace/v1` — the login-only control-API
//? route that enqueues the `create-workspace` op (no workspaceId yet, the caller has
//? none). The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases
//? assert the business-logic the sweep can't reach:
//?  [1] a valid name enqueues + the Conductor creates a real, owner-scoped Workspace
//?      row, and the route hands its id back in `result.workspaceId` (the caller has
//?      no workspace yet to poll/merge against, so the id MUST ride the ACK).
//?  [2] a whitespace-only name is rejected before enqueue (`api.invalidRequest`) —
//?      this is a `.trim()` business rule, not a schema shape the sweep would catch.
//?
//? Integration test: `createRealUser` creates a real `User` (a genuine ObjectId — the
//? harness's synthetic `test-user-<ts>` fallback is NOT a valid ObjectId and breaks
//? Prisma `@db.ObjectId` queries on `user.id`), then logs in as it. No seeded
//? workspace is needed — this route's whole job is to create the FIRST one. Teardown
//? via the shared `cleanupWorkspace` harness helper once the workspace id is known.

interface CreateOk {
  status: 'success';
  result: { accepted: true; signalSeq: number; workspaceId?: string };
}
interface CreateErr {
  status: 'error';
  errorCode: string;
}
type CreateResponse = CreateOk | CreateErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid name creates a real, owner-scoped workspace and returns its id',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'createWs_c1');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      let workspaceId: string | null = null;
      try {
        const res = await ctx.callApi<{ name: string; clientRequestId: string }, CreateResponse>({
          name: 'LS Test Workspace',
          clientRequestId: `createws-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'success', 'createWorkspace returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.ok(typeof res.result.workspaceId === 'string' && res.result.workspaceId.length > 0, 'result.workspaceId is present (the caller has no workspace yet to poll)');
        workspaceId = res.result.workspaceId ?? null;
        if (workspaceId === null) return;
        const row = await ctx.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, ownerId: true } });
        ctx.expect.ok(row !== null, 'the Conductor persisted a real Workspace row');
        if (!row) return;
        ctx.expect.eq(row.name, 'LS Test Workspace', 'the persisted workspace has the requested name');
        ctx.expect.eq(row.ownerId, user.id, 'the persisted workspace is owned by the caller');
        const member = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { roleKey: true } });
        ctx.expect.ok(member?.roleKey === 'owner', 'the caller is seeded as the "owner" member');
      } finally {
        await (workspaceId === null ? ctx.prisma.user.delete({ where: { id: user.id } }) : cleanupWorkspace(ctx.prisma, workspaceId, [user.id]));
      }
    },
  },
  {
    name: 'a whitespace-only name is rejected before enqueue',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'createWs_c2');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      try {
        const res = await ctx.callApi<{ name: string; clientRequestId: string }, CreateResponse>({
          name: '   ',
          clientRequestId: `createws-blank-${String(Date.now())}`,
        });
        ctx.expect.eq(res.status, 'error', 'a whitespace-only name is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'api.invalidRequest', 'the error code is api.invalidRequest');
        const count = await ctx.prisma.workspace.count({ where: { ownerId: user.id } });
        ctx.expect.eq(count, 0, 'no workspace was created for the rejected request');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
