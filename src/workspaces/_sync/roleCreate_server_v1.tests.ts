import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/roleCreate/v1` — creates a custom `WorkspaceRole`
//? via the Conductor (op `role-create`, requires editPipeline).
//?  [1] happy path — owner (all perms) creates a custom role; asserted via the REAL
//?      Prisma post-condition (a non-builtin `WorkspaceRole` row), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and no role is created.

interface RoleCreateInput {
  key: string;
  label: string;
  perms: boolean[];
  clientRequestId: string;
}
interface RoleCreateOk {
  status: 'success';
  role: { key: string; label: string } | null;
}
interface RoleCreateErr {
  status: 'error';
  errorCode: string;
}
type RoleCreateResponse = RoleCreateOk | RoleCreateErr;

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
    name: 'happy path creates a custom role (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'rolecreate_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const key = `custom-c1-${String(Date.now())}`;
        const res = await ctx.callSync<RoleCreateInput, RoleCreateResponse>(
          { key, label: 'Custom Reviewer', perms: [true, false, false, false, false, false, false, false], clientRequestId: `rolec-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'roleCreate returns status "success"');

        const role = await poll(() => ctx.prisma.workspaceRole.findFirst({ where: { workspaceId, key } }));
        ctx.expect.ok(role !== null, 'the Conductor persisted the custom role (post-condition, not just the ack)');
        ctx.expect.eq(role?.builtIn, false, 'a role created via role-create is not builtIn');
        ctx.expect.eq(role?.label, 'Custom Reviewer', 'the role carries the requested label');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'rolecreate_c2');
      const outsider = await createRealUser(ctx.prisma, 'rolecreate_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const key = `custom-c2-${String(Date.now())}`;
        const res = await ctx.callSync<RoleCreateInput, RoleCreateResponse>(
          { key, label: 'Should Not Exist', perms: [true, false, false, false, false, false, false, false], clientRequestId: `rolec-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const role = await ctx.prisma.workspaceRole.findFirst({ where: { workspaceId, key } });
        ctx.expect.ok(role === null, 'no role was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
