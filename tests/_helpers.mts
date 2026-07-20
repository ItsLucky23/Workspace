//? Shared harness for the standalone Workspaces test scripts (unit + integration +
//? e2e). Run one with `npx tsx tests/<area>/<name>.test.mts`; run all with
//? `node scripts/runWsTests.mjs`. Integration/e2e tests hit the REAL Mongo (secrets
//? resolved via the secret-manager, same as boot) — they create + CLEAN UP their own
//? data. Unit tests don't call `db()`.

import { config as loadEnv } from 'dotenv';
import type { PrismaClient } from '@prisma/client';
import type { TestContext } from '@luckystack/test-runner';

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
//? The RAW `.env.local` values dotenvx injected — the provider keys are secret-manager POINTERS
//? (e.g. FAL_KEY=`FAL_KEY_V1`). We stash them, then unset for the default stub world. `db()` restores the
//? pointers so the secret-manager can RESOLVE them (it reads the pointer from process.env, not the file).
//? Blank (NOT delete): dotenvx runs again on later server-module imports and only injects MISSING
//? names — a deleted key resurrects as its raw pointer (the .env migration moved the pointers to
//? `.env`, which made this bite: providers then fired REAL calls in the stub world → 401s). An
//? EMPTY value survives every later pass and providers `.trim()` it to "absent".
const rawPointers: Record<string, string> = {};
for (const k of PROVIDER_KEYS) { const v = process.env[k]; if (v !== undefined && v !== '') rawPointers[k] = v; process.env[k] = ''; }

//? The REAL provider keys resolved by the secret-manager during `db()`, stashed so a LIVE test can
//? restore them (`enableLiveProviders()`) after the default stub-unset.
const stashedProviderKeys: Record<string, string> = {};

let cached: PrismaClient | null = null;

//? Resolve secrets + return the real Prisma client (cached per process).
export async function db(): Promise<PrismaClient> {
  if (cached) return cached;
  //? Restore the raw pointers so the secret-manager can resolve them (it resolves pointers PRESENT in
  //? process.env). Without this the resolution is a no-op and the real keys never materialise.
  for (const [k, v] of Object.entries(rawPointers)) process.env[k] = v;
  const { initSecretManager } = await import('@luckystack/secret-manager');
  await initSecretManager({ url: process.env.LUCKYSTACK_SECRET_MANAGER_URL ?? '', token: { fromFile: '.secret-manager-token' }, envNames: () => true, source: 'remote' } as never);
  //? initSecretManager has now resolved the pointers → REAL keys in process.env. Stash them for
  //? `enableLiveProviders()`, then unset so the default suite runs the deterministic STUB path. Tests that
  //? inject their own transport (falProvider/audioProviders) are unaffected; the live-AI suite restores.
  for (const k of PROVIDER_KEYS) {
    const v = process.env[k];
    if (v !== undefined && v !== '') stashedProviderKeys[k] = v;
    process.env[k] = ''; //? blank, not delete — see the rawPointers note (dotenvx re-injects missing names)
  }
  //? Deterministic INTEGRATION default: cheap media semantics (single-stage flows, lowest cost) —
  //? historically `.env`'s WS_MEDIA_CHEAP=1 was re-injected by a later dotenvx pass; set it
  //? explicitly here (db()-only, so pure unit tests keep the real OFF-by-default behaviour).
  process.env.WS_MEDIA_CHEAP = '1';
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

//? Delete every CURRENT tenant model, then the test users it created. Keep this list explicit so a
//? Prisma model with `workspaceId` cannot silently survive a test; the guarded indexed delegate fails
//? loudly when a renamed delegate is missed by Prisma generation.
const WORKSPACE_DELEGATES = [
  'ticketEvent', 'ticket', 'ticketLink', 'ticketReference', 'sprint', 'agentSession', 'carryOver', 'handoff', 'questionSet',
  'workspaceTrigger', 'workspaceSignal', 'workspaceSuggestion', 'workspaceNote', 'workspaceChatMessage', 'workspaceBudget',
  'spendRecord', 'notification', 'infoSource', 'ragEntry', 'envVar', 'integrationTool', 'invite', 'workspaceRole', 'workspaceMember',
  'project', 'service', 'serviceStack', 'uiReviewRequest', 'promptExperiment', 'promptTrial', 'publishedSite', 'siteSnapshot',
  'publishMetricSnapshot', 'auditLog', 'forgeConnection', 'environment', 'buildArtifact', 'pipeline', 'pipelineRun',
  'pipelineJob', 'dbConnection', 'migration', 'pipelineStage', 'studioBrief', 'studioBrandLibrary',
  'personalAccessToken', 'outputTemplate', 'customAiTask', 'studioArtifact', 'designArtifact', 'interviewFinding', 'ticketArtifactLink',
  'mergeRequest', 'reviewThread', 'reviewComment', 'approval', 'channel', 'contentProject', 'contentAsset', 'script', 'beat',
  'videoScene', 'mediaJob', 'renderJob', 'stylePreset', 'document', 'documentTemplate', 'documentRevision', 'skill', 'referenceExample',
  'mediaSpend', 'shortLink', 'publishJob', 'socialComment', 'mediaBudget',
] as const satisfies readonly (keyof PrismaClient)[];

async function deleteWorkspaceRows(delegate: unknown, workspaceId: string): Promise<void> {
  if (typeof delegate !== 'object' || delegate === null || !('deleteMany' in delegate) || typeof delegate.deleteMany !== 'function') {
    throw new Error('Expected a Prisma model delegate with deleteMany');
  }
  await delegate.deleteMany({ where: { workspaceId } });
}

export async function cleanupWorkspace(prisma: PrismaClient, workspaceId: string, extraUserIds: string[] = []): Promise<void> {
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } });
  for (const name of WORKSPACE_DELEGATES) await deleteWorkspaceRows(prisma[name], workspaceId);
  await prisma.workspace.delete({ where: { id: workspaceId } });
  const userIds = [...new Set([...members.map((member) => member.userId), ...extraUserIds])];
  if (userIds.length === 0) return;
  await prisma.pushSubscription.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.sshKey.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

