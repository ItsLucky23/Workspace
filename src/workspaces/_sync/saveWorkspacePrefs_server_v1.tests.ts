import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { loginSeededUser, createRealUser, cleanupWorkspace, joinRoom } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/saveWorkspacePrefs/v1` — the two workspace preferences that had a
//? reader but no write path (D55 timezone, D31 per-model pricing).
//?  [1] happy path — a valid IANA zone is persisted (Prisma post-condition).
//?  [2] a zone Intl cannot resolve is REFUSED, not stored: every read fails closed to UTC, so an
//?      unusable stored value would silently un-anchor the whole workspace.
//?  [3] a single {model, pricePer1k} pair (the chat AI's shape) MERGES into the stored map instead
//?      of replacing it, and 0 is a legal price (a subscription seat costs nothing per token).
//?  [4] tenant/RBAC boundary — a room member without a `WorkspaceMember` row is rejected.
//?
//? Note on the HTTP-harness ack shape: `ctx.callSync` posts to the `/sync/...` HTTP endpoint, which
//? wraps a SUCCESSFUL route result under `result`; an ERROR result is flattened instead.

interface SavePrefsInput {
  timezone?: string;
  pricing?: Record<string, number>;
  model?: string;
  pricePer1k?: number;
  clientRequestId: string;
}
interface SavePrefsOk {
  status: 'success';
  result: { status: 'success'; timezone: string; pricing: Record<string, number> };
}
interface SavePrefsErr {
  status: 'error';
  errorCode: string;
}
type SavePrefsResponse = SavePrefsOk | SavePrefsErr;

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
    name: 'happy path persists the workspace timezone (Prisma post-condition after Conductor completion)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveprefs_c1');
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SavePrefsInput, SavePrefsResponse>(
          { timezone: 'Asia/Tokyo', clientRequestId: `sp-c1-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'success', 'saveWorkspacePrefs returns status "success"');

        const workspace = await poll(() => ctx.prisma.workspace.findFirst({ where: { id: workspaceId, timezone: 'Asia/Tokyo' } }));
        ctx.expect.ok(workspace !== null, 'the Conductor persisted the new timezone');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a zone Intl cannot resolve is refused and never stored',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveprefs_c2');
      const before = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { timezone: true } });
      try {
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SavePrefsInput, SavePrefsResponse>(
          { timezone: 'Mars/Olympus_Mons', clientRequestId: `sp-c2-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'an unusable IANA zone is rejected');

        const after = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { timezone: true } });
        ctx.expect.eq(after?.timezone, before?.timezone, 'the stored timezone is unchanged');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a single model price merges into the stored map (the chat AI shape), and 0 is a legal price',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveprefs_c3');
      try {
        await joinRoom(ctx, workspaceId);
        await ctx.callSync<SavePrefsInput, SavePrefsResponse>(
          { pricing: { 'gemini-2.5-pro': 0.012 }, clientRequestId: `sp-c3a-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        const seeded = await poll(async () => {
          const row = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { pricing: true } });
          const map = row?.pricing;
          const ok = map !== null && map !== undefined && typeof map === 'object' && !Array.isArray(map) && 'gemini-2.5-pro' in map;
          return ok ? row : null;
        });
        ctx.expect.ok(seeded !== null, 'the full-map write (the UI shape) stored the price');

        await ctx.callSync<SavePrefsInput, SavePrefsResponse>(
          { model: 'gemini-2.5-flash', pricePer1k: 0, clientRequestId: `sp-c3b-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        const merged = await poll(async () => {
          const row = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { pricing: true } });
          const map = row?.pricing;
          if (map === null || map === undefined || typeof map !== 'object' || Array.isArray(map)) return null;
          return 'gemini-2.5-flash' in map ? map : null;
        });
        ctx.expect.ok(merged !== null, 'the single-model write landed');
        ctx.expect.eq(merged?.['gemini-2.5-flash'], 0, '0 is stored as a real price, not dropped as falsy');
        ctx.expect.eq(merged?.['gemini-2.5-pro'], 0.012, 'the previously stored model survived the merge');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId]);
      }
    },
  },
  {
    name: 'a room member without a WorkspaceMember row is rejected (tenant/RBAC boundary)',
    run: async (ctx: TestContext) => {
      const { userId, workspaceId } = await loginSeededUser(ctx, 'saveprefs_c4');
      const outsider = await createRealUser(ctx.prisma, 'saveprefs_c4_outsider');
      const before = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { timezone: true } });
      try {
        await ctx.session.logout();
        await ctx.session.login({ id: outsider.id, email: outsider.email, name: outsider.name });
        await joinRoom(ctx, workspaceId);
        const res = await ctx.callSync<SavePrefsInput, SavePrefsResponse>(
          { timezone: 'Asia/Tokyo', clientRequestId: `sp-c4-${String(Date.now())}` },
          { receiver: workspaceId },
        );
        ctx.expect.eq(res.status, 'error', 'a non-member of the workspace is rejected');
        if (res.status === 'error') {
          ctx.expect.eq(res.errorCode, 'auth.forbidden', 'rejected with auth.forbidden, not a room/transport error');
        }

        const after = await ctx.prisma.workspace.findFirst({ where: { id: workspaceId }, select: { timezone: true } });
        ctx.expect.eq(after?.timezone, before?.timezone, 'the timezone is unchanged for the rejected call');
      } finally {
        await cleanupWorkspace(ctx.prisma, workspaceId, [userId, outsider.id]);
      }
    },
  },
];
