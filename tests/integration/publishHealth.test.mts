//? Integration test for GAP_SCAN A4 — publish-connection HEALTH. A dead refresh token used to be
//? swallowed (the stale token was handed back and every later post failed with a generic error).
//? Now the connection is marked unhealthy, the snapshot exposes `needsReconnect` per account, and a
//? successful refresh or a fresh connect clears it again.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const oauth = await import('../../server/content/publishOAuth');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `hlth-${String(stamp)}@youcomm.nl`, name: 'HLTH' } });
let workspaceId: string | null = null;

const needsReconnectSet = async (wsId: string): Promise<Set<string>> => {
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  const targets = snap.content?.publishTargets ?? [];
  const flagged = new Set<string>();
  for (const t of targets) for (const a of t.accounts) if (a.needsReconnect === true) flagged.add(`${t.platform}:${a.accountId ?? '__default__'}`);
  return flagged;
};

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'HLTH WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  const T0 = 2_000_000_000_000;
  const expired = { accessToken: 'stale-token', refreshToken: 'dead-refresh', expiresAt: T0 - 1000 };

  /* ---------------------------------------------- key shape */
  eq(oauth.healthKey('youtube', null), '__publishhealth_youtube', 'the default account has a bare health key');
  eq(oauth.healthKey('youtube', 'acc1'), '__publishhealth_youtube_acc1', 'a named account keys per account');
  eq(oauth.parseHealthKey('__publishhealth_youtube_acc1'), { platform: 'youtube', accountId: 'acc1' }, 'the health key round-trips');
  eq(oauth.parseHealthKey('__publish_youtube'), null, 'a TOKEN key is not read as a health key');

  /* ---------------------------------------------- a failing refresh marks the account unhealthy */
  await oauth.saveConnection(prisma, wsId, 'youtube', expired, 'acc1');
  assert((await needsReconnectSet(wsId)).size === 0, 'a fresh connection is healthy');

  const failingRefresh = { refresh: async () => { await Promise.resolve(); return null; } };
  const still = await oauth.getValidConnection(prisma, wsId, 'youtube', { refreshTransport: failingRefresh, now: T0, accountId: 'acc1' });
  eq(still?.accessToken, 'stale-token', 'the stale token is still returned so the upload fails honestly (no silent stub)');
  assert((await needsReconnectSet(wsId)).has('youtube:acc1'), 'the dead account is flagged needsReconnect in the snapshot');

  /* ---------------------------------------------- a throwing transport counts the same */
  await oauth.saveConnection(prisma, wsId, 'tiktok', expired, null);
  const throwingRefresh = { refresh: async () => { await Promise.resolve(); throw new Error('revoked_grant'); } };
  await oauth.getValidConnection(prisma, wsId, 'tiktok', { refreshTransport: throwingRefresh, now: T0 });
  const flagged = await needsReconnectSet(wsId);
  assert(flagged.has('tiktok:__default__'), 'a throwing refresh also flags the account');
  assert(flagged.has('youtube:acc1'), 'flags are per account, not global');

  const marker = await prisma.envVar.findFirst({ where: { workspaceId: wsId, key: '__publishhealth_tiktok' }, select: { value: true, secret: true } });
  assert(marker?.value.includes('revoked_grant') === true, 'the failure reason is stored for the UI/logs');
  eq(marker?.secret, false, 'a health marker is not a secret (no encryption round-trip)');

  /* ---------------------------------------------- a working refresh clears it */
  const okRefresh = { refresh: async () => { await Promise.resolve(); return { accessToken: 'fresh-token', expiresAt: T0 + 3_600_000 }; } };
  const revived = await oauth.getValidConnection(prisma, wsId, 'youtube', { refreshTransport: okRefresh, now: T0, accountId: 'acc1' });
  eq(revived?.accessToken, 'fresh-token', 'a successful refresh returns the new token');
  assert(!(await needsReconnectSet(wsId)).has('youtube:acc1'), 'a successful refresh clears the reconnect flag');

  /* ---------------------------------------------- a fresh connect clears it too */
  const exchange = { exchange: async () => { await Promise.resolve(); return { accessToken: 'reconnected' }; } };
  const res = await oauth.connectPublishPlatform(prisma, wsId, 'tiktok', { code: 'c', redirectUri: 'https://x/cb' }, { transport: exchange });
  assert(res.ok, 'the reconnect succeeds');
  assert((await needsReconnectSet(wsId)).size === 0, 'reconnecting clears the flag — the whole workspace is healthy again');

  /* ---------------------------------------------- tokens still parse (the two prefixes never collide) */
  const tokens = await oauth.getConnection(prisma, wsId, 'tiktok', null);
  eq(tokens?.accessToken, 'reconnected', 'the token store is unaffected by the health markers');
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('publishHealth');