//? `ctx.session.login()` (from `@luckystack/test-runner`) never touches Mongo — it just
//? writes a session record. Call it with NO `id` and it falls back to a synthetic
//? `test-user-<ts>-<hex>` string, which is NOT a valid 24-char hex Mongo ObjectId; any
//? route that then does a Prisma query on `user.id` against an `@db.ObjectId` field
//? (e.g. `workspaceMember.findMany({ where: { userId } })`) throws "Malformed ObjectID".
//? Separately, the app's first-login auto-seed (`postLogin` hook → `seedDemoWorkspace`)
//? was intentionally REMOVED (commit 42632a2) — onboarding now owns the zero-workspace
//? path, so logging in (real id or not) no longer populates a workspace by itself.
//? `createRealUser` fixes the first problem: create an actual `User` row so you have a
//? genuine ObjectId to pass as `login({ id })`. `loginSeededUser` fixes both: create the
//? real user, log in AS it, then explicitly seed a demo workspace the same way
//? `tests/integration/seed.test.mts` does. Tear down with `cleanupWorkspace(ctx.prisma,
//? workspaceId, [userId])` (or, if seeding never ran, `ctx.prisma.user.delete`).

//? Create a real `User` row with a genuine Mongo ObjectId. Use this (then
//? `ctx.session.login({ id: user.id, email: user.email, name: user.name })`) for any
//? route whose handler touches `user.id` in a Prisma query — even if the route doesn't
//? need a seeded workspace.
export async function createRealUser(prisma: PrismaClient, tag: string): Promise<{ id: string; email: string; name: string }> {
  const email = `lstest_${tag}_${String(Date.now())}_${String(Math.floor(Math.random() * 1e6))}@youcomm.nl`;
  const user = await prisma.user.create({ data: { email, name: 'Test User' } });
  return { id: user.id, email: user.email, name: user.name ?? 'Test User' };
}

//? Create a real user, log in as it (real ObjectId, not the harness's synthetic
//? fallback), then explicitly seed a demo workspace (workspace + roles + members +
//? pipeline + tickets — MIGRATION §5.2) since login no longer does this itself. Returns
//? the ids a case needs for both the API call and teardown. Clean up with
//? `cleanupWorkspace(ctx.prisma, workspaceId, [userId])` in a `finally`.
export async function loginSeededUser(ctx: TestContext, tag: string): Promise<{ userId: string; workspaceId: string }> {
  const user = await createRealUser(ctx.prisma, tag);
  await ctx.session.login({ id: user.id, email: user.email, name: user.name });
  const { seedDemoWorkspace } = await import('../server/bootstrap/seedWorkspace');
  const seeded = await seedDemoWorkspace(ctx.prisma, user.id);
  return { userId: user.id, workspaceId: seeded.workspaceId };
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
