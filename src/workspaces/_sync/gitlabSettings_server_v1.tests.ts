import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/gitlabSettings/v1` — the realtime write that persists
//? the workspace's forge base URL + (app-encrypted) token. The auto-sweep does not walk
//? `_sync` routes, so these cases stand in for basic contract/auth coverage too:
//?  [1] happy path — a workspaceSettings-capable member saves the GitLab base URL + token;
//?      asserted via the REAL Prisma post-condition on `Workspace` (gitlabUrl/forgeType/
//?      the token being ENCRYPTED at rest, never the plaintext — B-07), not just the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected
//?      with `auth.forbidden`, and the workspace row is left untouched.

interface GitlabSettingsInput {
  baseUrl: string;
  token?: string;
  forgeType?: string;
  clientRequestId: string;
}
interface GitlabSettingsOk {
  status: 'success';
}
interface GitlabSettingsErr {
  status: 'error';
  errorCode: string;
}
type GitlabSettingsResponse = GitlabSettingsOk | GitlabSettingsErr;

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
    name: 'happy path persists the forge base URL + an ENCRYPTED token (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'gitlabsettings_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const baseUrl = `https://gitlab.example.com/${String(Date.now())}`;
        const rawToken = `glpat-${String(Date.now())}`;
        const res = await ctx.callSync<GitlabSettingsInput, GitlabSettingsResponse>(
          { baseUrl, token: rawToken, forgeType: 'gitlab', clientRequestId: `gls-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'gitlabSettings returns status "success"');

        const workspace = await poll(() => ctx.prisma.workspace.findFirst({ where: { id: workspaceId, gitlabUrl: baseUrl } }));
        ctx.expect.ok(workspace !== null, 'the Conductor persisted the new gitlabUrl (post-condition, not just the ack)');
        ctx.expect.eq(workspace?.forgeType, 'gitlab', 'forgeType was persisted');
        ctx.expect.ok(typeof workspace?.gitlabTokenEnc === 'string' && workspace.gitlabTokenEnc.length > 0, 'a token was persisted');
        ctx.expect.ok(workspace?.gitlabTokenEnc !== rawToken, 'the persisted token is ENCRYPTED, never the plaintext (B-07)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'gitlabsettings_c2');
      const outsider = await createRealUser(ctx.prisma, 'gitlabsettings_c2_outsider');
      try {
        const before = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId } });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<GitlabSettingsInput, GitlabSettingsResponse>(
          { baseUrl: 'https://should-not-be-saved.example.com', clientRequestId: `gls-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId } });
        ctx.expect.eq(after?.gitlabUrl ?? null, before?.gitlabUrl ?? null, 'the workspace gitlabUrl was left untouched');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
