//? Shared harness for the standalone Workspaces test scripts (unit + integration +
//? e2e). Run one with `npx tsx tests/<area>/<name>.test.mts`; run all with
//? `node scripts/runWsTests.mjs`. Integration/e2e tests hit the REAL Mongo (secrets
//? resolved via the secret-manager, same as boot) — they create + CLEAN UP their own
//? data. Unit tests don't call `db()`.

import { config as loadEnv } from 'dotenv';
import type { PrismaClient } from '@prisma/client';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local' });

let cached: PrismaClient | null = null;

//? Resolve secrets + return the real Prisma client (cached per process).
export async function db(): Promise<PrismaClient> {
  if (cached) return cached;
  const { initSecretManager } = await import('@luckystack/secret-manager');
  await initSecretManager({ url: process.env.LUCKYSTACK_SECRET_MANAGER_URL ?? '', token: { fromFile: '.secret-manager-token' }, envNames: () => true, source: 'remote' } as never);
  const { getPrismaClient } = await import('@luckystack/core');
  cached = getPrismaClient();
  return cached;
}

//? Delete a workspace + all its tenant rows + the demo member Users it created.
export async function cleanupWorkspace(prisma: PrismaClient, workspaceId: string, extraUserIds: string[] = []): Promise<void> {
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
  for (const m of ['ticketEvent', 'ticket', 'ticketLink', 'ticketReference', 'sprint', 'workspaceSuggestion', 'workspaceNote', 'workspaceBudget', 'workspaceSignal', 'workspaceTrigger', 'carryOver', 'handoff', 'questionSet', 'agentSession', 'spendRecord', 'notification', 'infoSource', 'ragEntry', 'envVar', 'integrationTool', 'invite', 'pipelineStage', 'workspaceRole', 'workspaceMember', 'project'] as const) {
    await (prisma as unknown as Record<string, { deleteMany: (a: unknown) => Promise<unknown> }>)[m].deleteMany({ where: { workspaceId } });
  }
  await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  const ids = new Set([...members.map((x) => x.userId), ...extraUserIds]);
  for (const id of ids) await prisma.user.delete({ where: { id } }).catch(() => undefined);
}

// ---- a tiny assertion runner (per-process counters) ----
let passed = 0;
let failed = 0;
const fails: string[] = [];

export function assert(cond: boolean, msg: string): void {
  if (cond) { passed += 1; console.log(`  ✓ ${msg}`); }
  else { failed += 1; fails.push(msg); console.error(`  ✗ ${msg}`); }
}
export function eq<T>(actual: T, expected: T, msg: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${msg} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

//? Print the summary + exit non-zero on any failure (so a runner detects it).
export function report(suite: string): void {
  console.log(`\n${suite}: ${String(passed)} passed, ${String(failed)} failed`);
  if (failed > 0) { console.error('FAILURES:\n' + fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
  process.exit(0);
}
