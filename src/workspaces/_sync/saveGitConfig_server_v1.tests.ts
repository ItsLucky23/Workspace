import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveGitConfig/v1` — the realtime write that persists the
//? workspace's git strategy + push policy (branchStrategy.ts GitConfig). The auto-sweep does
//? not walk `_sync` routes, so these cases stand in for basic contract/auth coverage too:
//?  [1] happy path — a workspaceSettings-capable member saves a `typed` branch strategy;
//?      asserted via the REAL Prisma post-condition on `Workspace.gitConfig` (the Conductor's
//?      single-writer persistence), not just the ack — and the ack's normalized echo is checked too.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected
//?      with `auth.forbidden`, and the workspace's gitConfig is left untouched.

interface GitConfigInput {
  gitConfig: {
    branchStrategy: 'ticket-prefix' | 'typed' | 'custom';
    defaultBranchType: string;
    branchTemplate: string;
    pushPolicy: 'local-only' | 'push' | 'merge-request';
    targetBranch: string;
    protectedBranches: string[];
  };
  clientRequestId: string;
}
//? The HTTP sync harness wraps a route's own `SyncServerResponse` inside an outer
//? `{ status: 'success', message, result: <route output> }` envelope on success (see
//? `@luckystack/sync`'s http-sync handler); an RBAC/validation rejection short-circuits to
//? a FLAT `{ status: 'error', errorCode }` before that wrap ever happens. So a success case
//? reads the route's own fields off `res.result`, never off `res` directly.
interface SaveGitConfigOk {
  status: 'success';
  message: string;
  result: { status: 'success'; gitConfig: GitConfigInput['gitConfig'] };
}
interface SaveGitConfigErr {
  status: 'error';
  errorCode: string;
}
type SaveGitConfigResponse = SaveGitConfigOk | SaveGitConfigErr;

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

const NEW_CONFIG: GitConfigInput['gitConfig'] = {
  branchStrategy: 'typed',
  defaultBranchType: 'chore',
  branchTemplate: '{{type}}/{{key}}-{{slug}}',
  pushPolicy: 'push',
  targetBranch: 'develop',
  protectedBranches: ['develop', 'main'],
};

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path persists the normalized git config (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savegitconfig_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<GitConfigInput, SaveGitConfigResponse>(
          { gitConfig: NEW_CONFIG, clientRequestId: `sgc-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveGitConfig returns status "success"');
        if (res.status === 'success') {
          ctx.expect.eq(res.result.gitConfig.branchStrategy, 'typed', 'the ack echoes the normalized branchStrategy');
          ctx.expect.eq(res.result.gitConfig.targetBranch, 'develop', 'the ack echoes the normalized targetBranch');
        }

        const workspace = await poll(() =>
          ctx.prisma.workspace.findFirst({ where: { id: workspaceId, gitConfig: { not: null } } }),
        );
        ctx.expect.ok(workspace !== null, 'the Conductor persisted the gitConfig (post-condition, not just the ack)');
        const persisted = workspace?.gitConfig as Record<string, unknown> | null;
        ctx.expect.eq(persisted?.branchStrategy, 'typed', 'persisted branchStrategy matches');
        ctx.expect.eq(persisted?.pushPolicy, 'push', 'persisted pushPolicy matches');
        ctx.expect.eq(persisted?.targetBranch, 'develop', 'persisted targetBranch matches');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savegitconfig_c2');
      const outsider = await createRealUser(ctx.prisma, 'savegitconfig_c2_outsider');
      try {
        const before = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId } });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<GitConfigInput, SaveGitConfigResponse>(
          { gitConfig: NEW_CONFIG, clientRequestId: `sgc-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId } });
        ctx.expect.eq(
          JSON.stringify(after?.gitConfig ?? null),
          JSON.stringify(before?.gitConfig ?? null),
          'the workspace gitConfig was left untouched',
        );
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
