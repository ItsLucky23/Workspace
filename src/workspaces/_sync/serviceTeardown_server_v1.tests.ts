import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/serviceTeardown/v1` — the realtime `(K1)`
//? service-stack teardown (`dispatchControlSync` op `service-teardown`,
//? `CAP.workspaceSettings`). A real teardown needs a real `docker compose down -v`
//? against an actually-running stack from the Conductor, so the happy path (a live
//? stack torn down + its `ServiceStack` row dropped) is DEFERRED — see the note below.
//? These cases cover what the harness CAN prove without a container:
//?  [1] input validation — an empty `name` is rejected with `sync.invalidRequest`
//?      before the Conductor is ever enqueued (no dispatch happens).
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`, and a pre-seeded stack row survives.
//?
//? //? TODO needs Docker: happy-path teardown (a real running stack → the Conductor runs
//? `docker compose down -v` and drops the `ServiceStack` row).

interface ServiceTeardownInput {
  name: string;
  clientRequestId: string;
}
interface ServiceTeardownOk {
  status: 'success';
}
interface ServiceTeardownErr {
  status: 'error';
  errorCode: string;
}
type ServiceTeardownResponse = ServiceTeardownOk | ServiceTeardownErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'an empty name is rejected with sync.invalidRequest (no Conductor dispatch)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'svcteardown_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ServiceTeardownInput, ServiceTeardownResponse>(
          { name: '   ', clientRequestId: `st-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an empty name is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected as an invalid request, not RBAC/transport');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'svcteardown_c2');
      const outsider = await createRealUser(ctx.prisma, 'svcteardown_c2_outsider');
      try {
        const seeded = await ctx.prisma.serviceStack.create({
          data: {
            workspaceId,
            name: `svcteardown-c2-${String(Date.now())}`,
            compose: 'services: {}',
            services: [],
            status: 'stopped',
          },
        });
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ServiceTeardownInput, ServiceTeardownResponse>(
          { name: seeded.name, clientRequestId: `st-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stillThere = await ctx.prisma.serviceStack.findUnique({ where: { id: seeded.id } });
        ctx.expect.ok(stillThere !== null, 'the stack row was not torn down by the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
