import type { CustomTestCase, TestContext } from '@luckystack/test-runner';

import { createRealUser } from '../../../tests/_helpers.mjs';

//? Per-route tests for `workspaces/sshKeyRemove/v1` — deletes an SSH key from the CALLER's
//? account only. Auto-sweep covers contract/auth/rate-limit/fuzz; these cases assert:
//?  [1] the caller's own key is deleted.
//?  [2] another account's key is NOT deleted (the `deleteMany` where-clause is scoped by
//?      userId — a no-op, not a cross-account delete — even though the call still succeeds).
//?
//? Integration test: two real `User` rows (`createRealUser`) so cross-account ownership can
//? be exercised with genuine ObjectIds. No workspace needed — SSH keys are account-level
//? (framework-global). Teardown deletes the created `SshKey` row(s) + both users directly.

type SshKeyRemoveResponse =
  | { status: 'success'; result: Record<string, never> }
  | { status: 'error'; errorCode: string };

export const customTests: CustomTestCase[] = [
  {
    name: "deletes the caller's own key",
    run: async (ctx: TestContext) => {
      const user = await createRealUser(ctx.prisma, 'sshrm_c1');
      const key = await ctx.prisma.sshKey.create({
        data: { userId: user.id, name: 'k1', type: 'ed25519', fingerprint: 'SHA256:x', publicKey: 'ssh-ed25519 AAA' },
      });
      await ctx.session.login({ id: user.id, email: user.email, name: user.name });
      try {
        const res = await ctx.callApi<{ id: string }, SshKeyRemoveResponse>({ id: key.id });
        ctx.expect.eq(res.status, 'success', 'sshKeyRemove returns status "success"');
        const row = await ctx.prisma.sshKey.findUnique({ where: { id: key.id } });
        ctx.expect.eq(row, null, 'the key row no longer exists');
      } finally {
        await ctx.prisma.sshKey.deleteMany({ where: { userId: user.id } });
        await ctx.prisma.user.delete({ where: { id: user.id } });
      }
    },
  },
  {
    name: "another account's key is not deleted",
    run: async (ctx: TestContext) => {
      const owner = await createRealUser(ctx.prisma, 'sshrm_c2_owner');
      const attacker = await createRealUser(ctx.prisma, 'sshrm_c2_attacker');
      const key = await ctx.prisma.sshKey.create({
        data: { userId: owner.id, name: 'k1', type: 'ed25519', fingerprint: 'SHA256:y', publicKey: 'ssh-ed25519 BBB' },
      });
      await ctx.session.login({ id: attacker.id, email: attacker.email, name: attacker.name });
      try {
        const res = await ctx.callApi<{ id: string }, SshKeyRemoveResponse>({ id: key.id });
        ctx.expect.eq(res.status, 'success', 'the call still returns success (a scoped no-op, not an error)');
        const row = await ctx.prisma.sshKey.findUnique({ where: { id: key.id } });
        ctx.expect.ok(row !== null, "the owner's key still exists");
      } finally {
        await ctx.prisma.sshKey.deleteMany({ where: { id: key.id } });
        await ctx.prisma.user.deleteMany({ where: { id: { in: [owner.id, attacker.id] } } });
      }
    },
  },
];
