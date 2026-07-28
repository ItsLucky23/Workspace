import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/linkRepo/v1` — the realtime register-flow step-A
//? git clone (`dispatchControlSync` op `link-repo`, `CAP.workspaceSettings`). Cloning
//? into `data/workspaces/<id>/` needs a real git binary + network/filesystem access from
//? the Conductor, so the happy path (a real clone + `repoDelta` broadcast) is DEFERRED —
//? see the note below. These cases cover what the harness CAN prove without a container:
//?  [1] input validation — an empty `gitUrl` is rejected with `sync.invalidRequest`
//?      before the Conductor is ever enqueued (no dispatch happens).
//?  [2] project boundary — a missing active project is rejected before the Conductor can
//?      silently fall back to project 1.
//?  [3] tenant/RBAC boundary — a room member who is NOT a `WorkspaceMember` of this
//?      workspace is rejected with `auth.forbidden`.
//?
//? //? TODO needs Docker: happy-path clone (valid `gitUrl` → Conductor clones the repo,
//? real filesystem state under `data/workspaces/<id>/` + `repoDelta` post-condition).

interface LinkRepoInput {
  projectId: string;
  gitUrl?: string;
  token?: string;
  disconnect?: boolean;
  clientRequestId: string;
}
interface LinkRepoOk {
  status: 'success';
  repo: unknown;
}
interface LinkRepoErr {
  status: 'error';
  errorCode: string;
}
type LinkRepoResponse = LinkRepoOk | LinkRepoErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'an empty gitUrl is rejected with sync.invalidRequest (no Conductor dispatch)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'linkrepo_c1');
      const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<LinkRepoInput, LinkRepoResponse>(
          { projectId: project?.id ?? '', gitUrl: '   ', clientRequestId: `lr-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an empty gitUrl is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'rejected as an invalid request, not RBAC/transport');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a missing projectId is rejected instead of falling back to the first project',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'linkrepo_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<LinkRepoInput, LinkRepoResponse>(
          { projectId: '', gitUrl: 'https://example.invalid/repo.git', clientRequestId: `lr-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a missing active project is rejected');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'the route never dispatches a project-less clone');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'linkrepo_c3');
      const project = await ctx.prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
      const outsider = await createRealUser(ctx.prisma, 'linkrepo_c3_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<LinkRepoInput, LinkRepoResponse>(
          { projectId: project?.id ?? '', gitUrl: 'https://example.invalid/repo.git', clientRequestId: `lr-c3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
