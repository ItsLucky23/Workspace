import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/voiceTranscribe/v1` — VO speech-to-text. The auto-sweep
//? already covers contract/auth/rate-limit/fuzz; these cases assert the business-logic the
//? sweep can't reach:
//?  [1] a non-member of the workspace is rejected (`auth.forbidden`), even with valid input shape.
//?  [2] a member with an `audioUrl` that isn't a `/media/...` path is rejected with the route's own
//?      validation error (`voice.invalidAudio`) — this guard lives in `transcribeAudio`, not the
//?      generic sweep's contract check, since `data`-level typing alone can't catch it.
//?  [3] a member with a well-formed `/media/...` audioUrl reaches the AI layer and gets back a
//?      well-formed response: EITHER a successful transcript (`result.text` a string) OR an honest
//?      degrade error from the provider-abstracted STT call (never a crash / unrelated error code).
//?      This is deliberately provider-state-agnostic — whether the running server has a resolved STT
//?      key is an environment fact this suite doesn't control (ADR 0275: never fabricate a transcript).
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId — the harness's
//? synthetic `test-user-<ts>` fallback is NOT a valid ObjectId and breaks the route's `@db.ObjectId`
//? membership query on `user.id`), logs in as it, then explicitly seeds a demo workspace (first-login
//? auto-seed was removed in commit 42632a2 — onboarding now owns the zero-workspace path). Teardown
//? via the shared `cleanupWorkspace` harness helper.

interface TranscribeOk {
  status: 'success';
  result: { text: string };
}
interface TranscribeErr {
  status: 'error';
  errorCode: string;
}
type TranscribeResponse = TranscribeOk | TranscribeErr;

//? Known error codes an honest degrade can surface: the route's own validation
//? (`voice.invalidAudio`), the STT call itself failing outright (`voice.sttFailed`), or the
//? provider-abstraction layer's own no-key / breaker-open degrades (`ai.providerUnavailable`,
//? `ai.circuitOpen`) — see `server/ai/registry.ts`.
const KNOWN_DEGRADE_CODES = new Set(['voice.invalidAudio', 'voice.sttFailed', 'ai.providerUnavailable', 'ai.circuitOpen']);

export const customTests: CustomTestCase[] = [
  {
    name: 'a non-member of the workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'voiceTranscribe_c1');
      const outsider = await ctx.prisma.user.create({ data: { email: `lstest_voiceTranscribe_c1_outsider_${String(Date.now())}@youcomm.nl`, name: 'Outsider' } });
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name ?? 'Outsider' });
        const res = await ctx.callApi<{ workspaceId: string; audioUrl: string }, TranscribeResponse>({
          workspaceId, audioUrl: '/media/some-clip.webm',
        });
        ctx.expect.eq(res.status, 'error', 'a non-member gets an error response');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'auth.forbidden', `errorCode is auth.forbidden, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await ctx.prisma.user.delete({ where: { id: outsider.id } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a member with a non-/media/ audioUrl is rejected with voice.invalidAudio',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'voiceTranscribe_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string; audioUrl: string }, TranscribeResponse>({
          workspaceId, audioUrl: 'https://evil.example.com/clip.webm',
        });
        ctx.expect.eq(res.status, 'error', 'a non-/media/ audioUrl is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'voice.invalidAudio', `errorCode is voice.invalidAudio, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a member with a well-formed /media/ audioUrl gets a well-formed response (success or honest degrade)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'voiceTranscribe_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string; audioUrl: string }, TranscribeResponse>({
          workspaceId, audioUrl: '/media/test-clip.webm',
        });
        if (res.status === 'success') {
          ctx.expect.ok(typeof res.result.text === 'string', 'result.text is a string on success');
          return;
        }
        ctx.expect.ok(KNOWN_DEGRADE_CODES.has(res.errorCode), `errorCode (${res.errorCode}) is a known honest-degrade code, not a crash`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
