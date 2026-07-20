import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, cleanupWorkspace } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/snapshot/v1` — the read snapshot that backs
//? `useWorkspaceData()`. The auto-sweep already covers contract/auth/rate-limit/fuzz;
//? these cases assert the business-logic the sweep can't reach:
//?  [1] a seeded workspace populates the snapshot (workspaces non-empty, tickets array).
//?  [2] `stages[].id` is the stable slug (`PipelineStage.key`), NOT the raw ObjectId.
//?
//? Integration test: `loginSeededUser` creates a real `User` (a genuine ObjectId — the
//? harness's synthetic `test-user-<ts>` fallback is NOT a valid ObjectId and breaks
//? `buildSnapshot`'s `@db.ObjectId` queries on `user.id`), logs in as it, then
//? explicitly seeds a demo workspace (first-login auto-seed was removed in commit
//? 42632a2 — onboarding now owns the zero-workspace path, so login alone no longer
//? populates anything). Teardown via the shared `cleanupWorkspace` harness helper.

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

export const customTests: CustomTestCase[] = [
  {
    name: 'a seeded workspace populates the snapshot (workspaces non-empty, tickets array)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'snapshot_c1');
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
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'stages[0].id is a slug, not a 24-char ObjectId',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'snapshot_c2');
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
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
];
