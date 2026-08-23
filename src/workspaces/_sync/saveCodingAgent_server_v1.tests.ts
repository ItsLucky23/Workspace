import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveCodingAgent/v1` (ADR 0322) — the realtime write that persists the
//? coding agent (seat + harness + tier map) as the `__coding_agent` EnvVar:
//?  [1] happy path — a Codex seat persists, and the HARNESS IS FORCED to pi whatever the payload said (the
//?      Conductor rule, asserted on the REAL Prisma row, not the ack).
//?  [2] a Claude seat keeps the requested harness and its own defaults; an unknown seat is rejected, nothing written.
//?  [3] tenant/RBAC boundary — a room member who is NOT a WorkspaceMember is rejected with `auth.forbidden`.

interface SaveCodingAgentInput {
  subscription: string;
  harness?: string;
  tierModels?: Record<string, string>;
  clientRequestId: string;
}
interface CodingAgentAck { subscription: string; harness: string; tierModels: Record<string, string> }
interface SaveOk { status: 'success'; message: string; result: { status: 'success'; codingAgent: CodingAgentAck } }
interface SaveErr { status: 'error'; errorCode: string }
type SaveResponse = SaveOk | SaveErr;

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
    name: 'happy path: a Codex seat persists and the harness is forced to pi (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savecodingagent_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveCodingAgentInput, SaveResponse>(
          { subscription: 'codex', harness: 'claude-code', tierModels: { opus: 'gpt-5.6-terra' }, clientRequestId: `sca-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveCodingAgent returns status "success"');
        if (res.status === 'success') {
          ctx.expect.eq(res.result.codingAgent.subscription, 'codex', 'the ack carries the seat');
          ctx.expect.eq(res.result.codingAgent.harness, 'pi-agent', 'a Codex seat is forced onto pi, whatever the payload said');
          ctx.expect.eq(res.result.codingAgent.tierModels.opus, 'gpt-5.6-terra', 'an explicit tier model survives');
          ctx.expect.eq(res.result.codingAgent.tierModels.haiku, 'gpt-5.4-mini', 'an omitted tier falls back to the seat default');
        }
        const row = await poll(() => ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__coding_agent' } }));
        ctx.expect.ok(row !== null, 'the Conductor persisted the config (post-condition, not just the ack)');
        const stored = JSON.parse(row?.value ?? '{}') as CodingAgentAck;
        ctx.expect.eq(stored.harness, 'pi-agent', 'the STORED harness is pi — the rule is enforced at the single writer');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a Claude seat keeps its harness + defaults; an unknown seat is rejected and nothing is written',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savecodingagent_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const ok = await ctx.callSync<SaveCodingAgentInput, SaveResponse>(
          { subscription: 'claude', harness: 'pi-agent', clientRequestId: `sca-c2a-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(ok.status, 'success', 'a Claude seat on pi is accepted (warned in the UI, allowed by the owner)');
        if (ok.status === 'success') {
          ctx.expect.eq(ok.result.codingAgent.harness, 'pi-agent', 'the requested harness is kept for a Claude seat');
          ctx.expect.eq(ok.result.codingAgent.tierModels.sonnet, 'claude-sonnet-5', 'pi needs real Anthropic model ids, not the CLI tier aliases');
        }
        const bad = await ctx.callSync<SaveCodingAgentInput, SaveResponse>(
          { subscription: 'gemini', clientRequestId: `sca-c2b-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(bad.status, 'error', 'an unknown seat is rejected');
        await wait(300);
        const row = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__coding_agent' } });
        const stored = JSON.parse(row?.value ?? '{}') as CodingAgentAck;
        ctx.expect.eq(stored.subscription, 'claude', 'the rejected save did not overwrite the stored config');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'savecodingagent_c3');
      const outsider = await createRealUser(ctx.prisma, 'savecodingagent_c3_outsider');
      try {
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SaveCodingAgentInput, SaveResponse>(
          { subscription: 'codex', clientRequestId: `sca-c3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an outsider is rejected');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'auth.forbidden', 'with the RBAC error code');
        await wait(300);
        const row = await ctx.prisma.envVar.findFirst({ where: { workspaceId, key: '__coding_agent' } });
        ctx.expect.ok(row === null, 'nothing was written');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
