import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/sshKeyAdd/v1` — persists a new SSH key on the CALLER's
//? account. The auto-sweep already covers contract/auth/rate-limit/fuzz; these cases assert
//? the business-logic the sweep can't reach:
//?  [1] a valid key is persisted under the CALLER's userId and the response returns its id.
//?  [2] an empty publicKey is rejected with `api.invalidRequest` (no row is created).
//?
//? Integration test: `createRealUser` creates a real Prisma `User` (a genuine ObjectId — the
//? harness's synthetic id fallback breaks any `user.id`-scoped Prisma write), then we log in
//? directly as it — no workspace needed, SSH keys are account-level (framework-global), not
//? tenant state. Teardown deletes the created `SshKey` row(s) + the user directly.

type SshKeyAddResponse =
  | { status: 'success'; result: { id: string } }
  | { status: 'error'; errorCode: string };

export const customTests: CustomTestCase[] = [
  {
    name: 'a valid key is persisted under the caller and returns its id',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'sshadd_c1');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      try {
        const res = await ctx.callApi<{ name: string; type: string; fingerprint: string; publicKey: string }, SshKeyAddResponse>({
          name: 'laptop', type: 'ed25519', fingerprint: 'SHA256:abc123', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 test',
        });
        ctx.expect.eq(res.status, 'success', 'sshKeyAdd returns status "success"');
        if (res.status !== 'success') return;
        ctx.expect.ok(res.result.id.length > 0, 'result.id is a non-empty id');
        const row = await ctx.prisma.sshKey.findUnique({ where: { id: res.result.id } });
        ctx.expect.ok(row !== null, 'the SshKey row was persisted');
        if (!row) return;
        ctx.expect.eq(row.userId, user.id, 'the row is scoped to the caller, not a client-supplied id');
        ctx.expect.eq(row.name, 'laptop', 'the row stores the given name');
      } finally {
        await ctx.prisma.sshKey.deleteMany({ where: { userId: user.id } });
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: 'an empty publicKey is rejected and no row is created',
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'sshadd_c2');
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      try {
        const res = await ctx.callApi<{ name: string; type: string; fingerprint: string; publicKey: string }, SshKeyAddResponse>({
          name: 'laptop', type: 'ed25519', fingerprint: 'SHA256:abc123', publicKey: '   ',
        });
        ctx.expect.eq(res.status, 'error', 'sshKeyAdd rejects an empty publicKey');
        if (res.status === 'error') ctx.expect.eq(res.errorCode, 'api.invalidRequest', 'errorCode is api.invalidRequest');
        const count = await ctx.prisma.sshKey.count({ where: { userId: user.id } });
        ctx.expect.eq(count, 0, 'no SshKey row was created');
      } finally {
        await ctx.prisma.sshKey.deleteMany({ where: { userId: user.id } });
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
];
