import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveSections/v1` — persists the workspace's enabled
//? nav-section set (module gating). The Conductor sanitizes to the known gateable ids.
//?  [1] happy path — a valid section list is persisted (Prisma post-condition) and echoed
//?      back sanitized on the ack.
//?  [2] tenant/RBAC boundary — a room member without a `WorkspaceMember` row is rejected
//?      with `auth.forbidden`, and `enabledSections` is unchanged.
//?
//? Note on the HTTP-harness ack shape: `ctx.callSync` posts to the `/sync/...` HTTP endpoint
//? (not the socket ack), which wraps a SUCCESSFUL route result under `result` — the route's
//? own `serverOutput` fields (`enabledSections`, …) are NOT at the top level. An ERROR result
//? is flattened at the top level instead (`status`/`errorCode` directly). See both shapes below.

interface SaveSectionsInput {
  enabledSections: string[];
  clientRequestId: string;
}
interface SaveSectionsOk {
  status: 'success';
  result: { status: 'success'; enabledSections: string[] };
}
interface SaveSectionsErr {
  status: 'error';
  errorCode: string;
}
type SaveSectionsResponse = SaveSectionsOk | SaveSectionsErr;

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
    name: 'happy path persists a sanitized section list (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savesections_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveSectionsInput, SaveSectionsResponse>(
          { enabledSections: ['board', 'backlog', 'not-a-real-section'], clientRequestId: `ss-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveSections returns status "success"');
        if (res.status === 'success') {
          const { enabledSections } = res.result;
          ctx.expect.ok(enabledSections.includes('board') && enabledSections.includes('backlog'), 'the ack echoes the known sections');
          ctx.expect.ok(!enabledSections.includes('not-a-real-section'), 'the ack drops an unknown section id');
        }

        const workspace = await poll(() => ctx.prisma.workspace.findFirst({
          where: { id: workspaceId, enabledSections: { has: 'board' } },
        }));
        ctx.expect.ok(workspace !== null, 'the Conductor persisted the sanitized section list');
        ctx.expect.ok(!(workspace?.enabledSections ?? []).includes('not-a-real-section'), 'the persisted list drops the unknown section id');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savesections_c2');
      const outsider = await createRealUser(ctx.prisma, 'savesections_c2_outsider');
      const before = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { enabledSections: true } });
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveSectionsInput, SaveSectionsResponse>(
          { enabledSections: ['board'], clientRequestId: `ss-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { enabledSections: true } });
        ctx.expect.eq(after?.enabledSections, before?.enabledSections, 'enabledSections is unchanged for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
