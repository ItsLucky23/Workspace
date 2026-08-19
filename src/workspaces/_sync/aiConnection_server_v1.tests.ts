import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/aiConnection/v1` — the connected AIs (ADR 0007). The auto-sweep
//? covers contract validation, auth enforcement and fuzz. These cover what it cannot infer, and every
//? one is a way to lose a credential or to leave the workspace unable to run an AI:
//?  [1] The key is stored ENCRYPTED. Plaintext in the store would be readable by anything that dumps
//?      the collection, and nothing else in the app would ever notice.
//?  [2] A metered backend without a key, or without a model, is REFUSED. Such a row would sit in the
//?      list looking connected and fail at the first turn — the failure this page exists to remove.
//?  [3] Disconnecting the last connection of a provider MOVES the features routed to it. A dialog that
//?      promises a migration nothing performs is worse than no dialog.
//?  [4] Two models of the SAME provider coexist. That is the whole reason this is a list.
//?  [5] The RBAC boundary: it writes a credential, so a non-member is refused and nothing is stored.

interface ConnInput {
  op: string;
  providerId?: string;
  model?: string;
  apiKey?: string;
  connectionId?: string;
  clientRequestId: string;
}
interface ConnOk { status: 'success'; result?: unknown }
interface ConnErr { status: 'error'; errorCode: string }
type ConnResponse = ConnOk | ConnErr;

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
    name: 'connecting stores the key encrypted, and two models of one provider coexist',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiconn_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const SECRET = `sk-test-${String(Date.now())}`;
        const res = await ctx.callSync<ConnInput, ConnResponse>(
          { op: 'ai-connection-add', providerId: 'openai-api', model: 'gpt-4o-mini', apiKey: SECRET, clientRequestId: `aic-c1a-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'the connection is created');

        const row = await poll(async () => ctx.prisma.aiConnection.findFirst({ where: { workspaceId, providerId: 'openai-api', model: 'gpt-4o-mini' } }));
        ctx.expect.ok(row !== null, 'the Conductor stored it (post-condition, not just the ack)');
        //? The exact ciphertext is not the assertion — that it is NOT the plaintext is.
        ctx.expect.ok(row?.apiKey !== SECRET, 'the key is encrypted at rest, not the raw value');
        ctx.expect.ok((row?.apiKey ?? '').length > 0, '…and it was actually stored');

        //? A SECOND model of the same provider. This is the whole point of a list — a per-provider
        //? record could not hold both.
        await ctx.callSync<ConnInput, ConnResponse>(
          { op: 'ai-connection-add', providerId: 'openai-api', model: 'gpt-4.1', apiKey: 'sk-second', clientRequestId: `aic-c1b-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        const both = await poll(async () => {
          const rows = await ctx.prisma.aiConnection.findMany({ where: { workspaceId, providerId: 'openai-api' } });
          return rows.length === 2 ? rows : null;
        });
        ctx.expect.ok(both !== null, 'both models are connected side by side');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a metered backend is refused without a key or without a model',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiconn_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const noKey = await ctx.callSync<ConnInput, ConnResponse>(
          { op: 'ai-connection-add', providerId: 'openai-api', model: 'gpt-4o', apiKey: '', clientRequestId: `aic-c2a-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(noKey.status, 'error', 'a metered backend without a key is refused');

        const noModel = await ctx.callSync<ConnInput, ConnResponse>(
          { op: 'ai-connection-add', providerId: 'openai-api', model: '', apiKey: 'sk-x', clientRequestId: `aic-c2b-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(noModel.status, 'error', '…and so is one without a model');

        //? Nothing half-created: a rejected add must not leave a row that looks connected.
        const rows = await ctx.prisma.aiConnection.findMany({ where: { workspaceId } });
        ctx.expect.eq(rows.length, 0, 'neither attempt left a row behind');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'disconnecting the last connection of a provider moves the features routed to it',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiconn_c3');
      try {
        await joinRoom(ctx, workspaceId);
        //? Two backends, and a feature pinned to the one that is about to go.
        await ctx.callSync<ConnInput, ConnResponse>({ op: 'ai-connection-add', providerId: 'openai-api', model: 'gpt-4o', apiKey: 'sk-a', clientRequestId: `aic-c3a-${String(Date.now())}` }, { receiver: workspaceId });
        await ctx.callSync<ConnInput, ConnResponse>({ op: 'ai-connection-add', providerId: 'gemini-api', model: 'gemini-2.5-flash', apiKey: 'g-a', clientRequestId: `aic-c3b-${String(Date.now())}` }, { receiver: workspaceId });
        const target = await poll(async () => ctx.prisma.aiConnection.findFirst({ where: { workspaceId, providerId: 'openai-api' } }));
        if (!target) throw new Error('the openai connection was not created');
        await ctx.prisma.envVar.create({ data: { workspaceId, key: '__ai_provider_script', value: 'openai-api', secret: false } });

        await ctx.callSync<ConnInput, ConnResponse>(
          { op: 'ai-connection-remove', connectionId: target.id, clientRequestId: `aic-c3c-${String(Date.now())}` },
          { receiver: workspaceId },
        );

        const moved = await poll(async () => {
          const row = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__ai_provider_script' } });
          return row?.value === 'gemini-api' ? row : null;
        });
        //? The feature is now routed at the backend that REMAINS — not left pointing at one that can
        //? no longer run, which is a silent dispatch failure with no error anywhere.
        ctx.expect.ok(moved !== null, 'the routed feature moved to the remaining backend');
        const gone = await ctx.prisma.aiConnection.findFirst({ where: { workspaceId, id: target.id } });
        ctx.expect.eq(gone, null, 'and the connection itself is gone');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (it writes a credential)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'aiconn_c4');
      const outsider = await createRealUser(ctx.prisma, 'aiconn_out');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ConnInput, ConnResponse>(
          { op: 'ai-connection-add', providerId: 'openai-api', model: 'gpt-4o', apiKey: 'sk-should-never-land', clientRequestId: `aic-c4-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an outsider cannot connect an AI to someone else’s workspace');
        const rows = await ctx.prisma.aiConnection.findMany({ where: { workspaceId } });
        ctx.expect.eq(rows.length, 0, '…and nothing was stored');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
