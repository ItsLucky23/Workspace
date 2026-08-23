import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveAiProvider/v1` — the realtime write that persists a
//? per-workspace AI provider override for one feature (as an `EnvVar` keyed
//? `__ai_provider_<feature>`), the seam that feeds `resolveAssignment`'s override lookup. The
//? auto-sweep does not walk `_sync` routes, so these cases stand in for basic contract/auth
//? coverage too:
//?  [1] happy path — a workspaceSettings-capable member sets an override; asserted via the REAL
//?      Prisma post-condition on `EnvVar` (the Conductor's single-writer persistence), not just
//?      the ack.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected with
//?      `auth.forbidden`, and no `EnvVar` row is created.
//?  [3] P4-1/P4-2 — the `_default` pseudo-feature + a `model` pin persist as `providerId:model` and come back
//?      SPLIT in the ack; a blank `model` is rejected (ai.modelRequired) and nothing is written.

interface SaveAiProviderInput {
  feature: string;
  providerId: string;
  model?: string;
  clientRequestId: string;
}
//? The HTTP sync harness wraps a route's own `SyncServerResponse` inside an outer
//? `{ status: 'success', message, result: <route output> }` envelope on success (see
//? `@luckystack/sync`'s http-sync handler); an RBAC rejection short-circuits to a FLAT
//? `{ status: 'error', errorCode }` before that wrap ever happens. So a success case reads
//? the route's own fields off `res.result`, never off `res` directly.
interface SaveAiProviderOk {
  status: 'success';
  message: string;
  result: { status: 'success'; aiOverrides: { feature: string; providerId: string; model?: string }[] };
}
interface SaveAiProviderErr {
  status: 'error';
  errorCode: string;
}
type SaveAiProviderResponse = SaveAiProviderOk | SaveAiProviderErr;

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
    //? F-017 — an id outside the provider catalog is REJECTED, never stored: a stored-but-ignored override
    //? made the picker look applied while dispatch kept using the default.
    name: 'an unknown providerId is rejected and nothing is persisted',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveaiprovider_c0');
      try {
        await joinRoom(ctx, workspaceId);
        const feature = `bogus-${String(Date.now())}`;
        const res = await ctx.callSync<SaveAiProviderInput, SaveAiProviderResponse>(
          { feature, providerId: 'not-a-provider', clientRequestId: `sap-c0-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'saveAiProvider rejects an unknown provider id');
        await wait(300);
        const envVar = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: `__ai_provider_${feature}` } });
        ctx.expect.ok(envVar === null, 'no override row was written for the unknown id');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'happy path persists an EnvVar override (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveaiprovider_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const feature = `refine-${String(Date.now())}`;
        //? A CATALOG id (server/ai/providers/catalog.ts). 'gemini' used to pass here and was then silently
        //? dropped at dispatch — exactly the stored-but-ignored override F-017 closes.
        const providerId = 'gemini-api';
        const res = await ctx.callSync<SaveAiProviderInput, SaveAiProviderResponse>(
          { feature, providerId, clientRequestId: `sap-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveAiProvider returns status "success"');
        if (res.status === 'success') {
          ctx.expect.ok(
            res.result.aiOverrides.some((o) => o.feature === feature && o.providerId === providerId),
            'the ack echoes the full override map including the new entry',
          );
        }

        const envVar = await poll(() => ctx.prisma.envVar.findFirst({ where: { workspaceId, key: `__ai_provider_${feature}` } }));
        ctx.expect.ok(envVar !== null, 'the Conductor persisted the override (post-condition, not just the ack)');
        ctx.expect.eq(envVar?.value, providerId, 'persisted value matches the chosen providerId');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'P4-1/P4-2: `_default` + model pin persist as providerId:model and echo split; blank model rejected',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveaiprovider_c3');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveAiProviderInput, SaveAiProviderResponse>(
          { feature: '_default', providerId: 'openai-api', model: 'gpt-4.1-mini', clientRequestId: `sap-c3a-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'the _default pseudo-feature is accepted');
        if (res.status === 'success') {
          const row = res.result.aiOverrides.find((o) => o.feature === '_default');
          ctx.expect.eq(row?.providerId, 'openai-api', 'the ack carries the provider part');
          ctx.expect.eq(row?.model, 'gpt-4.1-mini', 'the ack carries the model part separately');
        }
        const envVar = await poll(() => ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__ai_provider__default' } }));
        ctx.expect.eq(envVar?.value, 'openai-api:gpt-4.1-mini', 'stored as providerId:model under __ai_provider__default');

        const bad = await ctx.callSync<SaveAiProviderInput, SaveAiProviderResponse>(
          { feature: 'script', providerId: 'openai-api', model: '   ', clientRequestId: `sap-c3b-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(bad.status, 'error', 'a blank model is rejected');
        await wait(300);
        const none = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__ai_provider_script' } });
        ctx.expect.ok(none === null, 'nothing was written for the rejected save');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveaiprovider_c2');
      const outsider = await createRealUser(ctx.prisma, 'saveaiprovider_c2_outsider');
      try {
        const feature = `refine-${String(Date.now())}`;
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveAiProviderInput, SaveAiProviderResponse>(
          { feature, providerId: 'gemini', clientRequestId: `sap-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const envVar = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: `__ai_provider_${feature}` } });
        ctx.expect.ok(envVar === null, 'no EnvVar override was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
