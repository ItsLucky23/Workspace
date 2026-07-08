//? K3 — resolving a workspace's env for container injection (real Mongo + secretBox). Verifies: plain EnvVars
//? pass through, `secret` EnvVars are DECRYPTED, the internal `__`-namespace (publish tokens / provider keys) is
//? NEVER injected, and `workspaceContainerContext` only attaches the service network when a stack is running.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { resolveWorkspaceEnv, } = await import('../../server/container/serviceEnv');
const { workspaceContainerContext, stackNetwork } = await import('../../server/container/composeEngine');
const { encryptSecret } = await import('../../server/crypto/secretBox');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `senv-${String(stamp)}@youcomm.nl`, name: 'SEnv' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'SEnv WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  await prisma.envVar.create({ data: { workspaceId: wsId, key: 'NODE_ENV', value: 'production', secret: false } });
  await prisma.envVar.create({ data: { workspaceId: wsId, key: 'DATABASE_URL', value: encryptSecret('postgres://app:pw@postgres:5432/app'), secret: true } });
  await prisma.envVar.create({ data: { workspaceId: wsId, key: '__publish_youtube', value: encryptSecret('token-secret'), secret: true } });

  const env = await resolveWorkspaceEnv(prisma, wsId);
  eq(env.NODE_ENV, 'production', 'a plain env var passes through');
  eq(env.DATABASE_URL, 'postgres://app:pw@postgres:5432/app', 'a secret env var is DECRYPTED for the container');
  assert(!('__publish_youtube' in env), 'the internal __-namespace is NOT injected (no token leak)');

  // no running stack → no service network
  const ctx0 = await workspaceContainerContext(prisma, wsId);
  assert(ctx0.env.DATABASE_URL !== undefined, 'the context carries the app env');
  eq(ctx0.serviceNetwork, undefined, 'no running stack → no service network attached');

  // a running stack → the per-workspace service network is attached
  await prisma.serviceStack.create({ data: { workspaceId: wsId, name: 'data', compose: 'services: {}', services: ['postgres'], status: 'running' } });
  const ctx1 = await workspaceContainerContext(prisma, wsId);
  eq(ctx1.serviceNetwork, stackNetwork(wsId), 'a running stack attaches the per-workspace service network');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/serviceEnvResolve.test.mts');
