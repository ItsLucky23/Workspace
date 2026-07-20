import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/presence/v1` — the who's-viewing REALTIME relay (#17).
//? Per the route's own doc-comment: "No server state + no Conductor write (presence is
//? ephemeral, not authoritative)". `main()` re-broadcasts `{ userId, ticketKey, viewing,
//? claiming, view }` — the authenticated user id ALWAYS comes from the session, never the
//? client, so presence can't be spoofed. Since nothing is persisted, there is no Prisma
//? row to poll; the ack itself is the only observable behaviour, so these cases assert
//? against it directly (there's no Conductor/single-writer step in this route at all):
//?  [1] happy path — a ticket-viewing ping echoes the presence payload with the SESSION
//?      user id (not anything client-supplied), proving the anti-spoof guarantee.
//?  [2] validation boundary — a ping with neither `ticketKey` nor `view` is rejected with
//?      `sync.invalidRequest` (the route's own validation, read from the source).

interface PresenceInput {
  ticketKey?: string;
  viewing: boolean;
  claiming?: boolean;
  view?: string;
  clientRequestId: string;
}
interface PresenceOk {
  status: 'success';
  //? The HTTP sync transport wraps a successful `_server` return under `result`
  //? (`{ status: 'success', message, result: serverOutput }` — see
  //? `@luckystack/sync`'s `handleHttpSyncRequestScoped`); only the error shape is flat.
  result: { presence: { userId: string; ticketKey: string; viewing: boolean; claiming: boolean; view: string } };
}
interface PresenceErr {
  status: 'error';
  errorCode: string;
}
type PresenceResponse = PresenceOk | PresenceErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: a ticket-viewing ping echoes the presence payload keyed by the SESSION user id',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'presence_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const seededTicket = await ctx.prisma.ticket.findFirst({ where: { workspaceId } });
        const ticketKey = seededTicket?.key ?? '';

        const res = await ctx.callSync<PresenceInput, PresenceResponse>(
          { ticketKey, viewing: true, clientRequestId: `pr-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'presence returns status "success"');
        if (res.status === 'success') {
          ctx.expect.eq(res.result.presence.userId, userId, 'the presence payload carries the SESSION user id (anti-spoof — not client-supplied)');
          ctx.expect.eq(res.result.presence.ticketKey, ticketKey, 'the presence payload echoes the ticketKey being viewed');
          ctx.expect.eq(res.result.presence.viewing, true, 'the presence payload echoes viewing=true');
          ctx.expect.eq(res.result.presence.claiming, false, 'claiming defaults to false when not sent');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a ping with neither ticketKey nor view is rejected (validation boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'presence_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<PresenceInput, PresenceResponse>(
          { viewing: true, clientRequestId: `pr-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a ping with neither ticketKey nor view is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected with sync.invalidRequest (the route\'s own validation)');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
