import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/documentsControl/v1` — the Documents-module dispatch
//? (DOC, DOCUMENTS_AND_SKILLS). One route fans out to several `ControlOp`s; these cases
//? cover the `document-create` op end-to-end:
//?  [1] happy path — a room member creates a Document; asserted via the REAL Prisma
//?      post-condition (the Conductor's single-writer persistence), not just the ack.
//?  [2] tenant/RBAC boundary — a user who is a room member but NOT a `WorkspaceMember`
//?      of this workspace is rejected with `auth.forbidden`, and no document is created.

interface DocumentsControlInput {
  op: string;
  clientRequestId: string;
  title?: string;
  content?: string;
}
interface DocumentsControlOk {
  status: 'success';
}
interface DocumentsControlErr {
  status: 'error';
  errorCode: string;
}
type DocumentsControlResponse = DocumentsControlOk | DocumentsControlErr;

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
    name: 'happy path (document-create) persists a Document (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'docctl_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const title = `Sync harness doc ${String(Date.now())}`;
        //? Content deliberately left empty: `document-create` awaits `indexDocument`, which for
        //? non-empty content calls the live embedding provider (`embedTexts`) — an empty document
        //? has zero chunks and skips that network call, keeping this a fast, deterministic
        //? persistence check rather than a live-provider integration test.
        const res = await ctx.callSync<DocumentsControlInput, DocumentsControlResponse>(
          { op: 'document-create', clientRequestId: `dc-c1-${String(Date.now())}`, title, content: '' },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'documentsControl returns status "success"');

        const doc = await poll(() => ctx.prisma.document.findFirst({ where: { workspaceId, title } }));
        ctx.expect.ok(doc !== null, 'the Conductor persisted the document (post-condition, not just the ack)');
        ctx.expect.eq(doc?.content, '', 'the document content matches the requested op payload');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'docctl_c2');
      const outsider = await createRealUser(ctx.prisma, 'docctl_c2_outsider');
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        //? Admit the outsider into the ROOM only (never a WorkspaceMember of this workspace),
        //? so the rejection below is proven to come from RBAC, not the room-membership gate.
        await joinRoom(ctx, workspaceId);
        const title = `Should not be created ${String(Date.now())}`;
        const res = await ctx.callSync<DocumentsControlInput, DocumentsControlResponse>(
          { op: 'document-create', clientRequestId: `dc-c2-${String(Date.now())}`, title, content: 'seed content' },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const doc = await ctx.prisma.document.findFirst({ where: { workspaceId, title } });
        ctx.expect.ok(doc === null, 'no document was created for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
