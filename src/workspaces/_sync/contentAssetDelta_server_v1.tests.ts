import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/contentAssetDelta/v1` — a BROADCAST-ONLY type carrier (see
//? the route's top-of-file comment). `main()` has no business logic; a direct call is a no-op
//? that always returns `{ status: 'success', contentProjectId: '', asset: null }`. There is no
//? route-level RBAC to test (the route never calls `dispatchControlSync`), so this covers:
//?  [1] happy path — a room member gets the literal no-op ack shape (asset === null).
//?  [2] the transport-level room-membership gate still applies: calling WITHOUT `joinRoom` is
//?      rejected with `sync.notRoomMember`, proving the broadcast-only route isn't secretly
//?      exempt from the base membership check.

interface ContentAssetDeltaInput { clientRequestId: string }
interface ContentAssetDeltaOk { status: 'success'; contentProjectId: string; asset: unknown }
interface ContentAssetDeltaErr { status: 'error'; errorCode: string }
type ContentAssetDeltaResponse = ContentAssetDeltaOk | ContentAssetDeltaErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'happy path: a room member gets the literal no-op ack shape',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentassetdelta_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ContentAssetDeltaInput, ContentAssetDeltaResponse>(
          { clientRequestId: `cad-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'contentAssetDelta is a no-op carrier that always returns "success"');
        if (res.status === 'success') {
          //? The route literal is `asset: null`, but a `null` field can arrive over the wire as
          //? `undefined` after JSON round-tripping — either way there is no real asset.
          ctx.expect.ok(res.asset === null || res.asset === undefined, 'a direct call carries no real asset');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a caller who never joined the room is rejected (transport-level room-membership gate)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'contentassetdelta_c2');
      try {
        //? Deliberately skip joinRoom — this route has no RBAC of its own, so the base
        //? sync-transport membership gate is the only thing left to prove.
        const res = await ctx.callSync<ContentAssetDeltaInput, ContentAssetDeltaResponse>(
          { clientRequestId: `cad-c2-${String(Date.now())}` },
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
