import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/commentReplyDraft/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach:
//?  [1] a real question comment ("...?") drafts a REPLY with `sentiment: 'question'` and
//?      non-empty text. `result.stub` is asserted only to be a boolean, not a specific value —
//?      whether `draftReply` used the honest stub fallback or a live AI provider depends on
//?      whether the running server has a resolved provider key, an environment fact this suite
//?      doesn't control (same provider-state-agnostic posture as `voiceSynthesize_v1.tests.ts`).
//?  [2] a `commentId` that does not belong to (or exist in) the target workspace is rejected
//?      with `api.invalidRequest` — the tenant-scoped `socialComment.findFirst` guard.
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace (owner
//? role, full perms — `workTickets`), logs in as the owner. Case [1] creates a real
//? `SocialComment` row directly via `ctx.prisma`. Teardown via `cleanupWorkspace`.

interface CommentReplyDraftOk {
  status: 'success';
  result: { text: string; sentiment: string; stub: boolean };
}
interface CommentReplyDraftErr {
  status: 'error';
  errorCode: string;
}
type CommentReplyDraftResponse = CommentReplyDraftOk | CommentReplyDraftErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a question comment drafts the stub question-fallback reply with sentiment "question"',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'commentdraft_c1');
      try {
        const comment = await ctx.prisma.socialComment.create({
          data: {
            workspaceId, platform: 'youtube', externalVideoId: 'vid1', externalId: 'ext1',
            author: 'viewer1', text: 'Can you cover this topic in more depth?', publishedAt: new Date(),
          },
        });
        const res = await ctx.callApi<{ workspaceId: string; commentId: string }, CommentReplyDraftResponse>({ workspaceId, commentId: comment.id });
        ctx.expect.eq(res.status, 'success', 'commentReplyDraft returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.eq(res.result.sentiment, 'question', 'sentiment is classified as "question" (the text contains "?")');
        ctx.expect.ok(typeof res.result.stub === 'boolean', 'result.stub is a boolean (stub-vs-live depends on the running server\'s provider keys)');
        ctx.expect.ok(res.result.text.length > 0, 'result.text is non-empty');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a commentId that does not belong to the workspace is rejected with api.invalidRequest',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'commentdraft_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string; commentId: string }, CommentReplyDraftResponse>({ workspaceId, commentId: '0'.repeat(24) });
        ctx.expect.eq(res.status, 'error', 'commentReplyDraft rejects a commentId that does not resolve in this workspace');
        if (res.status !== 'error') return;
        ctx.expect.eq(res.errorCode, 'api.invalidRequest', 'errorCode is api.invalidRequest');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
