import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/agentTerm/v1` — the BROADCAST-ONLY realtime carrier
//? (#20) that only registers the `{ ticketKey, chunk }` payload shape in the generated
//? type maps for `upsertSyncEventCallback('workspaces/agentTerm')`. Per the route's own
//? doc-comment: "a direct call is a no-op. NOT authoritative state — pure observability."
//?
//? Unlike the other routes in this batch, `main()` never touches Prisma, the Conductor,
//? or a container/PTY — it unconditionally returns a typed `{ status: 'success', ticketKey:
//? '', chunk: '' }` ack for ANY authenticated, room-admitted caller, with no RBAC/`dispatchControlSync`
//? gate at all. There is therefore no container dependency to defer here (unlike
//? `agentControl`'s `resume`/`kill`), and no real DB post-condition to poll (nothing is
//? written) — the ack IS the observable behaviour, so these cases assert against it
//? directly, matching how the route itself documents its contract:
//?  [1] happy path — an authenticated workspace member gets the documented no-op ack.
//?  [2] a room member who is NOT a `WorkspaceMember` of the workspace ALSO gets the same
//?      ack — proving (and pinning) that this route intentionally has no RBAC gate, so a
//?      future accidental RBAC addition here would be caught as a regression.

interface AgentTermInput {
  clientRequestId: string;
}
interface AgentTermOk {
  status: 'success';
  //? The HTTP sync transport wraps a successful `_server` return under `result`
  //? (`{ status: 'success', message, result: serverOutput }` — see
  //? `@luckystack/sync`'s `handleHttpSyncRequestScoped`); only the error shape is flat.
  result: { ticketKey: string; chunk: string };
}
interface AgentTermErr {
  status: 'error';
  errorCode: string;
}
type AgentTermResponse = AgentTermOk | AgentTermErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: an authenticated workspace member gets the documented no-op ack',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'agentterm_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<AgentTermInput, AgentTermResponse>(
          { clientRequestId: `at-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'agentTerm returns status "success"');
        if (res.status === 'success') {
          ctx.expect.eq(res.result.ticketKey, '', 'the no-op ack carries an empty ticketKey (type-carrier only)');
          ctx.expect.eq(res.result.chunk, '', 'the no-op ack carries an empty chunk (type-carrier only)');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row still gets success (documented: no RBAC gate on this broadcast-only carrier)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'agentterm_c2');
      const outsider = await createRealUser(ctx.prisma, 'agentterm_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace).
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<AgentTermInput, AgentTermResponse>(
          { clientRequestId: `at-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'a room-admitted non-member still gets "success" — this route has no RBAC gate');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
