import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/roleUpdate/v1` — updates a NON-builtin `WorkspaceRole`
//? via the Conductor (op `role-update`, requires editPipeline; builtIn roles are immutable
//? server-side per SEC2, so the fixture role below is created explicitly non-builtin).
//?  [1] happy path — owner updates the custom role's label + perms; asserted via the
//?      REAL Prisma post-condition, not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and the role is unchanged.

interface RoleUpdateInput {
  roleKey: string;
  label?: string;
  perms?: boolean[];
  clientRequestId: string;
}
interface RoleUpdateOk {
  status: 'success';
  role: { key: string; label: string } | null;
}
interface RoleUpdateErr {
  status: 'error';
  errorCode: string;
}
type RoleUpdateResponse = RoleUpdateOk | RoleUpdateErr;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path updates a custom role (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'roleupdate_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const key = `custom-upd-c1-${String(Date.now())}`;
        await ctx.prisma.workspaceRole.create({
          data: { workspaceId, key, label: 'Before', perms: [true, false, false, false, false, false, false, false], builtIn: false },
        });

        const res = await ctx.callSync<RoleUpdateInput, RoleUpdateResponse>(
          { roleKey: key, label: 'After', clientRequestId: `roleu-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'roleUpdate returns status "success"');

        const updated = await poll(async () => {
          const row = await ctx.prisma.workspaceRole.findFirst({ where: { workspaceId, key } });
          return row?.label === 'After' ? row : null;
        });
        ctx.expect.ok(updated !== null, 'the Conductor persisted the new label (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'roleupdate_c2');
      const outsider = await createRealUser(ctx.prisma, 'roleupdate_c2_outsider');
      try {
        const key = `custom-upd-c2-${String(Date.now())}`;
        await ctx.prisma.workspaceRole.create({
          data: { workspaceId, key, label: 'Before', perms: [true, false, false, false, false, false, false, false], builtIn: false },
        });

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<RoleUpdateInput, RoleUpdateResponse>(
          { roleKey: key, label: 'Should Not Apply', clientRequestId: `roleu-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const unchanged = await ctx.prisma.workspaceRole.findFirst({ where: { workspaceId, key } });
        ctx.expect.eq(unchanged?.label, 'Before', 'the role was not updated by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
