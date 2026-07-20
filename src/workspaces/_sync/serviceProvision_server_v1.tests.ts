import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/serviceProvision/v1` — the realtime `(K1)`
//? third-party service-stack attach (`dispatchControlSync` op `service-provision`,
//? `CAP.workspaceSettings`). Actually starting a docker-compose stack needs a real
//? Docker daemon reachable from the Conductor, so the happy path (a real `docker compose
//? up` + `ServiceStack` row) is DEFERRED — see the note below. These cases cover what the
//? harness CAN prove without a container:
//?  [1] input validation — a `name` with neither `preset` nor `compose` set (no source)
//?      is rejected with `sync.invalidRequest` before the Conductor is ever enqueued.
//?  [2] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`.
//?
//? //? TODO needs Docker: happy-path provision (valid `name` + `preset`/`compose` → the
//? Conductor sanitizes + namespaces the compose, starts the stack, persists a
//? `ServiceStack` row with `status: 'running'`).

interface ServiceProvisionInput {
  name: string;
  compose?: string;
  preset?: string;
  clientRequestId: string;
}
interface ServiceProvisionOk {
  status: 'success';
}
interface ServiceProvisionErr {
  status: 'error';
  errorCode: string;
}
type ServiceProvisionResponse = ServiceProvisionOk | ServiceProvisionErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'a name with neither preset nor compose is rejected with sync.invalidRequest (no Conductor dispatch)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'svcprov_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ServiceProvisionInput, ServiceProvisionResponse>(
          { name: 'my-stack', clientRequestId: `sp-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a stack with no source is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected as an invalid request, not RBAC/transport');
        }

        const stack = await ctx.prisma.serviceStack.findFirst({ where: { workspaceId, name: 'my-stack' } });
        ctx.expect.ok(stack === null, 'no stack row was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'svcprov_c2');
      const outsider = await createRealUser(ctx.prisma, 'svcprov_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<ServiceProvisionInput, ServiceProvisionResponse>(
          { name: 'outsider-stack', preset: 'postgres', clientRequestId: `sp-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const stack = await ctx.prisma.serviceStack.findFirst({ where: { workspaceId, name: 'outsider-stack' } });
        ctx.expect.ok(stack === null, 'no stack row was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
