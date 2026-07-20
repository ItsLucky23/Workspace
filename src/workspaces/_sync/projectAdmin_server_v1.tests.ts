import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/projectAdmin/v1` — the multi-project/multi-service admin
//? write dispatcher (ADR 0035). Most ops (`env-deploy`, `service-create`, `db-migrate-apply`, …)
//? need Docker/PTY/a real forge and are deferred — see the "deferred" note at the bottom.
//? `project-create` is DB-only (no container), so it stands in for the generic dispatch path here.
//?  [1] happy path — `project-create` persists a new Project row (Prisma post-condition).
//?  [2] tenant/RBAC boundary — a room member without a `WorkspaceMember` row is rejected
//?      with `auth.forbidden`, and no project is created.
//?
//? //? TODO needs Docker — `service-create`/`service-delete`, `forge-connect`, `env-deploy`/
//? `env-teardown`/`env-rollback`/`env-promote`, `build-export`, `ci-run`, `db-connect`/
//? `db-migrate-create`/`db-migrate-apply`/`db-introspect`, `gitlab-resync`: these dispatch into
//? container exec / a real forge / a real DB connection and cannot be proven without Docker.

interface ProjectAdminInput {
  op: string;
  clientRequestId: string;
  name?: string;
}
interface ProjectAdminOk {
  status: 'success';
}
interface ProjectAdminErr {
  status: 'error';
  errorCode: string;
}
type ProjectAdminResponse = ProjectAdminOk | ProjectAdminErr;

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
    name: 'happy path (project-create) persists a new project (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'projectadmin_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const name = `Admin-created project ${String(Date.now())}`;
        const res = await ctx.callSync<ProjectAdminInput, ProjectAdminResponse>(
          { op: 'project-create', name, clientRequestId: `pa-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'projectAdmin(project-create) returns status "success"');

        const project = await poll(() => ctx.prisma.project.findFirst({ where: { workspaceId, name } }));
        ctx.expect.ok(project !== null, 'the Conductor persisted the new project');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'projectadmin_c2');
      const outsider = await createRealUser(ctx.prisma, 'projectadmin_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const name = `Should not be created ${String(Date.now())}`;
        const res = await ctx.callSync<ProjectAdminInput, ProjectAdminResponse>(
          { op: 'project-create', name, clientRequestId: `pa-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const project = await ctx.prisma.project.findFirst({ where: { workspaceId, name } });
        ctx.expect.ok(project === null, 'no project was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
