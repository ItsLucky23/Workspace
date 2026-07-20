import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `settings/updateUser/v1`.
//? The auto-sweep already covers: contract validation, auth enforcement,
//? rate-limit clamp, fuzz crash-resistance. These cases assert the business
//? logic the sweep can't reach:
//?  [1] happy path — `name` + `theme` + `language` are persisted to the
//?      `User` row.
//?  [2] guard — a `name` longer than `auth.nameMaxLength` is rejected with
//?      `login.nameCharacterLimit` and leaves the stored name untouched.
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine
//? ObjectId — the route reads/writes `user.id` against an `@db.ObjectId`
//? field), then `ctx.session.login({ id, email, name })` logs in as that
//? user. No workspace is needed. Teardown is a direct `ctx.prisma.user.delete`.

//? Default `auth.nameMaxLength` (no project override in `config.ts`) — see
//? `@luckystack/core`'s `DEFAULT_PROJECT_CONFIG`.
const NAME_MAX_LENGTH = 191;

interface UpdateUserOk {
  status: 'success';
  result: Record<string, never>;
}
interface UpdateUserErr {
  status: 'error';
  errorCode: string;
}
type UpdateUserResponse = UpdateUserOk | UpdateUserErr;

export const customTests: CustomTestCase[] = [
  {
    name: 'name + theme + language are persisted to the User row',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'updateuser_c1');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });

        const res = await ctx.callApi<
          { name?: string; theme?: string; language?: string; avatar?: string },
          UpdateUserResponse
        >({ name: 'Updated Name', theme: 'dark', language: 'nl' });

        ctx.expect.eq(res.status, 'success', 'updateUser returns status "success"');

        const row = await ctx.prisma.user.findUnique({
          where: { id: user.id },
          select: { name: true, theme: true, language: true },
        });
        ctx.expect.eq(row?.name, 'Updated Name', 'the stored name was updated');
        ctx.expect.eq(row?.theme, 'dark', 'the stored theme was updated');
        ctx.expect.eq(row?.language, 'nl', 'the stored language was updated');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'a name longer than nameMaxLength is rejected with login.nameCharacterLimit and leaves the stored name untouched',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'updateuser_c2');
      try {
        await ctx.session.login({ id: user.id, email: user.email, name: user.name });
        const tooLongName = 'a'.repeat(NAME_MAX_LENGTH + 1);

        const res = await ctx.callApi<
          { name?: string; theme?: string; language?: string; avatar?: string },
          UpdateUserResponse
        >({ name: tooLongName });

        ctx.expect.eq(res.status, 'error', 'updateUser returns status "error" for an over-limit name');
        ctx.expect.ok(res.status === 'error' && res.errorCode === 'login.nameCharacterLimit', 'errorCode is login.nameCharacterLimit');

        const row = await ctx.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
        ctx.expect.eq(row?.name, user.name, 'the stored name is unchanged after a rejected update');
      } finally {
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
