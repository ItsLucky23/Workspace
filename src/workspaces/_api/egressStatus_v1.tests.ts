import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/egressStatus/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach:
//?  [1] an owner (workspaceSettings capability) gets the host egress report: a known mode,
//?      numeric unconfined-launch counter and a non-empty allowlist (the built-in defaults
//?      are always present, WS_EGRESS_ALLOW only appends).
//?  [2] a caller with no membership on the target workspace is rejected with
//?      `auth.forbidden` (the `hasCapability` tenant boundary).

interface EgressStatusOk {
  status: 'success';
  result: { egress: { mode: string; unconfinedLaunches: number; lastAt: number; allowlist: string[] } };
}
interface EgressStatusErr {
  status: 'error';
  errorCode: string;
}
type EgressStatusResponse = EgressStatusOk | EgressStatusErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'an owner gets the host egress report (mode, counter, allowlist)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'egress_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string }, EgressStatusResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'egressStatus returns status "success" for an owner');
        if (res.status !== 'success') return;
        const { egress } = res.result;
        ctx.expect.ok(['enforce', 'report', 'off'].includes(egress.mode), 'mode is one of enforce/report/off');
        ctx.expect.ok(typeof egress.unconfinedLaunches === 'number' && egress.unconfinedLaunches >= 0, 'unconfinedLaunches is a non-negative number');
        ctx.expect.ok(Array.isArray(egress.allowlist) && egress.allowlist.includes('.npmjs.org'), 'allowlist contains the built-in defaults');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a caller with no membership on the target workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'egress_c2');
      try {
        const foreignWorkspaceId = '0'.repeat(24);
        const res = await ctx.callApi<{ workspaceId: string }, EgressStatusResponse>({ workspaceId: foreignWorkspaceId });
        ctx.expect.eq(res.status, 'error', 'egressStatus rejects a caller with no membership');
        if (res.status !== 'error') return;
        ctx.expect.eq(res.errorCode, 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
