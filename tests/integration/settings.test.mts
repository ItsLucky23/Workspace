//? Integration test for the workspace-settings control-ops (server/orchestrator/
//? conductor.ts): save-env / remove-env / save-integration / save-git-config /
//? skill-toggle. Runs against the REAL Conductor + Mongo: create a workspace, then
//? exercise each op and assert the EnvVar / IntegrationTool / Workspace.gitConfig /
//? InfoSource rows persisted the change.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

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

//? Read a string field off a Prisma Json value without an `as any` cast.
function jsonStr(v: unknown, key: string): string | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const field = (v as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `settings-${String(stamp)}@youcomm.nl`, name: 'Settings Owner' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Settings WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  //? save-env → payload { key, value, secret }. Assert an EnvVar row persisted.
  //? NOTE: the conductor's save-env case stores `value` verbatim — it does NOT encrypt
  //? (only gitlab-settings/token runs through encryptSecret). The schema comment says
  //? "encrypted when secret", but that is not applied at this layer, so we assert the
  //? value round-trips as sent + the `secret` flag persists.
  await enqueueControlAction({ workspaceId: wsId, op: 'save-env', target: {}, payload: { key: 'API_TOKEN', value: 'super-secret-value', secret: true }, userId: owner.id, clientRequestId: `save-env-${String(stamp)}` });
  const env = await poll(() => prisma.envVar.findFirst({ where: { workspaceId: wsId, key: 'API_TOKEN' } }));
  assert(env !== null, 'save-env created an EnvVar row');
  eq(env?.value ?? '', 'super-secret-value', 'save-env persisted the value');
  eq(env?.secret ?? false, true, 'save-env persisted the secret flag');

  //? remove-env → target.envId (the DB id). Assert the row is gone.
  const envId = env?.id ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'remove-env', target: { envId }, payload: {}, userId: owner.id, clientRequestId: `remove-env-${String(stamp)}` });
  const removed = await poll(async () => {
    const still = await prisma.envVar.findFirst({ where: { workspaceId: wsId, id: envId } });
    return still === null ? true : null;
  });
  assert(removed === true, 'remove-env deleted the EnvVar row');

  //? save-integration → payload { name, type, fields, mcp }. Assert an IntegrationTool row.
  await enqueueControlAction({ workspaceId: wsId, op: 'save-integration', target: {}, payload: { name: 'Sentry', type: 'custom', fields: [{ id: 'dsn', label: 'DSN' }], mcp: { enabled: false, command: '' } }, userId: owner.id, clientRequestId: `save-int-${String(stamp)}` });
  const integration = await poll(() => prisma.integrationTool.findFirst({ where: { workspaceId: wsId, name: 'Sentry' } }));
  assert(integration !== null, 'save-integration created an IntegrationTool row');
  eq(integration?.type ?? '', 'custom', 'save-integration persisted the type');

  //? save-git-config → payload { branchStrategy, ... } (normalized). Assert Workspace.gitConfig.
  await enqueueControlAction({ workspaceId: wsId, op: 'save-git-config', target: {}, payload: { branchStrategy: 'typed' }, userId: owner.id, clientRequestId: `save-git-${String(stamp)}` });
  const gitCfg = await poll(async () => {
    const ws = await prisma.workspace.findUnique({ where: { id: wsId } });
    return jsonStr(ws?.gitConfig, 'branchStrategy') === 'typed' ? ws : null;
  });
  assert(gitCfg !== null, 'save-git-config persisted Workspace.gitConfig.branchStrategy');

  //? skill-toggle → target.sourceId flips InfoSource.enabled. Seed a disabled skill row,
  //? then toggle it on.
  const skill = await prisma.infoSource.create({ data: { workspaceId: wsId, mode: 'skill', name: `Test skill ${String(stamp)}`, kind: 'live', enabled: false, usedByStages: [] } });
  await enqueueControlAction({ workspaceId: wsId, op: 'skill-toggle', target: { sourceId: skill.id }, payload: { on: true }, userId: owner.id, clientRequestId: `skill-${String(stamp)}` });
  const toggled = await poll(async () => {
    const s = await prisma.infoSource.findFirst({ where: { workspaceId: wsId, id: skill.id } });
    return s?.enabled === true ? s : null;
  });
  assert(toggled !== null, 'skill-toggle flipped the InfoSource skill enabled=true');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/settings.test.mts');
