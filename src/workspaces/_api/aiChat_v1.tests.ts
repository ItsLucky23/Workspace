import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/aiChat/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep
//? can't reach:
//?  [1] omitting `projectId` short-circuits `interpretChat` BEFORE any AI-provider call
//?      (deterministic: `error: 'project.notFound'`, `proposal: null`) — AND the turn is
//?      still persisted as two `WorkspaceChatMessage` rows (#111), even on this early error.
//?  [2] a caller who is not a member of the target workspace is rejected with
//?      `auth.forbidden` before any chat/AI work happens.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId) + seeds a
//? demo workspace, logs in as the owner. No AI-provider keys are available in the test
//? harness (provider keys are blanked by `tests/_helpers.mjs`'s stub-world default), so the
//? happy-path case deliberately takes the pre-AI early-return path rather than depending on
//? a live/stubbed provider result. Teardown via `cleanupWorkspace`.

interface AiChatOk {
  status: 'success';
  result: { reply: string; proposal: unknown; error?: string };
}
interface AiChatErr {
  status: 'error';
  errorCode: string;
}
type AiChatResponse = AiChatOk | AiChatErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'omitting projectId short-circuits before any AI call and still persists the chat turn',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aichat_c1');
      try {
        const message = 'what does this codebase do?';
        const res = await ctx.callApi<{ workspaceId: string; message: string }, AiChatResponse>({ workspaceId, message });
        ctx.expect.eq(res.status, 'success', 'aiChat returns status "success" even on the pre-AI early return');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.error, 'project.notFound', 'result.error is "project.notFound" when no projectId is supplied');
        ctx.expect.eq(res.result.proposal, null, 'result.proposal is null');

        const messages = await ctx.prisma.workspaceChatMessage.findMany({ where: { workspaceId, userId } });
        ctx.expect.eq(messages.length, 2, 'the turn is persisted as exactly 2 WorkspaceChatMessage rows (user + ai)');
        const userMsg = messages.find((m) => m.role === 'user');
        ctx.expect.ok(userMsg?.text === message, 'the user-role message stores the original message text');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a caller who is not a member of the target workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aichat_c2');
      try {
        //? A well-formed but foreign workspaceId (the caller is a member of `workspaceId`, not this one).
        const foreignWorkspaceId = '0'.repeat(24);
        const res = await ctx.callApi<{ workspaceId: string; message: string }, AiChatResponse>({ workspaceId: foreignWorkspaceId, message: 'hello' });
        ctx.expect.eq(res.status, 'error', 'aiChat rejects a non-member workspace');
        if (res.status !== 'error') return;
        ctx.expect.eq(res.errorCode, 'auth.forbidden', 'errorCode is auth.forbidden for a non-member workspace');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
