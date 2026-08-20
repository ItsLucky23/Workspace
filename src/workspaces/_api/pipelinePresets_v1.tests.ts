import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/pipelinePresets/v1` — the framework's own pipeline defaults, served
//? to the UI instead of copied into `src/`. The auto-sweep covers contract validation, auth enforcement,
//? rate-limit clamp and fuzz. These cover what it cannot infer:
//?  [1] The three presets exist and grow monotonically (simple ⊂ advanced ⊂ professional). The preset
//?      picker's warning ("removes: Refined, Plan, …") is computed from exactly this, so a preset that
//?      dropped a stage sideways would make the confirm dialog lie about what a switch does.
//?  [2] The blueprints are NOT empty. This route exists because blank stages are the bug; a route that
//?      cheerfully served empty defaults would make "use the default" a no-op button, which is worse
//?      than not offering it — the user would conclude the default IS empty.
//?  [3] editPipeline-gated: a logged-in user who is not a member gets `auth.forbidden`. The content is
//?      framework defaults rather than workspace data, but the gate is what keeps the route from
//?      confirming that an arbitrary workspace id exists.

interface PresetsInput { workspaceId: string }
interface Blueprint {
  systemPrompt: string;
  customInstructions: string;
  handoverPrompt: string;
  definitionOfDone: string;
  model: string;
  effort: string;
  maxTurns: number;
}
interface PresetsOk {
  status: 'success';
  result: {
    presets: { preset: string; stages: { key: string; name: string; kind: string; aiEnabled: boolean }[] }[];
    byKind: Record<string, Blueprint>;
    byKey: Record<string, Blueprint>;
  };
}
interface PresetsErr { status: 'error'; errorCode: string }
type PresetsResponse = PresetsOk | PresetsErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'the three presets nest: every simple stage is in advanced, every advanced stage is in professional',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'pipelinepresets_c1');
      try {
        const res = await ctx.callApi<PresetsInput, PresetsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'call succeeds');
        if (res.status !== 'success') return;

        const byName = new Map(res.result.presets.map((p) => [p.preset, p.stages.map((s) => s.key)]));
        ctx.expect.eq(res.result.presets.length, 3, 'simple, advanced and professional are all offered');
        const simple = byName.get('simple') ?? [];
        const advanced = byName.get('advanced') ?? [];
        const professional = byName.get('professional') ?? [];
        ctx.expect.ok(simple.length > 0 && advanced.length > simple.length && professional.length > advanced.length, 'each tier is strictly larger than the one below it');
        //? The nesting is what makes "switching tier adds columns, it does not rewrite history" true —
        //? a stage key that only existed in the middle tier would be silently destroyed by going up.
        ctx.expect.ok(simple.every((k) => advanced.includes(k)), 'simple is a subset of advanced');
        ctx.expect.ok(advanced.every((k) => professional.includes(k)), 'advanced is a subset of professional');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'the blueprints carry real text — an empty default would make "use the default" a no-op',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'pipelinepresets_c2');
      try {
        const res = await ctx.callApi<PresetsInput, PresetsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'success', 'call succeeds');
        if (res.status !== 'success') return;

        //? `code` is the kind a hand-added stage gets by default, so it is the one that matters most.
        const code = res.result.byKind.code;
        ctx.expect.ok(code !== undefined, 'the code kind has a blueprint');
        if (code === undefined) return;
        ctx.expect.ok(code.systemPrompt.trim().length > 0, 'a code stage starts with a persona');
        ctx.expect.ok(code.customInstructions.trim().length > 0, '…and with task instructions');
        //? Owner decision 2026-08-20 — the blueprint no longer carries an INCOMING template with
        //? `{{chips}}`; it carries what the stage hands to the next one, in plain language.
        ctx.expect.ok(code.handoverPrompt.trim().length > 0, '…and a handover instruction for the next stage');
        ctx.expect.ok(!code.handoverPrompt.includes('{{'), '…which is prose, not a slot template');
        ctx.expect.ok(['haiku', 'sonnet', 'opus'].includes(code.model), 'the model tier is one the stage runner understands');

        //? `final` is deliberately blank (AI off), so it must NOT be asserted as filled — that is the
        //? one kind where empty is the correct answer, and pretending otherwise would fill it wrongly.
        const impl = res.result.byKey.impl;
        ctx.expect.ok(impl !== undefined && impl.customInstructions.trim().length > 0, 'the seeded implementation stage has its own instructions, keyed by stage key');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a logged-in non-member is rejected (RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'pipelinepresets_c3');
      const outsider = await createRealUser(ctx.prisma, 'pipelinepresets_out');
      try {
        //? Re-login AS the outsider: a real, valid user with no membership of this workspace.
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        const res = await ctx.callApi<PresetsInput, PresetsResponse>({ workspaceId });
        ctx.expect.eq(res.status, 'error', 'a non-member does not get the route');
        if (res.status !== 'error') return;
        ctx.expect.eq(res.errorCode, 'auth.forbidden', 'and gets the RBAC error, not an empty result');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
