import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

//? Per-route tests for `workspaces/snapshot/v1` — the read snapshot that backs
//? `useWorkspaceData()`. The auto-sweep already covers contract/auth/rate-limit/fuzz;
//? these cases assert the business-logic the sweep can't reach:
//?  [1] first-login seed populates the snapshot (workspaces non-empty, tickets array).
//?  [2] `stages[].id` is the stable slug (`PipelineStage.key`), NOT the raw ObjectId.
//?
//? Integration test: a throwaway user is logged in (which fires the first-login seed
//? via the `postLogin` hook), then every row it created is torn down in a `finally`
//? so no data leaks — the seed's workspace, its tenant-scoped rows, the demo member
//? Users, and the throwaway login user itself.

//? Response envelope the route returns (`{ status, result }`). Only the fields these
//? cases assert on are modelled; the rest of the snapshot is intentionally omitted.
interface SnapshotOk {
  status: 'success';
  result: {
    workspaces: { id: string }[];
    tickets: unknown[];
    stages: { id: string }[];
  };
}
interface SnapshotErr {
  status: 'error';
}
type SnapshotResponse = SnapshotOk | SnapshotErr;

//? A 24-char lowercase-hex Mongo ObjectId. `stages[].id` must NOT match this — the
//? snapshot maps `PipelineStage.key` (a slug like `unrefined`) onto the frontend `id`.
const OBJECT_ID = /^[0-9a-f]{24}$/i;

//? Tear down everything the first-login seed created for `userId`: for each workspace
//? the user belongs to, delete the tenant-scoped rows, the demo member Users, then the
//? workspace; finally delete the throwaway login user. Mirrors the Conductor's
//? `cascadeDeleteWorkspace` (which is private to the orchestrator, so it's inlined here).
async function cleanupUser(db: TestContext['prisma'], userId: string): Promise<void> {
  const memberships = await db.workspaceMember.findMany({ where: { userId } });
  const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
  for (const workspaceId of workspaceIds) {
    const members = await db.workspaceMember.findMany({ where: { workspaceId } });
    const demoUserIds = members.map((m) => m.userId).filter((id) => id !== userId);
    await db.ticketEvent.deleteMany({ where: { workspaceId } });
    await db.ticket.deleteMany({ where: { workspaceId } });
    await db.workspaceSuggestion.deleteMany({ where: { workspaceId } });
    await db.workspaceBudget.deleteMany({ where: { workspaceId } });
    await db.workspaceSignal.deleteMany({ where: { workspaceId } });
    await db.sprint.deleteMany({ where: { workspaceId } });
    await db.infoSource.deleteMany({ where: { workspaceId } });
    await db.envVar.deleteMany({ where: { workspaceId } });
    await db.integrationTool.deleteMany({ where: { workspaceId } });
    await db.invite.deleteMany({ where: { workspaceId } });
    await db.pipelineStage.deleteMany({ where: { workspaceId } });
    await db.workspaceRole.deleteMany({ where: { workspaceId } });
    await db.workspaceMember.deleteMany({ where: { workspaceId } });
    await db.project.deleteMany({ where: { workspaceId } });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
    if (demoUserIds.length > 0) await db.user.deleteMany({ where: { id: { in: demoUserIds } } });
  }
  await db.user.deleteMany({ where: { id: userId } });
}

const uniqueEmail = (tag: string): string => `lstest_snapshot_${tag}_${String(Date.now())}_${String(Math.floor(Math.random() * 1e6))}@youcomm.nl`;

export const customTests: CustomTestCase[] = [
  {
    name: 'first-login seed populates the snapshot (workspaces non-empty, tickets array)',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c1') });
      try {
        const res = await ctx.callApi<{ workspaceId?: string }, SnapshotResponse>({});
        ctx.expect.eq(res.status, 'success', 'snapshot returns status "success"');
        ctx.expect.ok(
          res.status === 'success' && Array.isArray(res.result.workspaces) && res.result.workspaces.length > 0,
          'result.result.workspaces is a non-empty array',
        );
        ctx.expect.ok(
          res.status === 'success' && Array.isArray(res.result.tickets),
          'result.result.tickets is an array',
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
  {
    name: 'stages[0].id is a slug, not a 24-char ObjectId',
    run: async (ctx: TestContext) => {
      const { userId } = await ctx.session.login({ email: uniqueEmail('c2') });
      try {
        const res = await ctx.callApi<{ workspaceId?: string }, SnapshotResponse>({});
        ctx.expect.ok(res.status === 'success', 'snapshot returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.ok(res.result.stages.length > 0, 'result.result.stages is non-empty');
        const first = res.result.stages[0];
        ctx.expect.ok(
          first !== undefined && !OBJECT_ID.test(first.id),
          `stages[0].id (${first?.id ?? 'undefined'}) is a slug, not a 24-char ObjectId`,
        );
      } finally {
        await cleanupUser(ctx.prisma, userId);
      }
    },
  },
];
