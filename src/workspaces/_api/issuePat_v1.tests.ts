import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';
import { hashToken } from '../../../server/auth/pat';

//? Per-route tests for `workspaces/issuePat/v1` — X3 mints a Personal Access Token
//? for a member. The auto-sweep already covers contract/auth/rate-limit/fuzz; these
//? cases assert the business-logic the sweep can't reach:
//?  [1] a request with a mix of allowed + unknown scopes persists ONLY the allowed
//?      ones, the persisted row's `tokenHash` matches the returned raw token (never
//?      the raw token or hash itself surfacing anywhere but the one-time response),
//?      and the row is scoped to the caller + workspace.
//?  [2] a request with only unknown scopes is rejected `pat.noScopes` and no row is
//?      persisted.
//?
//? Integration test: `loginSeededUser` seeds a real workspace + owner membership
//? (the route only requires membership, not a capability). Teardown via
//? `cleanupWorkspace` (covers `PersonalAccessToken` rows).

interface IssueOk {
  status: 'success';
  result: { id: string; token: string; prefix: string; scopes: string[] };
}
interface IssueErr {
  status: 'error';
  errorCode: string;
}
type IssueResponse = IssueOk | IssueErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a mix of allowed + unknown scopes persists only the allowed ones, hashed',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'issuePat_c1');
      try {
        const res = await ctx.callApi<{ workspaceId: string; name?: string; scopes?: string[] }, IssueResponse>({
          workspaceId,
          name: 'CI token',
          scopes: ['tickets:write', 'not-a-real-scope'],
        });
        ctx.expect.eq(res.status, 'success', 'issuePat returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.scopes, ['tickets:write'], 'only the allowed scope is kept');
        ctx.expect.ok(res.result.token.startsWith('wsk_'), 'the raw token has the wsk_ prefix');
        const row = await ctx.prisma.personalAccessToken.findUnique({ where: { id: res.result.id }, select: { tokenHash: true, userId: true, workspaceId: true, scopes: true, name: true } });
        ctx.expect.ok(row !== null, 'a PersonalAccessToken row was persisted');
        if (!row) return;
        ctx.expect.eq(row.tokenHash, hashToken(res.result.token), 'the persisted hash matches the returned raw token');
        ctx.expect.eq(row.userId, userId, 'the row is scoped to the caller');
        ctx.expect.eq(row.workspaceId, workspaceId, 'the row is scoped to the workspace');
        ctx.expect.eq(row.scopes, ['tickets:write'], 'only the allowed scope is persisted');
        ctx.expect.eq(row.name, 'CI token', 'the requested name is persisted');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a request with only unknown scopes is rejected and persists nothing',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'issuePat_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string; scopes?: string[] }, IssueResponse>({
          workspaceId,
          scopes: ['not-a-real-scope'],
        });
        ctx.expect.eq(res.status, 'error', 'a request with only unknown scopes is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'pat.noScopes', 'the error code is pat.noScopes');
        const count = await ctx.prisma.personalAccessToken.count({ where: { workspaceId, userId } });
        ctx.expect.eq(count, 0, 'no PersonalAccessToken row was persisted');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
