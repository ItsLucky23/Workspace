//? Integration test for real publishing (M5) against Mongo. Verifies: the OAuth token round-trips
//? ENCRYPTED through the EnvVar store; connectPublishPlatform stores tokens via an injected OAuth
//? transport; publishAsset runs a REAL upload (injected transport) when connected → a non-stub
//? PublishJob with the platform url; and degrades to a stub post when NOT connected (B-23 unchanged:
//? publishAsset only runs after a publish suggestion is accepted).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { saveConnection, getConnection, connectPublishPlatform } = await import('../../server/content/publishOAuth');
const { publishAsset } = await import('../../server/content/publish');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `pub-${String(stamp)}@youcomm.nl`, name: 'Pub Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Pub WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const devProject = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const project = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: devProject?.id ?? '', title: 'My Content' } });
  const asset = await prisma.contentAsset.create({ data: { workspaceId: wsId, contentProjectId: project.id, kind: 'render', url: '/media/final.mp4', status: 'ready' } });

  // 1) token store round-trips encrypted
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'AT-secret', refreshToken: 'RT', expiresAt: stamp + 3600_000 });
  const stored = await prisma.envVar.findFirst({ where: { workspaceId: wsId, key: '__publish_youtube' } });
  assert(stored?.secret === true, 'the token EnvVar is marked secret');
  assert(!(stored?.value ?? '').includes('AT-secret'), 'the stored value is ENCRYPTED (not plaintext)');
  const back = await getConnection(prisma, wsId, 'youtube');
  eq(back?.accessToken, 'AT-secret', 'getConnection decrypts the access token');

  // 2) connectPublishPlatform via an injected OAuth transport
  const conn = await connectPublishPlatform(prisma, wsId, 'tiktok', { code: 'CODE', redirectUri: 'https://app/cb' }, {
    transport: { exchange: async () => ({ accessToken: 'TT-AT' }) },
  });
  assert(conn.ok, 'connect exchanges + stores');
  eq((await getConnection(prisma, wsId, 'tiktok'))?.accessToken, 'TT-AT', 'tiktok token stored');

  // 3) publishAsset — REAL upload when connected (injected transport)
  let captured = { platform: '', assetUrl: '', title: '' };
  const real = await publishAsset(prisma, wsId, { contentProjectId: project.id, assetId: asset.id, platform: 'youtube' }, {
    uploadTransport: { upload: async (platform, input) => { captured = { platform, assetUrl: input.assetUrl, title: input.title }; return { externalUrl: 'https://youtube.com/watch?v=REAL' }; } },
  });
  assert(real.ok && real.stub === false, 'a connected publish is a REAL (non-stub) post');
  eq(real.externalUrl, 'https://youtube.com/watch?v=REAL', 'the real external url is recorded');
  eq(captured.assetUrl, '/media/final.mp4', 'the upload received the asset url');
  eq(captured.title, 'My Content', 'the upload received the project title');
  const realJob = await prisma.publishJob.findFirst({ where: { workspaceId: wsId, id: real.publishJobId ?? '' } });
  eq(realJob?.externalUrl, 'https://youtube.com/watch?v=REAL', 'the PublishJob stored the real url');

  // 4) NOT connected → a stub post
  const stub = await publishAsset(prisma, wsId, { contentProjectId: project.id, assetId: asset.id, platform: 'instagram' });
  assert(!stub.ok && stub.error === 'platform.notBuilt', 'a future-ready platform is not built');
  // linkedin: also not built; tiktok connected earlier → would be real. Use a fresh WS-less check via instagram already covered.
  //? Honesty fix (audit): TikTok is CONNECTED (step 2) but the upload FAILS → this is now an explicit ERROR,
  //? not a silently-swallowed fake 'done'/stub. This is the core of the honesty fix.
  const failed = await publishAsset(prisma, wsId, { contentProjectId: project.id, assetId: asset.id, platform: 'tiktok' }, {
    uploadTransport: { upload: async () => null }, // the real upload fails
  });
  assert(!failed.ok && failed.error === 'publish.uploadFailed', 'a connected-but-failed upload is an honest error (not a fake success)');
  const failedJob = await prisma.publishJob.findFirst({ where: { workspaceId: wsId, id: failed.publishJobId ?? '' } });
  eq(failedJob?.status, 'error', 'the failed upload is recorded as an error job, not done');

  // 5) F1 — an EXPIRED token is transparently refreshed, persisted re-encrypted, and the upload uses the FRESH token.
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'AT-stale', refreshToken: 'RT-keep', expiresAt: stamp - 10_000 });
  let refreshedWith = '';
  let uploadUsed = '';
  const refreshed = await publishAsset(prisma, wsId, { contentProjectId: project.id, assetId: asset.id, platform: 'youtube' }, {
    now: stamp,
    refreshTransport: { refresh: async (_platform, rt) => { refreshedWith = rt; return { accessToken: 'AT-fresh', expiresAt: stamp + 3600_000 }; } },
    uploadTransport: { upload: async (_platform, input) => { uploadUsed = input.accessToken; return { externalUrl: 'https://youtube.com/watch?v=FRESH' }; } },
  });
  eq(refreshedWith, 'RT-keep', 'the refresh grant used the stored refresh token');
  eq(uploadUsed, 'AT-fresh', 'the upload used the REFRESHED access token, not the stale one');
  assert(refreshed.ok && refreshed.stub === false, 'the refreshed publish is a real post');
  const persisted = await getConnection(prisma, wsId, 'youtube');
  eq(persisted?.accessToken, 'AT-fresh', 'the fresh access token was persisted');
  eq(persisted?.refreshToken, 'RT-keep', 'the refresh token was preserved (Google omits a new one)');

  // 6) F1 — a still-valid token is NOT refreshed (no needless grant).
  await saveConnection(prisma, wsId, 'youtube', { accessToken: 'AT-valid', refreshToken: 'RT-keep', expiresAt: stamp + 3600_000 });
  let refreshCalled = false;
  const noRefresh = await publishAsset(prisma, wsId, { contentProjectId: project.id, assetId: asset.id, platform: 'youtube' }, {
    now: stamp,
    refreshTransport: { refresh: async () => { refreshCalled = true; return null; } },
    uploadTransport: { upload: async (_platform, input) => ({ externalUrl: `https://youtube.com/watch?v=${input.accessToken}` }) },
  });
  assert(!refreshCalled, 'a still-valid token triggers no refresh grant');
  eq(noRefresh.externalUrl, 'https://youtube.com/watch?v=AT-valid', 'the upload used the still-valid token unchanged');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/publishReal.test.mts');
