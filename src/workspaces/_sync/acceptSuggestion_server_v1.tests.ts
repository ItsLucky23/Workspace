import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/acceptSuggestion/v1` — accepts an AI WorkspaceSuggestion
//? (status → accepted), broadcasting its id so every client drops it from the open list.
//? Uses a plain suggestion type ('link-tickets') so the assertion targets the shared
//? accept-path (status flip) rather than a type-specific side-effect (automation/mr-review/
//? rollback/publish each fire additional writes covered by their own routes). The route's
//? suggestions are workspace-owned authoritative proposals (some execute automation/publish effects),
//? so acceptance requires `workTickets` in addition to the transport's room-membership gate.
//?  [1] happy path — a room member accepts an open suggestion; asserted via the REAL Prisma
//?      post-condition (WorkspaceSuggestion.status), not just the ack (the sync harness wraps
//?      a successful ack's business payload under `result`, matching the framework's own
//?      contract — see `node_modules/@luckystack/test-runner`'s `parseResponse`).
//?  [2] the transport-level room-membership gate still applies to this route (like every sync
//?      route): calling WITHOUT `joinRoom` is rejected with `sync.notRoomMember`.
//?  [3] a room member whose custom role lacks workTickets gets auth.forbidden and no status flip.

interface AcceptSuggestionInput { suggestionId: string; action?: 'accept' | 'dismiss'; clientRequestId: string }
interface AcceptSuggestionOk { status: 'success'; result: { status: 'success'; acceptedSuggestionId?: string; dismissedSuggestionId?: string } }
interface AcceptSuggestionErr { status: 'error'; errorCode: string }
type AcceptSuggestionResponse = AcceptSuggestionOk | AcceptSuggestionErr;

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
    name: 'happy path accepts an open suggestion (Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'acceptsuggestion_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const suggestion = await ctx.prisma.workspaceSuggestion.create({
          data: { workspaceId, type: 'link-tickets', title: `Suggestion ${String(Date.now())}`, body: 'link these two tickets', ticketIds: [], status: 'open' },
        });

        const res = await ctx.callSync<AcceptSuggestionInput, AcceptSuggestionResponse>(
          { suggestionId: suggestion.id, clientRequestId: `as-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'acceptSuggestion returns status "success"');
        if (res.status === 'success') {
          ctx.expect.eq(res.result.acceptedSuggestionId, suggestion.id, 'the ack echoes the accepted suggestion id');
        }

        const updated = await poll(() => ctx.prisma.workspaceSuggestion.findFirst({ where: { workspaceId, id: suggestion.id, status: 'accepted' } }));
        ctx.expect.ok(updated !== null, 'the Conductor flipped the suggestion to accepted (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'dismiss action persists an open suggestion as dismissed',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'acceptsuggestion_dismiss');
      try {
        await joinRoom(ctx, workspaceId);
        const suggestion = await ctx.prisma.workspaceSuggestion.create({
          data: { workspaceId, type: 'link-tickets', title: `Dismiss ${String(Date.now())}`, body: 'dismiss this', ticketIds: [], status: 'open' },
        });
        const res = await ctx.callSync<AcceptSuggestionInput, AcceptSuggestionResponse>(
          { suggestionId: suggestion.id, action: 'dismiss', clientRequestId: `as-dismiss-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'dismiss returns status "success"');
        if (res.status === 'success') ctx.expect.eq(res.result.dismissedSuggestionId, suggestion.id, 'the ack echoes the dismissed suggestion id');
        const updated = await poll(() => ctx.prisma.workspaceSuggestion.findFirst({ where: { workspaceId, id: suggestion.id, status: 'dismissed' } }));
        ctx.expect.ok(updated !== null, 'the Conductor persisted the dismissed status');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a non-room-member call is rejected by the transport-level room-membership gate',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'acceptsuggestion_c2');
      const outsider = await createRealUser(ctx.prisma, 'acceptsuggestion_c2_outsider');
      try {
        const suggestion = await ctx.prisma.workspaceSuggestion.create({
          data: { workspaceId, type: 'link-tickets', title: `Outsider suggestion ${String(Date.now())}`, body: 'should stay open', ticketIds: [], status: 'open' },
        });

        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Deliberately skip joinRoom so the base transport boundary is exercised separately from RBAC.
        const res = await ctx.callSync<AcceptSuggestionInput, AcceptSuggestionResponse>(
          { suggestionId: suggestion.id, clientRequestId: `as-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-room-member call is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.notRoomMember', 'rejected by the transport-level room-membership gate');
        }

        const unchanged = await ctx.prisma.workspaceSuggestion.findFirst({ where: { workspaceId, id: suggestion.id } });
        ctx.expect.eq(unchanged?.status, 'open', 'the suggestion was left untouched by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
  {
    name: 'a room member without workTickets cannot accept a workspace suggestion',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'acceptsuggestion_c3');
      const restricted = await createRealUser(ctx.prisma, 'acceptsuggestion_c3_restricted');
      try {
        await ctx.prisma.workspaceRole.create({ data: { workspaceId, key: 'no-work', label: 'No work', perms: [false, false, false, false, false, false, false, false], builtIn: false } });
        await ctx.prisma.workspaceMember.create({ data: { workspaceId, userId: restricted.id, roleKey: 'no-work' } });
        const suggestion = await ctx.prisma.workspaceSuggestion.create({
          data: { workspaceId, type: 'link-tickets', title: `Restricted suggestion ${String(Date.now())}`, body: 'must stay open', ticketIds: [], status: 'open' },
        });

        await ctx.session.logout();
        await ctx.session.login({ id: restricted.id, email: restricted.email, name: restricted.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<AcceptSuggestionInput, AcceptSuggestionResponse>(
          { suggestionId: suggestion.id, clientRequestId: `as-c3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a restricted workspace member is rejected');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'auth.forbidden', 'workTickets is enforced');

        const unchanged = await ctx.prisma.workspaceSuggestion.findFirst({ where: { workspaceId, id: suggestion.id } });
        ctx.expect.eq(unchanged?.status, 'open', 'the forbidden acceptance produced no write');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, restricted.id]);
      }
    },
  },
];
