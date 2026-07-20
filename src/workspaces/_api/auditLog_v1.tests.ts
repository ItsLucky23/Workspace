import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/auditLog/v1` — H1 the admin/security audit view
//? (`workspaceSettings`-gated, tenant-scoped, newest-first with resolved actor
//? names). The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases
//? assert the business-logic the sweep can't reach:
//?  [1] entries come back newest-first with the actor's display name resolved (not
//?      the raw actorId) for a real seeded AuditLog row.
//?  [2] a member whose role lacks `workspaceSettings` (the seeded demo `member`
//?      role) is rejected `auth.forbidden`.
//?
//? Integration test: `loginSeededUser` seeds a real workspace + owner membership
//? (owner has every capability). An `AuditLog` row is pre-seeded directly via
//? `ctx.prisma.auditLog`. Case [2] adds a second real user with the built-in
//? `member` role (perms[workspaceSettings] === false per the seeded RBAC matrix).
//? Teardown via `cleanupWorkspace` (covers `AuditLog` rows).

interface AuditOk {
  status: 'success';
  result: { entries: { id: string; action: string; target: string | null; actorName: string; createdAt: string }[] };
}
interface AuditErr {
  status: 'error';
  errorCode: string;
}
type AuditResponse = AuditOk | AuditErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'lists entries newest-first with the actor\'s display name resolved',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'auditLog_c1');
      try {
        const owner = await ctx.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
        const older = await ctx.prisma.auditLog.create({ data: { workspaceId, actorId: userId, action: 'role-update', target: 'admin' } });
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        const newer = await ctx.prisma.auditLog.create({ data: { workspaceId, actorId: userId, action: 'invite', target: 'someone@youcomm.nl' } });

        const res = await ctx.callApi<{ workspaceId: string }, AuditResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'auditLog returns status "success"');
        if (res.status !== 'success') return;
        const entryIds = res.result.entries.map((e) => e.id);
        const newerIdx = entryIds.indexOf(newer.id);
        const olderIdx = entryIds.indexOf(older.id);
        ctx.expect.ok(newerIdx !== -1 && olderIdx !== -1, 'both seeded entries are present');
        ctx.expect.ok(newerIdx < olderIdx, 'entries come back newest-first');
        const newerEntry = res.result.entries.find((e) => e.id === newer.id);
        ctx.expect.eq(newerEntry?.actorName, owner?.name ?? owner?.email, 'the actor display name is resolved, not the raw actorId');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a member without workspaceSettings is forbidden',
    run: async (ctx: TestContext) => {
      const { userId: ownerId, workspaceId } = await loginSeededUser(ctx, 'auditLog_c2_owner');
      const member = await createRealUser(ctx.prisma, 'auditLog_c2_member');
      try {
        await ctx.prisma.workspaceMember.create({ data: { workspaceId, userId: member.id, roleKey: 'member' } });
        await ctx.session.login({ id: member.id, email: member.email, name: member.name });
        const res = await ctx.callApi<{ workspaceId: string }, AuditResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'a member without workspaceSettings cannot read the audit log');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', 'the error code is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [ownerId, member.id]);
      }
    },
  },
];
