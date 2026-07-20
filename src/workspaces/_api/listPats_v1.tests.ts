import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';
import { generateToken } from '../../../server/auth/pat';

//? Per-route tests for `workspaces/listPats/v1` — X3 lists the CALLER's own tokens
//? for a workspace (never a hash or raw token). The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep
//? can't reach:
//?  [1] the caller's own non-revoked token is listed with prefix/name/scopes, a
//?      revoked token of the caller's is excluded, and another member's token is
//?      excluded too (own-tokens-only, not workspace-wide).
//?  [2] the response never leaks `tokenHash` or the raw token (shape check on the
//?      wire, not just the Prisma `select`).
//?
//? Integration test: `loginSeededUser` seeds a real workspace + owner membership;
//? rows are pre-seeded directly via `ctx.prisma.personalAccessToken` (own/revoked/
//? another-member's) so the route's filter logic is exercised end-to-end. Teardown
//? via `cleanupWorkspace` (covers `PersonalAccessToken` rows).

interface ListOk {
  status: 'success';
  result: { tokens: { id: string; name: string; prefix: string; scopes: string[]; createdAt: number }[] };
}
interface ListErr {
  status: 'error';
  errorCode: string;
}
type ListResponse = ListOk | ListErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'lists only the caller\'s own non-revoked tokens for the workspace',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'listPats_c1');
      const otherMember = await createRealUser(ctx.prisma, 'listPats_c1_other');
      try {
        await ctx.prisma.workspaceMember.create({ data: { workspaceId, userId: otherMember.id, roleKey: 'member' } });
        const own = generateToken();
        const ownRow = await ctx.prisma.personalAccessToken.create({
          data: { userId, workspaceId, name: 'My active token', tokenHash: own.hash, tokenPrefix: own.prefix, scopes: ['tickets:write'] },
        });
        const revoked = generateToken();
        await ctx.prisma.personalAccessToken.create({
          data: { userId, workspaceId, name: 'My revoked token', tokenHash: revoked.hash, tokenPrefix: revoked.prefix, scopes: ['tickets:write'], revoked: true },
        });
        const other = generateToken();
        await ctx.prisma.personalAccessToken.create({
          data: { userId: otherMember.id, workspaceId, name: 'Someone else\'s token', tokenHash: other.hash, tokenPrefix: other.prefix, scopes: ['content:write'] },
        });

        const res = await ctx.callApi<{ workspaceId: string }, ListResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'listPats returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.tokens.length, 1, 'exactly the caller\'s one non-revoked token is listed');
        const listed = res.result.tokens[0];
        ctx.expect.ok(listed !== undefined, 'the token list has an entry');
        if (!listed) return;
        ctx.expect.eq(listed.id, ownRow.id, 'the listed token is the caller\'s active one');
        ctx.expect.ok(!('tokenHash' in listed), 'the response never includes tokenHash');
        ctx.expect.ok(!('token' in listed), 'the response never includes the raw token');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, otherMember.id]);
      }
    },
  },
];
