//? Integration test for [gitlab-settings] (server/orchestrator/conductor.ts). Proves the GitLab
//? token IS encrypted at rest (contrast with save-env, which stores its value verbatim — flagged):
//? the persisted `gitlabTokenEnc` is not the plaintext and decrypts back to it.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { decryptSecret } = await import('../../server/crypto/secretBox');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `gl-${String(stamp)}@youcomm.nl`, name: 'GL Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'GL WS');
  const ws = created.workspaceId;
  workspaceId = ws;

  const PLAIN = 'glpat-SECRET-token-12345';
  await enqueueControlAction({ workspaceId: ws, op: 'gitlab-settings', target: {}, payload: { baseUrl: 'https://gitlab.example.com', token: PLAIN }, userId: owner.id, clientRequestId: `gl-${String(stamp)}` });

  const wsRow = await poll(() => prisma.workspace.findFirst({ where: { id: ws }, select: { gitlabUrl: true, gitlabTokenEnc: true } }).then((r) => (r?.gitlabTokenEnc ? r : null)));
  assert(wsRow !== null, 'gitlab-settings persisted the token');
  eq(wsRow?.gitlabUrl, 'https://gitlab.example.com', 'gitlabUrl persisted');
  const enc = wsRow?.gitlabTokenEnc ?? '';
  assert(enc.length > 0 && enc !== PLAIN, 'token is stored ENCRYPTED (not the plaintext)');
  eq(decryptSecret(enc), PLAIN, 'the encrypted token decrypts back to the original');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/gitlabSettings.test.mts');
