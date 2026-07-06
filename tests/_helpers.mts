//? Shared harness for the standalone Workspaces test scripts (unit + integration +
//? e2e). Run one with `npx tsx tests/<area>/<name>.test.mts`; run all with
//? `node scripts/runWsTests.mjs`. Integration/e2e tests hit the REAL Mongo (secrets
//? resolved via the secret-manager, same as boot) — they create + CLEAN UP their own
//? data. Unit tests don't call `db()`.

import { config as loadEnv } from 'dotenv';
import type { PrismaClient } from '@prisma/client';

loadEnv({ path: '.env' });
loadEnv({ path: '.env.local' });

//? Deterministic test world: the media/AI provider keys may be present in the dev env (.env.local /
//? WS_MEDIA_CHEAP in .env), which would flip each provider's `available()` to TRUE and push the
//? stub-based content/media tests onto the LIVE path (real HTTP → different/failed results). We force
//? the STUB path by default (see `db()`), and a LIVE test opts back in via `enableLiveProviders()`.
//? Importing any server module pulls in `@luckystack/core`, whose boot runs dotenvx with `override:true`
//? — RE-INJECTING the raw `.env.local` provider pointers (e.g. FAL_KEY=`FAL_KEY_V1`) over whatever we
//? set here. dotenvx runs once (the module is then cached), so we trigger that boot NOW (import core) and
//? unset AFTER, guaranteeing the stub-forcing sticks for every later server import in the test.
const PROVIDER_KEYS = ['FAL_KEY', 'ELEVENLABS_KEY', 'SUNO_KEY', 'GEMINI_API_KEY', 'WS_MEDIA_CHEAP'] as const;
await import('@luckystack/core');
for (const k of PROVIDER_KEYS) delete process.env[k];

//? The REAL provider keys resolved by the secret-manager during `db()`, stashed so a LIVE test can
//? restore them (`enableLiveProviders()`) after the default stub-unset.
const stashedProviderKeys: Record<string, string> = {};

let cached: PrismaClient | null = null;

//? Resolve secrets + return the real Prisma client (cached per process).
export async function db(): Promise<PrismaClient> {
  if (cached) return cached;
  const { initSecretManager } = await import('@luckystack/secret-manager');
  await initSecretManager({ url: process.env.LUCKYSTACK_SECRET_MANAGER_URL ?? '', token: { fromFile: '.secret-manager-token' }, envNames: () => true, source: 'remote' } as never);
  //? initSecretManager re-injects the resolved provider keys into process.env (overriding the top-level
  //? unset). Stash them for `enableLiveProviders()`, then unset again so the default suite runs the
  //? deterministic STUB path. Tests that inject their own transport (falProvider/audioProviders) are
  //? unaffected; the live-AI suite calls `enableLiveProviders()` to restore the real keys.
  for (const k of PROVIDER_KEYS) {
    const v = process.env[k];
    if (v !== undefined && v !== '') stashedProviderKeys[k] = v;
    process.env[k] = '';
  }
  //? H2 fail-closed: at-rest encryption is mandatory, so `encryptSecret` now THROWS without a key.
  //? Guarantee a deterministic test key when the secret-manager didn't supply one (tests create
  //? fresh data per run, so intra-run consistency is all that matters).
  if ((process.env.WORKSPACES_ENC_KEY ?? '') === '') process.env.WORKSPACES_ENC_KEY = 'ws-test-enc-key-deterministic';
  const { getPrismaClient } = await import('@luckystack/core');
  cached = getPrismaClient();
  return cached;
}

//? Restore the REAL provider keys (resolved by the secret-manager during `db()`) for a LIVE test —
//? call AFTER `db()`. Returns which providers actually have a key so a test can skip a leg with no key.
//? Media stays cheap + budget-capped (`WS_MEDIA_CHEAP=1`) so a live run is a few cents, not euros.
export function enableLiveProviders(): { fal: boolean; elevenlabs: boolean; suno: boolean; gemini: boolean } {
  for (const [k, v] of Object.entries(stashedProviderKeys)) process.env[k] = v;
  process.env.WS_MEDIA_CHEAP = '1';
  return {
    fal: (process.env.FAL_KEY ?? '').length > 0,
    elevenlabs: (process.env.ELEVENLABS_KEY ?? '').length > 0,
    suno: (process.env.SUNO_KEY ?? '').length > 0,
    gemini: (process.env.GEMINI_API_KEY ?? '').length > 0,
  };
}

//? Delete a workspace + all its tenant rows + the demo member Users it created.
export async function cleanupWorkspace(prisma: PrismaClient, workspaceId: string, extraUserIds: string[] = []): Promise<void> {
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
  for (const m of ['ticketEvent', 'ticket', 'ticketLink', 'ticketReference', 'sprint', 'workspaceSuggestion', 'workspaceNote', 'workspaceBudget', 'workspaceSignal', 'workspaceTrigger', 'carryOver', 'handoff', 'questionSet', 'agentSession', 'spendRecord', 'notification', 'infoSource', 'ragEntry', 'envVar', 'integrationTool', 'invite', 'reviewComment', 'reviewThread', 'approval', 'mergeRequest', 'beat', 'script', 'contentAsset', 'publishJob', 'mediaJob', 'renderJob', 'mediaSpend', 'mediaBudget', 'contentProject', 'channel', 'stylePreset', 'pipelineStage', 'workspaceRole', 'workspaceMember', 'environment', 'buildArtifact', 'pipelineJob', 'pipelineRun', 'pipeline', 'migration', 'dbConnection', 'forgeConnection', 'service', 'project'] as const) {
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
