import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/infoDocAdmin/v1` — retiring a context doc (ADR 0310).
//?  [1] archive → restore round-trip, asserted on the REAL Prisma row (`archivedAt` set, then null
//?      again), because "archived" only means something if the persisted state actually changed.
//?  [2] delete removes the row for good — the irreversible sibling the UI confirm-gates.
//?  [3] tenant/RBAC boundary — a room member who is NOT a WorkspaceMember is rejected with
//?      `auth.forbidden` AND the doc is left untouched (the write must not half-happen).

interface InfoDocAdminInput {
  docId: string;
  action: 'archive' | 'restore' | 'delete';
  clientRequestId: string;
}
interface InfoDocAdminOk { status: 'success'; docs: unknown }
interface InfoDocAdminErr { status: 'error'; errorCode: string }
type InfoDocAdminResponse = InfoDocAdminOk | InfoDocAdminErr;

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

//? Seed a context doc directly (this route retires docs; creating one is addInfoDoc's job).
async function seedDoc(ctx: TestContext, workspaceId: string, name: string): Promise<string> {
  const row = await ctx.prisma.infoSource.create({
    data: { workspaceId, mode: 'context-doc', source: 'uploaded', name, content: '# seed', summary: 'seed', note: 'uploaded', enabled: false, usedByStages: [] },
  });
  return row.id;
}

export const customTests: CustomTestCase[] = [
  {
    name: 'archive sets archivedAt and restore clears it (Prisma post-condition round-trip)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'infodocadmin_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const docId = await seedDoc(ctx, workspaceId, `retire-me-${String(Date.now())}.md`);

        const archived = await ctx.callSync<InfoDocAdminInput, InfoDocAdminResponse>(
          { docId, action: 'archive', clientRequestId: `ida-c1a-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(archived.status, 'success', 'archive returns status "success"');
        const afterArchive = await poll(async () => {
          const row = await ctx.prisma.infoSource.findFirst({ where: { id: docId } });
          return row?.archivedAt !== null && row?.archivedAt !== undefined ? row : null;
        });
        ctx.expect.ok(afterArchive !== null, 'the Conductor stamped archivedAt (the doc stops feeding the AI)');

        const restored = await ctx.callSync<InfoDocAdminInput, InfoDocAdminResponse>(
          { docId, action: 'restore', clientRequestId: `ida-c1b-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(restored.status, 'success', 'restore returns status "success"');
        const afterRestore = await poll(async () => {
          const row = await ctx.prisma.infoSource.findFirst({ where: { id: docId } });
          return row !== null && row.archivedAt === null ? row : null;
        });
        ctx.expect.ok(afterRestore !== null, 'restore cleared archivedAt — archiving is genuinely reversible');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'delete removes the InfoSource row permanently',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'infodocadmin_c2');
      try {
        await joinRoom(ctx, workspaceId);
        const docId = await seedDoc(ctx, workspaceId, `delete-me-${String(Date.now())}.md`);

        const res = await ctx.callSync<InfoDocAdminInput, InfoDocAdminResponse>(
          { docId, action: 'delete', clientRequestId: `ida-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'delete returns status "success"');

        const gone = await poll(async () => {
          const row = await ctx.prisma.infoSource.findFirst({ where: { id: docId } });
          return row === null ? true : null;
        });
        ctx.expect.ok(gone === true, 'the InfoSource row is gone (delete is not a soft-archive)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected and the doc is untouched (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'infodocadmin_c3');
      const outsider = await createRealUser(ctx.prisma, 'infodocadmin_c3_outsider');
      const docId = await seedDoc(ctx, workspaceId, `protected-${String(Date.now())}.md`);
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Room member, never a WorkspaceMember — so a rejection proves RBAC fired, not the room gate.
        await joinRoom(ctx, workspaceId);

        const res = await ctx.callSync<InfoDocAdminInput, InfoDocAdminResponse>(
          { docId, action: 'delete', clientRequestId: `ida-c3-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const still = await ctx.prisma.infoSource.findFirst({ where: { id: docId } });
        ctx.expect.ok(still !== null, 'the doc survived the rejected delete (no partial write)');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
