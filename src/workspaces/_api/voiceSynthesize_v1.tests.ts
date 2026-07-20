import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/voiceSynthesize/v1` — VO text-to-speech (the Assistant "speak
//? replies" opt-in). The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert
//? the business-logic the sweep can't reach:
//?  [1] a non-member of the workspace is rejected (`auth.forbidden`), even with valid input shape.
//?  [2] a member with whitespace-only `text` is rejected with the route's own post-trim validation
//?      (`voice.emptyText`) — this guard lives in `synthesizeSpeech` after `.trim()`, not the generic
//?      sweep's `typeof text === 'string'` contract check, since a whitespace string passes that.
//?  [3] a member with real text gets a well-formed response: EITHER a synthesized clip (`result.url`
//?      a non-empty string, `result.stub` a boolean — honestly `true` when the TTS provider has no
//?      key, per the metered media 'tts' feature's dummy-data mode) OR the honest degrade error when
//?      the live provider call itself fails (`voice.ttsFailed`). Provider-state-agnostic on purpose:
//?      whether the running server has a resolved ElevenLabs key is an environment fact this suite
//?      doesn't control — never fabricate silent-but-claimed audio.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId — the harness's
//? synthetic `test-user-<ts>` fallback is NOT a valid ObjectId and breaks the route's `@db.ObjectId`
//? membership query on `user.id`), logs in as it, then explicitly seeds a demo workspace (first-login
//? auto-seed was removed in commit 42632a2 — onboarding now owns the zero-workspace path). Teardown
//? via the shared `cleanupWorkspace` harness helper.

interface SynthesizeOk {
  status: 'success';
  result: { url: string; stub: boolean };
}
interface SynthesizeErr {
  status: 'error';
  errorCode: string;
}
type SynthesizeResponse = SynthesizeOk | SynthesizeErr;

//? Known error codes an honest degrade can surface: the route's own post-trim validation
//? (`voice.emptyText`), the budget guard (`voice.budgetExceeded` — not expected here, a freshly
//? seeded workspace has no `MediaBudget` row so `checkMediaBudget` is unlimited), or the generation
//? call itself failing (`voice.ttsFailed`) — see `server/voice/voice.ts`.
const KNOWN_DEGRADE_CODES = new Set(['voice.emptyText', 'voice.budgetExceeded', 'voice.ttsFailed']);

export const customTests: CustomTestCase[] = [
  {
    name: 'a non-member of the workspace is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'voiceSynthesize_c1');
      const outsider = await ctx.prisma.user.create({ data: { email: `lstest_voiceSynthesize_c1_outsider_${String(Date.now())}@youcomm.nl`, name: 'Outsider' } });
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name ?? 'Outsider' });
        const res = await ctx.callApi<{ workspaceId: string; text: string }, SynthesizeResponse>({
          workspaceId, text: 'hello there',
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
    name: 'a member with whitespace-only text is rejected with voice.emptyText',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'voiceSynthesize_c2');
      try {
        const res = await ctx.callApi<{ workspaceId: string; text: string }, SynthesizeResponse>({
          workspaceId, text: '   ',
        });
        ctx.expect.eq(res.status, 'error', 'whitespace-only text is rejected');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'voice.emptyText', `errorCode is voice.emptyText, got ${res.status === 'error' ? res.errorCode : res.status}`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a member with real text gets a well-formed response (synthesized clip or honest degrade)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'voiceSynthesize_c3');
      try {
        const res = await ctx.callApi<{ workspaceId: string; text: string }, SynthesizeResponse>({
          workspaceId, text: 'This is a test reply for the assistant to speak.',
        });
        if (res.status === 'success') {
          ctx.expect.ok(typeof res.result.url === 'string' && res.result.url.length > 0, 'result.url is a non-empty string on success');
          ctx.expect.ok(typeof res.result.stub === 'boolean', 'result.stub is a boolean on success');
          return;
        }
        ctx.expect.ok(KNOWN_DEGRADE_CODES.has(res.errorCode), `errorCode (${res.errorCode}) is a known honest-degrade code, not a crash`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
