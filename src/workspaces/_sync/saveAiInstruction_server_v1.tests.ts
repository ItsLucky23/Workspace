import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveAiInstruction/v1` — the realtime write that persists
//? the workspace-wide "how the AI should work here" instruction + output language + the
//? per-workspace Gemini overrides. The auto-sweep does not walk `_sync` routes, so these cases
//? stand in for basic contract/auth coverage too:
//?  [1] happy path — a workspaceSettings-capable member saves the instruction fields; asserted
//?      via the REAL Prisma post-condition on `Workspace` (the Conductor's single-writer
//?      persistence), not just the ack — including the geminiTemperature CLAMP the Conductor
//?      applies (source: `save-ai-instruction` case, clamps to Gemini's valid 0.0–2.0 range).
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` is rejected with
//?      `auth.forbidden`, and the workspace row is left untouched.

interface SaveAiInstructionInput {
  aiInstruction: string;
  outputLanguage: string;
  geminiModel: string;
  geminiTemperature: string;
  geminiBaseUrl: string;
  clientRequestId: string;
}
//? The HTTP sync harness wraps a route's own `SyncServerResponse` inside an outer
//? `{ status: 'success', message, result: <route output> }` envelope on success (see
//? `@luckystack/sync`'s http-sync handler); an RBAC rejection short-circuits to a FLAT
//? `{ status: 'error', errorCode }` before that wrap ever happens. So a success case reads
//? the route's own fields off `res.result`, never off `res` directly.
interface SaveAiInstructionOk {
  status: 'success';
  message: string;
  result: {
    status: 'success';
    aiInstruction: string;
    outputLanguage: string;
    geminiModel: string;
    geminiTemperature: string;
    geminiBaseUrl: string;
  };
}
interface SaveAiInstructionErr {
  status: 'error';
  errorCode: string;
}
type SaveAiInstructionResponse = SaveAiInstructionOk | SaveAiInstructionErr;

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
    name: 'happy path persists the instruction fields, clamping an out-of-range temperature (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveaiinstruction_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const aiInstruction = `Always be concise ${String(Date.now())}`;
        const res = await ctx.callSync<SaveAiInstructionInput, SaveAiInstructionResponse>(
          {
            aiInstruction, outputLanguage: 'Dutch', geminiModel: 'gemini-2.0-flash',
            geminiTemperature: '9.9', geminiBaseUrl: 'https://gemini.example.com',
            clientRequestId: `sai-c1-${String(Date.now())}`,
          },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveAiInstruction returns status "success"');
        //? The route's own ack (`saveAiInstruction_server_v1.ts`) echoes the CLIENT's raw
        //? `clientInput` fields, not the Conductor's clamped result — only the Prisma
        //? post-condition below reflects the clamp (`save-ai-instruction` case, conductor.ts).
        if (res.status === 'success') {
          ctx.expect.eq(res.result.aiInstruction, aiInstruction, 'the ack echoes the saved instruction');
        }

        const workspace = await poll(() => ctx.prisma.workspace.findFirst({ where: { id: workspaceId, aiInstruction } }));
        ctx.expect.ok(workspace !== null, 'the Conductor persisted the instruction (post-condition, not just the ack)');
        ctx.expect.eq(workspace?.outputLanguage, 'Dutch', 'persisted outputLanguage matches');
        ctx.expect.eq(workspace?.geminiModel, 'gemini-2.0-flash', 'persisted geminiModel matches');
        ctx.expect.eq(workspace?.geminiTemperature, '2', 'persisted geminiTemperature is CLAMPED to the max (2)');
        ctx.expect.eq(workspace?.geminiBaseUrl, 'https://gemini.example.com', 'persisted geminiBaseUrl matches');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveaiinstruction_c2');
      const outsider = await createRealUser(ctx.prisma, 'saveaiinstruction_c2_outsider');
      try {
        const before = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId } });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveAiInstructionInput, SaveAiInstructionResponse>(
          {
            aiInstruction: 'Should not be saved', outputLanguage: 'English', geminiModel: '',
            geminiTemperature: '', geminiBaseUrl: '', clientRequestId: `sai-c2-${String(Date.now())}`,
          },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId } });
        ctx.expect.eq(after?.aiInstruction ?? '', before?.aiInstruction ?? '', 'the workspace aiInstruction was left untouched');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
