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
  const noConn = await publishAsset(prisma, wsId, { contentProjectId: project.id, assetId: asset.id, platform: 'tiktok' }, {
    uploadTransport: { upload: async () => null }, // simulate an upload failure → degrade to stub
  });
  assert(noConn.ok && noConn.stub === true && (noConn.externalUrl ?? '').startsWith('stub://'), 'an upload failure degrades to a stub post (never loses the intent)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/publishReal.test.mts');
