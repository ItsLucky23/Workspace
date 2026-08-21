import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/integrationTest/v1` (ADR 0320). The auto-sweep covers contract
//? validation, auth enforcement and fuzz. These cover what it cannot infer:
//?  [1] The verdict is PERSISTED on the row, not just returned — that is what makes the list say
//?      something on the next visit instead of only to whoever clicked.
//?  [2] An integration whose fields point at nothing reports `unsupported`, never `failed`. Those are
//?      different problems: one is "you haven't configured it", the other is "your database is down",
//?      and conflating them sends the user to the wrong place.
//?  [3] A dead address is `failed`, and the reason survives into the detail line.
//?  [4] The RBAC boundary: it decrypts a credential and dials a host, so a non-member is refused.

interface TestInput { integrationId: string; clientRequestId: string }
interface TestOk { status: 'success'; result?: { status?: string; detail?: string } }
interface TestErr { status: 'error'; errorCode: string }
type TestResponse = TestOk | TestErr;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

//? Written straight to the store rather than through `saveIntegration`: `callSync` can only invoke the
//? route under test, and the save path has its own coverage. What matters here is the row's shape.
async function makeIntegration(ctx: TestContext, workspaceId: string, name: string, type: string, envVarId: string | null): Promise<string> {
  const row = await ctx.prisma.integrationTool.create({
    data: { workspaceId, name, type, fields: [{ id: 'f1', label: 'Connection string', envVarId }], mcp: { enabled: false, command: '' } },
  });
  return row.id;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'an unconfigured integration reports unsupported, and the verdict is stored on the row',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'inttest_c1');
      try {
        await joinRoom(ctx, workspaceId);
        //? envVarId null = the user picked the type but never pointed the field at a variable. This is
        //? the most common half-finished state, and it must not read as a broken database.
        const id = await makeIntegration(ctx, workspaceId, `Probe Unset ${String(Date.now())}`, 'mongodb', null);
        ctx.expect.ok(id.length > 0, 'the integration was created');

        const res = await ctx.callSync<TestInput, TestResponse>(
          { integrationId: id, clientRequestId: `int-t1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'the test call itself succeeds — a bad integration is a verdict, not an error');

        //? Asserted on the ROW rather than on the response envelope: the row IS the feature (the list has
        //? to say something on the next visit), and it does not move when the sync wrapper's shape does.
        const stored = await poll(async () => {
          const row = await ctx.prisma.integrationTool.findFirst({ where: { workspaceId, id } });
          return row?.lastTestStatus === null || row?.lastTestStatus === undefined ? null : row;
        });
        ctx.expect.eq(stored?.lastTestStatus, 'unsupported', 'nothing configured ⇒ unsupported, NOT failed — and it is persisted');
        ctx.expect.ok((stored?.lastTestDetail ?? '').length > 0, '…with a reason a human can act on');
        ctx.expect.ok(stored?.lastTestAt !== null && stored?.lastTestAt !== undefined, '…and a timestamp');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'an address nothing is listening on is a failure, with the reason in the detail',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'inttest_c2');
      try {
        await joinRoom(ctx, workspaceId);
        //? Port 9 (discard) on localhost: reliably closed on a dev machine, and no network egress —
        //? a public unroutable address would make this test slow and flaky instead of fast and true.
        const env = await ctx.prisma.envVar.create({ data: { workspaceId, key: `PROBE_DEAD_${String(Date.now())}`, value: 'postgres://127.0.0.1:9/app', secret: false } });
        const id = await makeIntegration(ctx, workspaceId, `Probe Dead ${String(Date.now())}`, 'postgres', env.id);

        const res = await ctx.callSync<TestInput, TestResponse>(
          { integrationId: id, clientRequestId: `int-t2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'the call succeeds — a dead database is a verdict, not a route error');
        const stored = await poll(async () => {
          const row = await ctx.prisma.integrationTool.findFirst({ where: { workspaceId, id } });
          return row?.lastTestStatus === null || row?.lastTestStatus === undefined ? null : row;
        });
        ctx.expect.eq(stored?.lastTestStatus, 'failed', 'a closed port is a failure');
        ctx.expect.ok((stored?.lastTestDetail ?? '').includes('127.0.0.1'), 'the detail names the address that did not answer');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-member cannot make this server dial a host',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'inttest_c3');
      const outsider = await createRealUser(ctx.prisma, 'inttest_c3_out');
      try {
        await joinRoom(ctx, workspaceId);
        const id = await makeIntegration(ctx, workspaceId, `Probe RBAC ${String(Date.now())}`, 'mongodb', null);

        //? The op decrypts a credential and opens an outbound connection to a user-supplied address.
        //? Anyone outside the workspace being able to trigger that is the whole reason it is capability-
        //? gated rather than a plain read.
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<TestInput, TestResponse>(
          { integrationId: id, clientRequestId: `int-t3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an outsider is refused');

        //? …and refused BEFORE anything happened: no verdict was written.
        const row = await ctx.prisma.integrationTool.findFirst({ where: { workspaceId, id } });
        ctx.expect.ok(row?.lastTestStatus === null || row?.lastTestStatus === undefined, 'the refused call left no test result behind');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
