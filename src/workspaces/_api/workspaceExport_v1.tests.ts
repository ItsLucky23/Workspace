import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/workspaceExport/v1` — H4 tenant-scoped JSON export of a
//? workspace's own data (portability/backup/GDPR), gated on the `workspaceSettings` capability.
//? The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert the
//? business-logic the sweep can't reach:
//?  [1] a seeded workspace exports `workspace.id`, tickets, pipeline, counts, and only env KEYS
//?      (never a secret value) even when an env var is present.
//?  [2] a non-member (no `workspaceSettings` capability) is rejected with `auth.forbidden`.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) and seeds a
//? demo workspace (login alone no longer seeds one — first-login auto-seed was removed in
//? commit 42632a2). An `EnvVar` row is written directly via `ctx.prisma.envVar` to prove secret
//? values never leave the export. Teardown via the shared `cleanupWorkspace` helper.

interface WorkspaceExportOk {
  status: 'success';
  result: {
    workspace: { id: string; name: string };
    tickets: unknown[];
    envKeys: string[];
    counts: { tickets: number; content: number; members: number };
  };
}
interface WorkspaceExportErr {
  status: 'error';
  errorCode?: string;
}
type WorkspaceExportResponse = WorkspaceExportOk | WorkspaceExportErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a seeded workspace exports its own data and only env KEYS, never values',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'wsexp_c1');
      try {
        await ctx.prisma.envVar.create({ data: { workspaceId, key: 'SECRET_TOKEN', value: 'ptr://SECRET_TOKEN_V1' } });

        const res = await ctx.callApi<{ workspaceId: string }, WorkspaceExportResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'workspaceExport returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.workspace.id, workspaceId, 'result.workspace.id matches the exported workspace');
        ctx.expect.ok(Array.isArray(res.result.tickets), 'result.tickets is an array');
        ctx.expect.eq(res.result.counts.tickets, res.result.tickets.length, 'counts.tickets matches tickets.length');
        ctx.expect.ok(res.result.envKeys.includes('SECRET_TOKEN'), 'envKeys includes the seeded env var KEY');
        const serialized = JSON.stringify(res.result);
        ctx.expect.ok(!serialized.includes('ptr://SECRET_TOKEN_V1'), 'the exported bundle never carries the secret value/pointer');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member of the workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'wsexp_c2_owner');
      const outsider = await createRealUser(ctx.prisma, 'wsexp_c2_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<{ workspaceId: string }, WorkspaceExportResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'workspaceExport returns status "error" for a non-member');
        ctx.expect.ok(
          res.status === 'error' && res.errorCode === 'auth.forbidden',
          `errorCode is "auth.forbidden" (got ${res.status === 'error' ? String(res.errorCode) : res.status})`,
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, outsider.id]);
      }
    },
  },
];
