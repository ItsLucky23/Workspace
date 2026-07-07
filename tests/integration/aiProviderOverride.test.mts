//? Integration test for FREEDOM_PROGRAM P1 — per-workspace AI provider overrides. Verifies the
//? save-ai-provider op persists a `__ai_provider_<feature>` EnvVar, loadWorkspaceAiOverrides reads it back,
//? resolveAssignment respects it, and 'default' clears it (falls back to the global default). Real Conductor +
//? Mongo. This is what finally FEEDS the previously-inert resolveAssignment override seam.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { loadWorkspaceAiOverrides } = await import('../../server/ai/workspaceAssignments');
const { resolveAssignment } = await import('../../server/ai/assignments');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `apo-${String(stamp)}@youcomm.nl`, name: 'APO' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'APO WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  // 'script' defaults to gemini-api; override it to claude-cli
  eq(resolveAssignment('script'), 'gemini-api', 'baseline: script defaults to gemini-api');
  await enqueueControlAction({ workspaceId: wsId, op: 'save-ai-provider', target: {}, payload: { feature: 'script', providerId: 'claude-cli' }, userId: owner.id, clientRequestId: `apo-1-${String(stamp)}` });

  const overrides = await loadWorkspaceAiOverrides(wsId);
  eq(overrides.script, 'claude-cli', 'the workspace override is loaded');
  eq(resolveAssignment('script', overrides), 'claude-cli', 'resolveAssignment respects the workspace override');
  eq(resolveAssignment('script', { ...overrides, script: 'gemini-api' }), 'gemini-api', 'an explicit call-site override still wins');

  // clear it → back to the default
  await enqueueControlAction({ workspaceId: wsId, op: 'save-ai-provider', target: {}, payload: { feature: 'script', providerId: 'default' }, userId: owner.id, clientRequestId: `apo-2-${String(stamp)}` });
  const cleared = await loadWorkspaceAiOverrides(wsId);
  assert(cleared.script === undefined, "'default' clears the override");
  eq(resolveAssignment('script', cleared), 'gemini-api', 'cleared → back to the global default');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/aiProviderOverride.test.mts');
