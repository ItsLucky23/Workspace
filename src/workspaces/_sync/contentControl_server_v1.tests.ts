import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/contentControl/v1` — the content-generation control-op
//? gateway (create/advance/archive + every gen op, whitelisted to `CONTENT_OPS`). Covers:
//?  [1] happy path — `content-create` dispatched through the Conductor; asserted via the
//?      real Prisma post-condition (a `ContentProject` row), not just the ack.
//?  [2] the op whitelist itself — an op outside `CONTENT_OPS` (e.g. a settings-only op) is
//?      rejected with `sync.invalidRequest` before it ever reaches the Conductor/RBAC.

interface ContentControlInput {
  op: string; clientRequestId: string;
  projectId?: string; title?: string;
}
interface ContentControlOk { status: 'success' }
interface ContentControlErr { status: 'error'; errorCode: string }
type ContentControlResponse = ContentControlOk | ContentControlErr;

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
    name: 'happy path: content-create persists a ContentProject (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c1');
      try {
        await joinRoom(ctx, workspaceId);
        //? `ContentProject.projectId` is `@db.ObjectId` — it points at the seeded demo `Project` row,
        //? not an arbitrary string (an invalid ObjectId here throws inside the Conductor's write and
        //? surfaces as `sync.invalidRequest`, not a Prisma error).
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        ctx.expect.ok(project !== null, 'the seeded demo workspace ships at least one Project');
        if (!project) return;
        const projectId = project.id;
        const title = `Sync harness content ${String(Date.now())}`;
        const res = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'content-create', clientRequestId: `cc-c1-${String(Date.now())}`, projectId, title },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'contentControl returns status "success"');

        const piece = await poll(() => ctx.prisma.contentProject.findFirst({ where: { workspaceId, projectId } }));
        ctx.expect.ok(piece !== null, 'the Conductor persisted the ContentProject (post-condition, not just the ack)');
        ctx.expect.eq(piece?.title, title, 'the persisted piece carries the title we sent');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an op outside the content-op whitelist is rejected before reaching the Conductor',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentcontrol_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ContentControlInput, ContentControlResponse>(
          { op: 'edit-media-budget', clientRequestId: `cc-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an op outside CONTENT_OPS is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected with sync.invalidRequest (whitelist check), not auth/Conductor error');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
