//? Test for FREEDOM_PROGRAM X3 — public API personal access tokens. Verifies token hashing/generation, resolve
//? (valid / revoked / unknown), and driveViaPat end-to-end: a scoped PAT drives a create-op on the single-writer
//? chain (a ticket is created), an insufficient scope is 403, and a revoked token is 401. Real Conductor + Mongo.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const pat = await import('../../server/auth/pat');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

// pure hashing
{
  eq(pat.hashToken('abc'), pat.hashToken('abc'), 'hashing is deterministic');
  assert(pat.hashToken('abc') !== pat.hashToken('abd'), 'different inputs → different hashes');
  const gen = pat.generateToken();
  assert(gen.raw.startsWith('wsk_'), 'a minted token has the wsk_ prefix');
  eq(pat.hashToken(gen.raw), gen.hash, 'the returned hash matches the raw');
  assert(gen.raw !== gen.hash, 'the raw is not the stored hash');
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `pat-${String(stamp)}@youcomm.nl`, name: 'PAT' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'PAT WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  const mint = (scopes: string[], revoked = false): Promise<string> => {
    const g = pat.generateToken();
    return prisma.personalAccessToken.create({ data: { userId: owner.id, workspaceId: wsId, name: 'CLI', tokenHash: g.hash, tokenPrefix: g.prefix, scopes, revoked } }).then(() => g.raw);
  };

  // resolve
  const good = await mint(['tickets:write']);
  const resolved = await pat.resolvePat(prisma, good);
  eq(resolved?.workspaceId, wsId, 'a valid token resolves to its workspace');
  assert((await pat.resolvePat(prisma, 'wsk_deadbeef')) === null, 'an unknown token → null');
  assert((await pat.resolvePat(prisma, 'not-a-token')) === null, 'a non-prefixed token → null');

  // driveViaPat — a scoped PAT creates a ticket end-to-end
  const before = await prisma.ticket.count({ where: { workspaceId: wsId } });
  const drive = await pat.driveViaPat(prisma, good, 'quick-add', { title: 'From the API' });
  eq(drive.status, 200, 'a scoped PAT drives quick-add (200)');
  assert(await prisma.ticket.count({ where: { workspaceId: wsId } }) > before, 'a ticket was created via the PAT');

  // insufficient scope → 403
  const wrongScope = await mint(['content:write']);
  eq((await pat.driveViaPat(prisma, wrongScope, 'quick-add', { title: 'x' })).status, 403, 'a PAT without tickets:write → 403');

  // an op not exposed to the public API → 400
  eq((await pat.driveViaPat(prisma, good, 'pause', {})).status, 400, 'a non-public op → 400');

  // revoked → 401
  const revoked = await mint(['tickets:write'], true);
  eq((await pat.driveViaPat(prisma, revoked, 'quick-add', { title: 'x' })).status, 401, 'a revoked token → 401');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  await prisma.personalAccessToken.deleteMany({ where: { userId: owner.id } }).catch(() => undefined);
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/personalAccessToken.test.mts');
