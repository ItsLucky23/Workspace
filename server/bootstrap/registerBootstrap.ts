//? Workspaces — first-login bootstrap.
//?
//? On a user's FIRST login (no workspace membership yet), seed them a demo
//? workspace so the app opens onto populated screens (MIGRATION §5). Idempotent:
//? guarded by the membership count, so a returning user never re-seeds.

import { registerHook, getPrismaClient } from '@luckystack/core';

import { seedDemoWorkspace } from './seedWorkspace';

export function registerFirstLoginBootstrap(): void {
  registerHook('postLogin', async ({ userId }) => {
    const prisma = getPrismaClient();
    const count = await prisma.workspaceMember.count({ where: { userId } });
    if (count === 0) {
      const [error] = await tryBootstrap(prisma, userId);
      if (error) console.error('[bootstrap] first-login seed failed:', error);
    }
    return undefined;
  });
}

async function tryBootstrap(prisma: ReturnType<typeof getPrismaClient>, userId: string): Promise<[Error | null]> {
  try {
    await seedDemoWorkspace(prisma, userId);
    return [null];
  } catch (error) {
    return [error instanceof Error ? error : new Error(String(error))];
  }
}
