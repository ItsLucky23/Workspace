import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/workspaceImport/v1` — the missing counterpart of
//? workspaceExport: bring a previously-exported JSON bundle back as a NEW workspace owned by the
//? caller (login-only, like createWorkspace — no existing workspace required). The auto-sweep
//? already covers contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep
//? can't reach:
//?  [1] a valid bundle creates a NEW workspace owned by the caller with the recreated tickets.
//?  [2] a bundle missing `workspace.name`/`tickets` is rejected with `import.invalidBundle`, no
//?      workspace created.
//?
//? Integration test: this route does not require an existing workspace, so `createRealUser` +
//? `ctx.session.login({ id })` is enough (a genuine ObjectId — the harness's synthetic
//? `test-user-<ts>` fallback is NOT valid against `@db.ObjectId` fields). The workspace it CREATES
//? is torn down via the shared `cleanupWorkspace` helper.

interface WorkspaceImportOk {
  status: 'success';
  result: { ok: true; workspaceId: string; name: string; tickets: number; pieces: number; sources: number };
}
interface WorkspaceImportErr {
  status: 'error';
  errorCode?: string;
}
type WorkspaceImportResponse = WorkspaceImportOk | WorkspaceImportErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid bundle creates a new workspace owned by the caller with recreated tickets',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'wsimp_c1');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      let workspaceId: string | undefined;
      try {
        const bundle = {
          workspace: { id: 'irrelevant', name: 'Imported Co' },
          tickets: [{ title: 'First imported ticket' }, { title: 'Second imported ticket' }],
          knowledgeSources: [],
          content: [],
        };

        const res = await ctx.callApi<{ bundle: unknown }, WorkspaceImportResponse>({ bundle });
        ctx.expect.eq(res.status, 'success', 'workspaceImport returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.ok, 'result.ok is true');
        if (res.status !== 'success') return;
        workspaceId = res.result.workspaceId;
        ctx.expect.eq(res.result.tickets, 2, 'result.tickets reports the 2 recreated tickets');
        ctx.expect.eq(res.result.name, 'Imported Co (import)', 'result.name carries the "(import)" suffix');

        const member = await ctx.prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id } });
        ctx.expect.ok(member !== null, 'the caller is a member of the newly created workspace');
        //? An import recreates ONLY the bundle's own tickets — `createBlankWorkspace` is called with
        //? `skipStarterSeed: true` from the import path, so no phantom starter/example tickets mix in.
        const tickets = await ctx.prisma.ticket.findMany({ where: { workspaceId } });
        ctx.expect.eq(tickets.length, 2, 'exactly the 2 bundle-imported Ticket rows exist, no phantom starter tickets');

        const retried = await ctx.callApi<{ bundle: unknown }, WorkspaceImportResponse>({ bundle });
        ctx.expect.ok(retried.status === 'success' && retried.result.workspaceId === workspaceId, 'retrying the same bundle returns the deterministic completed workspace');
        ctx.expect.eq(await ctx.prisma.workspace.count({ where: { ownerId: user.id, importCompleted: true } }), 1, 'an import retry cannot create a duplicate workspace');
      } finally {
        await (workspaceId ? cleanupWorkspace(ctx.prisma, workspaceId, [user.id]) : ctx.prisma.user.delete({ where: { id: user.id } }));
      }
    },
  },
  {
    name: 'a bundle missing workspace.name/tickets is rejected with import.invalidBundle',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'wsimp_c2');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      try {
        const res = await ctx.callApi<{ bundle: unknown }, WorkspaceImportResponse>({ bundle: { workspace: {} } });
        ctx.expect.eq(res.status, 'error', 'workspaceImport returns status "error" for an invalid bundle');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'import.invalidBundle',
          `errorCode is "import.invalidBundle" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
        const workspaces = await ctx.prisma.workspaceMember.findMany({ where: { userId: user.id } });
        ctx.expect.eq(workspaces.length, 0, 'no workspace membership was created for the caller');
      } finally {
        await ctx.prisma.globalJob.deleteMany({ where: { userId: user.id } });
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
