import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/projectAdmin/v1` — the multi-project/multi-service admin
//? write dispatcher (ADR 0035). Most ops (`env-deploy`, `service-create`, `db-migrate-apply`, …)
//? need Docker/PTY/a real forge and are deferred — see the "deferred" note at the bottom.
//? `project-create` is DB-only (no container), so it stands in for the generic dispatch path here.
//?  [1] happy path — `project-create` persists a new Project row (Prisma post-condition).
//?  [2] tenant/RBAC boundary — a room member without a `WorkspaceMember` row is rejected
//?      with `auth.forbidden`, and no project is created.
//?  [3] `service-delete` is a plain `prisma.service.deleteMany`, no container involved —
//?      a fixture `Service` row is deleted end-to-end (Prisma post-condition: row gone).
//?  [4] `resume-spend` is a plain `prisma.workspaceBudget.updateMany({ spent: 0, ... })`,
//?      no container involved — a fixture `WorkspaceBudget` with `spent > 0` is reset to
//?      0 end-to-end (Prisma post-condition).
//?  [5] `edit-budget` (single-cap legacy path, no `budgetId`) — a plain
//?      `prisma.workspaceBudget.updateMany`, no container involved — asserted via the
//?      Prisma post-condition (`cap`/`alertPct` land on the existing `WorkspaceBudget` row).
//?  [6] `env-rollback` pins the last LIVE `DeployHistory` commit onto the `Environment` row
//?      (`rollbackEnvironment` in `server/deploy/environment.ts`) BEFORE it redeploys — the
//?      pin is a plain, un-transacted Prisma write and persists regardless of whether the
//?      redeploy that follows lands `ok:true` or fails gracefully (no linked repo in this
//?      fixture — same graceful-fail shape `environments.test.mts` documents for env-deploy).
//?      Asserted via the real Prisma post-condition on `Environment.pinnedCommit`.
//?
//? //? TODO needs Docker — `service-create`, `forge-connect`, `env-deploy`/
//? `env-teardown`/`env-promote`, `build-export`, `ci-run`, `db-connect`/
//? `db-migrate-create`/`db-migrate-apply`/`db-introspect`, `gitlab-resync`: these dispatch into
//? container exec / a real forge / a real DB connection and cannot be proven without Docker.

interface ProjectAdminInput {
  op: string;
  clientRequestId: string;
  name?: string;
  serviceId?: string;
  budgetId?: string;
  cap?: number;
  alertPct?: number;
  envId?: string;
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
  {
    name: 'service-delete removes the Service row (Docker-free op; Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'projectadmin_c3');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const service = await ctx.prisma.service.create({
          data: { workspaceId, projectId: project.id, name: `Harness service ${String(Date.now())}` },
        });

        const res = await ctx.callSync<ProjectAdminInput, ProjectAdminResponse>(
          { op: 'service-delete', serviceId: service.id, clientRequestId: `pa-c3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'projectAdmin(service-delete) returns status "success"');

        const gone = await poll(async () => {
          const row = await ctx.prisma.service.findFirst({ where: { workspaceId, id: service.id } });
          return row === null ? ('gone' as const) : null;
        });
        ctx.expect.ok(gone === 'gone', 'the Conductor deleted the Service row (post-condition, not just the ack)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'resume-spend resets WorkspaceBudget.spent to 0 (Docker-free op; Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'projectadmin_c4');
      try {
        await joinRoom(ctx, workspaceId);
        const budget = await ctx.prisma.workspaceBudget.create({
          data: { workspaceId, label: 'Harness budget', cap: 100, enforcement: 'pauseNew', spent: 42 },
        });

        const res = await ctx.callSync<ProjectAdminInput, ProjectAdminResponse>(
          { op: 'resume-spend', clientRequestId: `pa-c4-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'projectAdmin(resume-spend) returns status "success"');

        const reset = await poll(async () => {
          const row = await ctx.prisma.workspaceBudget.findFirst({ where: { workspaceId, id: budget.id } });
          return row?.spent === 0 ? row : null;
        });
        ctx.expect.ok(reset !== null, 'the Conductor reset WorkspaceBudget.spent to 0 (post-condition, not just the ack)');
      } finally {
        await ctx.prisma.workspaceBudget.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'edit-budget (legacy single-cap path) edits the existing WorkspaceBudget row (Docker-free op; Prisma post-condition)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'projectadmin_c5');
      try {
        await joinRoom(ctx, workspaceId);
        //? `edit-budget` (no `budgetId`) edits the FIRST WorkspaceBudget row for the workspace — and
        //? the seeded demo workspace already ships one (`seedWorkspace.ts`). Clear it so our fixture
        //? is unambiguously the row the op edits.
        await ctx.prisma.workspaceBudget.deleteMany({ where: { workspaceId } });
        const budget = await ctx.prisma.workspaceBudget.create({
          data: { workspaceId, label: 'Harness budget', cap: 100, alertPct: 80, enforcement: 'pauseNew', spent: 0 },
        });

        const res = await ctx.callSync<ProjectAdminInput, ProjectAdminResponse>(
          { op: 'edit-budget', cap: 250, alertPct: 90, clientRequestId: `pa-c5-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'projectAdmin(edit-budget) returns status "success"');

        const edited = await poll(async () => {
          const row = await ctx.prisma.workspaceBudget.findFirst({ where: { workspaceId, id: budget.id } });
          return row?.cap === 250 ? row : null;
        });
        ctx.expect.ok(edited !== null, 'the Conductor edited the existing WorkspaceBudget cap (post-condition, not just the ack)');
        ctx.expect.eq(edited?.alertPct, 90, 'alertPct is edited alongside cap');
      } finally {
        await ctx.prisma.workspaceBudget.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'env-rollback pins the last LIVE deploy commit onto the Environment row (Prisma post-condition; the redeploy itself is best-effort in this harness)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'projectadmin_c6');
      try {
        await joinRoom(ctx, workspaceId);
        const project = await ctx.prisma.project.findFirst({ where: { workspaceId } });
        if (!project) throw new Error('seeded workspace has no project');
        const badCommit = `bad-${String(Date.now())}`;
        const goodCommit = `good-${String(Date.now())}`;
        const env = await ctx.prisma.environment.create({
          data: {
            workspaceId, projectId: project.id, kind: 'dev',
            route: `dev-rollback-${String(Date.now())}.localhost`, status: 'error', deployedCommit: badCommit,
          },
        });
        //? `rollbackEnvironment` (server/deploy/environment.ts) targets the newest LIVE deploy that
        //? is NOT the currently-deployed commit — seed exactly that history shape directly (no real
        //? deploy ran to produce it).
        await ctx.prisma.deployHistory.create({
          data: { workspaceId, envId: env.id, projectId: project.id, kind: 'dev', branch: 'main', commit: goodCommit, status: 'live' },
        });

        //? `rollbackEnvironment` pins BEFORE it redeploys, and the pin is a plain, un-transacted
        //? Prisma write — so it persists whether the redeploy that follows lands `ok:true` or fails
        //? gracefully (no linked repo in this fixture; Docker itself may or may not be reachable
        //? from this test process — either way `deployEnvironment` never throws, `environments.test.mts`
        //? documents the same graceful-fail shape for `env-deploy`). A failed redeploy makes
        //? `dispatchControlSync` surface `sync.invalidRequest` (it treats any `ok:false` op result as
        //? a failure) — RBAC passing is proven either way; only the pin itself is asserted here.
        const res = await ctx.callSync<ProjectAdminInput, ProjectAdminResponse>(
          { op: 'env-rollback', envId: env.id, clientRequestId: `pa-c6-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'sync.invalidRequest', 'a redeploy failure surfaces as sync.invalidRequest, not an RBAC/whitelist rejection');

        const pinned = await poll(async () => {
          const row = await ctx.prisma.environment.findFirst({ where: { id: env.id, workspaceId } });
          return row?.pinnedCommit === goodCommit ? row : null;
        });
        ctx.expect.ok(pinned !== null, 'the Conductor pinned the last LIVE deploy commit (rollback post-condition, not just the ack) regardless of the redeploy outcome');
      } finally {
        await ctx.prisma.deployHistory.deleteMany({ where: { workspaceId } });
        await ctx.prisma.environment.deleteMany({ where: { workspaceId } });
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
