//? Integration test for the workspace-settings control-ops (server/orchestrator/
//? conductor.ts): save-env / remove-env / save-integration / save-git-config /
//? skill-toggle. Runs against the REAL Conductor + Mongo: create a workspace, then
//? exercise each op and assert the EnvVar / IntegrationTool / Workspace.gitConfig /
//? InfoSource rows persisted the change.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { decryptSecret, encryptSecret } = await import('../../server/crypto/secretBox');
const { saveIntegrationRequest, integrationEnvRefsBelongToWorkspace } = await import('../../src/workspaces/_sync/saveIntegration_server_v1');
const { rotateWebhookSecretRequest } = await import('../../src/workspaces/_api/rotateWebhookSecret_v1');
const { loadMcpIntegrations } = await import('../../server/orchestrator/stageRunner');

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
let otherWorkspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Settings WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const other = await createBlankWorkspace(prisma, owner.id, 'Other Settings WS');
  otherWorkspaceId = other.workspaceId;

  //? A production-style blank workspace has no integrations yet, so its pipeline
  //? must not retain the demo seed's phantom `tool-mongodb` selection.
  const blankStages = await prisma.pipelineStage.findMany({ where: { workspaceId: wsId }, select: { tools: true } });
  assert(blankStages.every((stage) => stage.tools.length === 0), 'blank pipeline has no phantom IntegrationTool selection');
  eq(await prisma.integrationTool.count({ where: { workspaceId: wsId } }), 0, 'blank workspace starts with no IntegrationTool rows');

  //? save-env → payload { key, value, secret }. A SECRET value is ENCRYPTED at rest (encryptSecret,
  //? same as the gitlab token) and decrypts back for display; the flag persists.
  await enqueueControlAction({ workspaceId: wsId, op: 'save-env', target: {}, payload: { key: 'API_TOKEN', value: 'super-secret-value', secret: true }, userId: owner.id, clientRequestId: `save-env-${String(stamp)}` });
  const env = await poll(() => prisma.envVar.findFirst({ where: { workspaceId: wsId, key: 'API_TOKEN' } }));
  assert(env !== null, 'save-env created an EnvVar row');
  assert((env?.value ?? '') !== 'super-secret-value', 'save-env stores the secret value ENCRYPTED (not plaintext)');
  eq(decryptSecret(env?.value ?? ''), 'super-secret-value', 'the encrypted value decrypts back to the original');
  eq(env?.secret ?? false, true, 'save-env persisted the secret flag');

  //? A snapshot-masked secret posts an empty replacement value when untouched. That must be a no-op,
  //? not an accidental erase; a non-empty value remains the explicit replacement path.
  const encryptedBeforeMaskedSave = env?.value ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'save-env', target: {}, payload: { key: 'API_TOKEN', value: '', secret: true }, userId: owner.id, clientRequestId: `save-env-masked-${String(stamp)}` });
  const preservedEnv = await poll(() => prisma.envVar.findFirst({ where: { workspaceId: wsId, key: 'API_TOKEN' } }));
  eq(preservedEnv?.value, encryptedBeforeMaskedSave, 'an empty masked secret save preserves the existing ciphertext');
  eq(decryptSecret(preservedEnv?.value ?? ''), 'super-secret-value', 'an empty masked secret save preserves the existing plaintext');

  //? remove-env → target.envId (the DB id). Assert the row is gone.
  const envId = env?.id ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'remove-env', target: { envId }, payload: {}, userId: owner.id, clientRequestId: `remove-env-${String(stamp)}` });
  const removed = await poll(async () => {
    const still = await prisma.envVar.findFirst({ where: { workspaceId: wsId, id: envId } });
    return still === null ? true : null;
  });
  assert(removed === true, 'remove-env deleted the EnvVar row');

  //? Cross-tenant EnvVar hardening: the sync save preflight accepts only refs that
  //? ALL resolve inside the room workspace. A mixed own+foreign request is rejected
  //? as one unit and never reaches the Conductor.
  const ownMcpEnv = await prisma.envVar.create({ data: { workspaceId: wsId, key: 'OWN_MCP_SECRET', value: encryptSecret('own-secret'), secret: true } });
  const foreignMcpEnv = await prisma.envVar.create({ data: { workspaceId: other.workspaceId, key: 'FOREIGN_MCP_SECRET', value: encryptSecret('foreign-secret'), secret: true } });
  const ownFields = [{ id: 'token', label: 'Token', envVarId: ownMcpEnv.id }];
  const mixedFields = [...ownFields, { id: 'foreign', label: 'Foreign', envVarId: foreignMcpEnv.id }];
  assert(await integrationEnvRefsBelongToWorkspace(prisma, wsId, ownFields), 'save-integration preflight accepts same-workspace EnvVar refs');
  assert(!(await integrationEnvRefsBelongToWorkspace(prisma, wsId, mixedFields)), 'save-integration preflight rejects a mixed own+foreign EnvVar ref set');
  const rejected = await saveIntegrationRequest({
    clientInput: { name: 'Rejected cross-tenant MCP', type: 'custom', fields: mixedFields, mcp: { enabled: true, command: 'node mcp.mjs' }, clientRequestId: `reject-int-${String(stamp)}` },
    userId: owner.id, prisma, roomCode: wsId,
  });
  eq(rejected.status, 'error', 'save-integration rejects the complete cross-tenant request');
  eq(await prisma.integrationTool.count({ where: { workspaceId: wsId, name: 'Rejected cross-tenant MCP' } }), 0, 'rejected save persisted no partial IntegrationTool');

  //? Runtime defence-in-depth: only stage-selected RW tools are loaded; arbitrary
  //? MCP has no generic RO enforcement, so RO fails closed instead of mounting with
  //? write credentials. Tool + EnvVar lookups remain workspace-scoped.
  const selectedTool = await prisma.integrationTool.create({ data: { workspaceId: wsId, name: 'Selected MCP', type: 'custom', fields: ownFields, mcp: { enabled: true, command: 'node selected.mjs' } } });
  await prisma.integrationTool.create({ data: { workspaceId: wsId, name: 'Unselected MCP', type: 'custom', fields: ownFields, mcp: { enabled: true, command: 'node unselected.mjs' } } });
  const corruptTool = await prisma.integrationTool.create({ data: { workspaceId: wsId, name: 'Corrupt MCP', type: 'custom', fields: mixedFields, mcp: { enabled: true, command: 'node corrupt.mjs' } } });
  const foreignTool = await prisma.integrationTool.create({ data: { workspaceId: other.workspaceId, name: 'Foreign MCP', type: 'custom', fields: [{ id: 'token', label: 'Token', envVarId: foreignMcpEnv.id }], mcp: { enabled: true, command: 'node foreign.mjs' } } });
  const loaded = await loadMcpIntegrations(prisma, wsId, [{ toolId: selectedTool.id, tier: 'rw' }, { toolId: corruptTool.id, tier: 'rw' }]);
  eq(loaded.map((tool) => tool.name), ['Selected MCP'], 'runtime mounts only the selected valid RW MCP integration');
  eq(loaded[0]?.env?.OWN_MCP_SECRET, 'own-secret', 'runtime decrypts same-workspace RW MCP config');
  eq((await loadMcpIntegrations(prisma, wsId, [{ toolId: selectedTool.id, tier: 'ro' }])).length, 0, 'RO MCP selection fails closed instead of mounting as RW');
  eq((await loadMcpIntegrations(prisma, wsId, [{ toolId: corruptTool.id, tier: 'rw' }])).length, 0, 'corrupted foreign EnvVar ref yields no MCP command/secret/config');
  eq((await loadMcpIntegrations(prisma, wsId, [{ toolId: foreignTool.id, tier: 'rw' }])).length, 0, 'foreign IntegrationTool id cannot be mounted in this workspace');

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

  //? #27 forge-webhook-rotate → mints Workspace.webhookSecret. Assert a non-empty secret lands + rotates.
  await enqueueControlAction({ workspaceId: wsId, op: 'forge-webhook-rotate', target: {}, payload: {}, userId: owner.id, clientRequestId: `whs-1-${String(stamp)}` });
  const firstSecret = await poll(async () => {
    const ws = await prisma.workspace.findUnique({ where: { id: wsId }, select: { webhookSecret: true } });
    return ws?.webhookSecret && ws.webhookSecret.length > 0 ? ws.webhookSecret : null;
  });
  assert(firstSecret !== null, 'forge-webhook-rotate minted a Workspace.webhookSecret');
  await enqueueControlAction({ workspaceId: wsId, op: 'forge-webhook-rotate', target: {}, payload: {}, userId: owner.id, clientRequestId: `whs-2-${String(stamp)}` });
  const rotated = await poll(async () => {
    const ws = await prisma.workspace.findUnique({ where: { id: wsId }, select: { webhookSecret: true } });
    return ws?.webhookSecret && ws.webhookSecret !== firstSecret ? ws.webhookSecret : null;
  });
  assert(rotated !== null, 'a second forge-webhook-rotate produced a DIFFERENT secret (real rotation)');

  //? The API variant returns the fresh plaintext ONLY to its authenticated initiator. The snapshot
  //? remains metadata-only even immediately after this third rotation.
  const initiatedRotation = await rotateWebhookSecretRequest({ workspaceId: wsId, userId: owner.id, prisma, clientRequestId: `whs-api-${String(stamp)}` });
  assert(initiatedRotation.ok, 'the initiator-only webhook API rotation succeeds');
  const snapAfterApiRotation = await (await import('../../server/read/workspaceSnapshot')).buildSnapshot(prisma, owner.id, wsId);
  eq(snapAfterApiRotation.workspaces[0]?.webhookConfigured, true, 'the post-rotation snapshot exposes webhook configured metadata');
  assert(!('webhookSecret' in (snapAfterApiRotation.workspaces[0] ?? {})), 'the post-rotation snapshot NEVER returns the webhook secret');

  //? skill-toggle → target.sourceId toggles a Sources context document (the capability-Skill
  //? branch was removed with the capability-skill layer; the frozen op name stays).
  const contextDoc = await prisma.infoSource.create({ data: { workspaceId: wsId, mode: 'context-doc', source: 'test', name: `Test doc ${String(stamp)}`, enabled: false } });
  await enqueueControlAction({ workspaceId: wsId, op: 'skill-toggle', target: { sourceId: contextDoc.id }, payload: { on: true }, userId: owner.id, clientRequestId: `source-${String(stamp)}` });
  const docToggled = await poll(async () => {
    const s = await prisma.infoSource.findFirst({ where: { workspaceId: wsId, id: contextDoc.id } });
    return s?.enabled === true ? s : null;
  });
  assert(docToggled !== null, 'skill-toggle flips a context document enabled=true');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId).catch(() => undefined);
  if (otherWorkspaceId) await cleanupWorkspace(prisma, otherWorkspaceId, [owner.id]).catch(() => undefined);
  if (!workspaceId && !otherWorkspaceId) await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/settings.test.mts');
