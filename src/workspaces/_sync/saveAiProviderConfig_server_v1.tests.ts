import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveAiProviderConfig/v1` — the credentials + settings for one TEXT
//? backend (ADR 0007). The auto-sweep covers contract validation, auth enforcement and fuzz. These
//? cover what it cannot infer, and every one of them is a way to lose or leak a credential:
//?  [1] The key is stored ENCRYPTED and marked secret. A key sitting in plaintext in the EnvVar store
//?      would be readable by anything that dumps the collection, and nothing else in the app would
//?      ever notice.
//?  [2] Saving a MODEL must not clear a stored key. The form omits `apiKey` when you did not retype
//?      it, so a routine "switch to gpt-4.1" would otherwise silently disconnect the backend.
//?  [3] An empty value CLEARS its override rather than storing "". Storing the empty string would pin
//?      the model to nothing, which resolves to a request with no model at all.
//?  [4] The RBAC boundary: it writes a credential, so a non-member is refused.

interface ConfigInput {
  providerId: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: string;
  clientRequestId: string;
}
interface ConfigOk { status: 'success' }
interface ConfigErr { status: 'error'; errorCode: string }
type ConfigResponse = ConfigOk | ConfigErr;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 6000, stepMs = 50): Promise<T | null> {
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
    name: 'the API key is stored encrypted and marked secret, alongside the plain settings',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiprovcfg_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const SECRET = `sk-test-${String(Date.now())}`;
        const res = await ctx.callSync<ConfigInput, ConfigResponse>(
          { providerId: 'openai-api', apiKey: SECRET, model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', temperature: '0.4', clientRequestId: `aipc-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveAiProviderConfig returns status "success"');

        const keyRow = await poll(async () => ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__provider_key_openai-api' } }));
        ctx.expect.ok(keyRow !== null, 'the Conductor stored the key (post-condition, not just the ack)');
        ctx.expect.eq(keyRow?.secret, true, 'it is marked secret');
        //? The exact ciphertext is not the assertion — that it is NOT the plaintext is.
        ctx.expect.ok(keyRow?.value !== SECRET, 'and it is encrypted at rest, not the raw key');

        const model = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__ai_model_openai-api' } });
        ctx.expect.eq(model?.value, 'gpt-4o-mini', 'the model is stored');
        ctx.expect.eq(model?.secret, false, '…as a plain setting, not a secret');
        const temp = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__ai_temp_openai-api' } });
        ctx.expect.eq(temp?.value, '0.4', 'the temperature is stored');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'saving a model without an apiKey leaves the stored key untouched',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiprovcfg_c2');
      try {
        await joinRoom(ctx, workspaceId);
        await ctx.callSync<ConfigInput, ConfigResponse>(
          { providerId: 'openai-api', apiKey: 'sk-keep-me', model: 'gpt-4o', clientRequestId: `aipc-c2a-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        const before = await poll(async () => ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__provider_key_openai-api' } }));
        ctx.expect.ok(before !== null, 'the key was stored to begin with');

        //? The form's normal second save: a model change, with NO apiKey field sent.
        await ctx.callSync<ConfigInput, ConfigResponse>(
          { providerId: 'openai-api', model: 'gpt-4.1', clientRequestId: `aipc-c2b-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        const changed = await poll(async () => {
          const row = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__ai_model_openai-api' } });
          return row?.value === 'gpt-4.1' ? row : null;
        });
        ctx.expect.ok(changed !== null, 'the model changed');

        const after = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__provider_key_openai-api' } });
        ctx.expect.ok(after !== null, 'the key survived a save that did not mention it');
        ctx.expect.eq(after?.value, before?.value, '…byte for byte — it was never rewritten');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an empty value clears its override instead of storing an empty string',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiprovcfg_c3');
      try {
        await joinRoom(ctx, workspaceId);
        await ctx.callSync<ConfigInput, ConfigResponse>(
          { providerId: 'gemini-api', model: 'gemini-2.5-pro', clientRequestId: `aipc-c3a-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        await poll(async () => ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__ai_model_gemini-api' } }));

        await ctx.callSync<ConfigInput, ConfigResponse>(
          { providerId: 'gemini-api', model: '', clientRequestId: `aipc-c3b-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        //? Gone, not empty: an empty string pins the model to nothing, which resolves to a request with
        //? no model. Absence is what makes the catalog default apply.
        const cleared = await poll(async () => {
          const row = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__ai_model_gemini-api' } });
          return row === null ? true : null;
        });
        ctx.expect.ok(cleared === true, 'the override row was deleted, not blanked');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (it writes a credential)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiprovcfg_c4');
      const outsider = await createRealUser(ctx.prisma, 'aiprovcfg_out');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ConfigInput, ConfigResponse>(
          { providerId: 'openai-api', apiKey: 'sk-should-never-land', clientRequestId: `aipc-c4-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an outsider cannot write a credential into someone else’s workspace');
        const row = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__provider_key_openai-api' } });
        ctx.expect.eq(row, null, '…and nothing was stored');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
