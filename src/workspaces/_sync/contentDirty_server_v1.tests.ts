import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/contentDirty/v1` — a BROADCAST-ONLY type carrier (see the
//? route's top-of-file comment). `main()` has no business logic; a direct call is a no-op that
//? always returns `{ status: 'success' }`. There is no route-level RBAC to test here (the route
//? never calls `dispatchControlSync`), so instead of a fake business-logic boundary this covers:
//?  [1] happy path — a room member gets the plain success ack the route always returns.
//?  [2] the transport-level room-membership gate still applies to this route (like every sync
//?      route): calling WITHOUT `joinRoom` is rejected with `sync.notRoomMember`, proving the
//?      broadcast-only route isn't secretly exempt from the base membership check.

interface ContentDirtyInput { clientRequestId: string }
interface ContentDirtyOk { status: 'success' }
interface ContentDirtyErr { status: 'error'; errorCode: string }
type ContentDirtyResponse = ContentDirtyOk | ContentDirtyErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: a room member gets the plain success ack',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentdirty_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ContentDirtyInput, ContentDirtyResponse>(
          { clientRequestId: `cd-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'contentDirty is a no-op carrier that always returns "success"');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a caller who never joined the room is rejected (transport-level room-membership gate)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentdirty_c2');
      try {
        //? Deliberately skip joinRoom — this route has no RBAC of its own, so the base
        //? sync-transport membership gate is the only thing left to prove.
        const res = await ctx.callSync<ContentDirtyInput, ContentDirtyResponse>(
          { clientRequestId: `cd-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-room-member call is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.notRoomMember', 'rejected by the transport-level room-membership gate');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
