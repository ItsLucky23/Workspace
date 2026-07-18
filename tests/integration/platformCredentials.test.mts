//? Integration test for GAP_SCAN A7 — platform APP credentials in-app. A self-hoster pastes their own
//? YouTube/TikTok app credentials in the UI instead of editing `.env`: stored encrypted per workspace,
//? RBAC-gated to workspaceSettings, WRITE-ONLY (the snapshot reports the source, never the value), with
//? `.env` kept as a fallback. Nothing is auto-migrated.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const oauth = await import('../../server/content/publishOAuth');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { dispatchControlSync } = await import('../../server/control/dispatchSync');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `cred-${String(stamp)}@youcomm.nl`, name: 'CRED' } });
let workspaceId: string | null = null;

const sourceOf = async (wsId: string, platform: string): Promise<string> => {
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  return snap.content?.platformCredentials.find((c) => c.platform === platform)?.source ?? 'missing';
};

const save = async (wsId: string, payload: Record<string, string>, userId = owner.id): Promise<void> => {
  await enqueueControlAction({
    workspaceId: wsId, userId, op: 'save-platform-credentials', target: {},
    payload, clientRequestId: `cred-${String(Math.round(performance.now() * 1000))}-${payload.platform ?? 'x'}`,
  });
};

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'CRED WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  //? The test must not depend on the developer's own .env.
  const prevId = process.env.YOUTUBE_CLIENT_ID;
  const prevSecret = process.env.YOUTUBE_CLIENT_SECRET;
  delete process.env.YOUTUBE_CLIENT_ID;
  delete process.env.YOUTUBE_CLIENT_SECRET;

  /* ---------------------------------------------- nothing configured anywhere */
  eq(await sourceOf(wsId, 'youtube'), 'none', 'with no .env and no stored credentials the platform reads as not configured');
  eq((await oauth.getPlatformCredentials(prisma, wsId, 'youtube')).clientId, '', 'and resolving yields nothing');

  /* ---------------------------------------------- .env fallback */
  process.env.YOUTUBE_CLIENT_ID = 'env-id';
  process.env.YOUTUBE_CLIENT_SECRET = 'env-secret';
  eq(await sourceOf(wsId, 'youtube'), 'env', 'an existing install keeps working through the .env fallback');
  eq((await oauth.getPlatformCredentials(prisma, wsId, 'youtube')).clientId, 'env-id', 'the env credentials resolve');

  /* ---------------------------------------------- the in-app store wins */
  await save(wsId, { platform: 'youtube', clientId: 'ws-id', clientSecret: 'ws-secret' });
  eq(await sourceOf(wsId, 'youtube'), 'workspace', 'stored credentials take precedence over .env');
  const resolved = await oauth.getPlatformCredentials(prisma, wsId, 'youtube');
  eq(resolved.clientId, 'ws-id', 'the stored client id resolves');
  eq(resolved.clientSecret, 'ws-secret', 'the stored secret resolves');

  //? Encrypted at rest + never echoed back.
  const row = await prisma.envVar.findFirst({ where: { workspaceId: wsId, key: '__platformcred_youtube_secret' }, select: { value: true, secret: true } });
  assert(row !== null, 'the secret is persisted');
  assert(!row?.value.includes('ws-secret'), 'the secret is NOT stored in plaintext');
  eq(row?.secret, true, 'the row is flagged secret');
  const snap = await buildSnapshot(prisma, owner.id, wsId);
  assert(!JSON.stringify(snap.content?.platformCredentials).includes('ws-secret'), 'the snapshot never carries the value (write-only)');

  /* ---------------------------------------------- the credentials actually sign the OAuth requests */
  const authUrl = oauth.buildAuthUrl('youtube', { redirectUri: 'https://app/cb', state: 's' }, resolved);
  assert(authUrl.includes('client_id=ws-id'), 'the authorize URL uses the workspace credentials');
  const exchange = oauth.buildExchangeRequest('youtube', { code: 'c', redirectUri: 'https://app/cb' }, resolved);
  assert(exchange.body?.includes('client_secret=ws-secret') === true, 'the token exchange uses the workspace secret');
  assert(oauth.buildAuthUrl('youtube', { redirectUri: 'https://app/cb', state: 's' }).includes('client_id=env-id'), 'without credentials the builders still fall back to .env');

  /* ---------------------------------------------- per platform, and clearing falls back again */
  eq(await sourceOf(wsId, 'tiktok'), 'none', 'credentials are per platform — tiktok is untouched');
  await save(wsId, { platform: 'youtube', clientId: '', clientSecret: '' });
  eq(await sourceOf(wsId, 'youtube'), 'env', 'clearing both halves falls back to .env');
  eq(await prisma.envVar.count({ where: { workspaceId: wsId, key: { startsWith: '__platformcred_' } } }), 0, 'the cleared rows are deleted, not blanked');

  /* ---------------------------------------------- RBAC: a non-member never writes */
  //? The capability check lives in the control-API dispatch the `_sync` route uses (never in the queue).
  const outsider = await prisma.user.create({ data: { email: `out-${String(stamp)}@youcomm.nl`, name: 'OUT' } });
  const denied = await dispatchControlSync({
    op: 'save-platform-credentials', roomCode: wsId, userId: outsider.id, prisma,
    payload: { platform: 'tiktok', clientId: 'evil', clientSecret: 'evil' }, clientRequestId: `cred-evil-${String(stamp)}`,
  });
  assert(!denied.ok, 'a non-member is refused');
  eq(denied.ok ? '' : denied.errorCode, 'auth.forbidden', 'the refusal is an RBAC forbid, not a generic error');
  eq(await sourceOf(wsId, 'tiktok'), 'none', 'a non-member cannot store platform credentials');
  await prisma.user.delete({ where: { id: outsider.id } }).catch(() => null);

  /* ---------------------------------------------- no auto-migration */
  const fresh = await createBlankWorkspace(prisma, owner.id, 'CRED WS2');
  eq(await sourceOf(fresh.workspaceId, 'youtube'), 'env', 'a new workspace does NOT copy .env into its store');
  eq(await prisma.envVar.count({ where: { workspaceId: fresh.workspaceId, key: { startsWith: '__platformcred_' } } }), 0, 'no credentials are auto-migrated on create');
  await cleanupWorkspace(prisma, fresh.workspaceId);

  if (prevId === undefined) delete process.env.YOUTUBE_CLIENT_ID; else process.env.YOUTUBE_CLIENT_ID = prevId;
  if (prevSecret === undefined) delete process.env.YOUTUBE_CLIENT_SECRET; else process.env.YOUTUBE_CLIENT_SECRET = prevSecret;
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId);
  await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('platformCredentials');
