import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/promptExperiments/v1`. The auto-sweep already covers
//? contract/auth/rate-limit/fuzz; these cases assert the business-logic the sweep can't
//? reach:
//?  [1] a workspace-settings member listing a freshly created (trial-less) experiment gets
//?      it back with the "not enough data yet" verdict and zero trial counts — the scoring
//?      pass (`experimentReport`) runs per-experiment and must not throw / must not fabricate
//?      a winner off zero evidence.
//?  [2] a member WITHOUT `workspaceSettings` (the built-in 'member' role) is rejected with
//?      `auth.forbidden` — prompts steer every AI run, so the route gates at the settings bar.
//?
//? Integration test: `loginSeededUser` creates a real `User` + seeds a demo workspace (owner
//? role, full perms), logs in as the owner. Case [2] creates a second real member with the
//? built-in 'member' role (no workspaceSettings) directly via `ctx.prisma.workspaceMember`.
//? Teardown via `cleanupWorkspace`.

interface PromptExperimentsOk {
  status: 'success';
  result: {
    experiments: {
      id: string; feature: string; name: string; status: string;
      trialsA: number; trialsB: number; winner: string; verdict: string;
    }[];
  };
}
interface PromptExperimentsErr {
  status: 'error';
  errorCode: string;
}
type PromptExperimentsResponse = PromptExperimentsOk | PromptExperimentsErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a workspace-settings member sees a trial-less experiment with the "not enough data" verdict',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'promptexp_c1');
      try {
        const experiment = await ctx.prisma.promptExperiment.create({
          data: { workspaceId, feature: 'workspace-chat', name: 'greeting tone', variantA: 'Be formal.', variantB: 'Be casual.' },
        });
        const res = await ctx.callApi<{ workspaceId: string }, PromptExperimentsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'promptExperiments returns status "success" for a workspaceSettings member');
        if (res.status !== 'success') return;
        const found = res.result.experiments.find((e) => e.id === experiment.id);
        ctx.expect.ok(found !== undefined, 'the freshly created experiment is present in result.experiments');
        if (found === undefined) return;
        ctx.expect.eq(found.trialsA, 0, 'trialsA is 0 with no PromptTrial rows');
        ctx.expect.eq(found.trialsB, 0, 'trialsB is 0 with no PromptTrial rows');
        ctx.expect.eq(found.winner, '', 'winner is empty (no verdict yet) with insufficient evidence');
        ctx.expect.ok(found.verdict.startsWith('Not enough data yet'), `verdict reports insufficient evidence, got "${found.verdict}"`);
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a member without workspaceSettings is rejected with auth.forbidden',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'promptexp_c2');
      const { createRealUser } = await import('../../../tests/_helpers.mjs');
      const member = await createRealUser(ctx.prisma, 'promptexp_c2_member');
      try {
        await ctx.prisma.workspaceMember.create({ data: { workspaceId, userId: member.id, roleKey: 'member' } });
        await ctx.session.login({ id: member.id, email: member.email, name: member.name });
        const res = await ctx.callApi<{ workspaceId: string }, PromptExperimentsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'promptExperiments rejects a member without workspaceSettings');
        if (res.status !== 'error') return;
        ctx.expect.eq(res.errorCode, 'auth.forbidden', 'errorCode is auth.forbidden');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, member.id]);
      }
    },
  },
];
