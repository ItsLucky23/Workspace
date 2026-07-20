import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';
import { generateToken } from '../../../server/auth/pat';

//? Per-route tests for `workspaces/revokePat/v1` — X3 revokes the CALLER'S OWN token
//? only. The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases
//? assert the business-logic the sweep can't reach:
//?  [1] the owner revoking their own token flips `revoked: true` (the row is kept as
//?      an audit record, not deleted).
//?  [2] another member cannot revoke a token they don't own — `pat.notFound` (the
//?      `userId`-scoped `updateMany` matches zero rows) and the row stays unrevoked.
//?
//? Integration test: `loginSeededUser` seeds a real workspace + owner membership; a
//? PAT row is pre-seeded directly via `ctx.prisma.personalAccessToken`. Case [2]
//? adds a second real member attempting to revoke the first member's token. Teardown
//? via `cleanupWorkspace` (covers `PersonalAccessToken` rows).

interface RevokeOk {
  status: 'success';
  result: { revoked: true };
}
interface RevokeErr {
  status: 'error';
  errorCode: string;
}
type RevokeResponse = RevokeOk | RevokeErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'the owner revoking their own token flips revoked to true (row kept)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'revokePat_c1');
      try {
        const token = generateToken();
        const pat = await ctx.prisma.personalAccessToken.create({
          data: { userId, workspaceId, name: 'To revoke', tokenHash: token.hash, tokenPrefix: token.prefix, scopes: ['tickets:write'] },
        });
        const res = await ctx.callApi<{ patId: string }, RevokeResponse>({ patId: pat.id });
        ctx.expect.eq(res.status, 'success', 'revokePat returns status "success"');
        ctx.expect.ok(res.status === 'success' && res.result.revoked, 'result.revoked is true');
        const row = await ctx.prisma.personalAccessToken.findUnique({ where: { id: pat.id }, select: { revoked: true } });
        ctx.expect.ok(row !== null, 'the PersonalAccessToken row still exists (kept as an audit record)');
        ctx.expect.eq(row?.revoked, true, 'the row is flagged revoked');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'another member cannot revoke someone else\'s token',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'revokePat_c2_owner');
      const otherMember = await createRealUser(ctx.prisma, 'revokePat_c2_other');
      try {
        await ctx.prisma.workspaceMember.create({ data: { workspaceId, userId: otherMember.id, roleKey: 'member' } });
        const token = generateToken();
        const pat = await ctx.prisma.personalAccessToken.create({
          data: { userId: ownerId, workspaceId, name: 'Owner\'s token', tokenHash: token.hash, tokenPrefix: token.prefix, scopes: ['tickets:write'] },
        });
        await ctx.session.login({ id: otherMember.id, email: otherMember.email, name: otherMember.name });
        const res = await ctx.callApi<{ patId: string }, RevokeResponse>({ patId: pat.id });
        ctx.expect.eq(res.status, 'error', 'another member cannot revoke a token they do not own');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'pat.notFound', 'the error code is pat.notFound');
        const row = await ctx.prisma.personalAccessToken.findUnique({ where: { id: pat.id }, select: { revoked: true } });
        ctx.expect.eq(row?.revoked, false, 'the owner\'s token stays unrevoked');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, otherMember.id]);
      }
    },
  },
];
