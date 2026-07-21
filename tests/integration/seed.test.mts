//? Integration test — server/bootstrap/seedWorkspace.seedDemoWorkspace against the
//? REAL Mongo. Creates a throwaway owner User, seeds the demo workspace, asserts the
//? row counts + a couple of key field values, then cleans everything up. Run with
//? `npx tsx tests/integration/seed.test.mts`.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { DOCS, ENV_VARS, INTEGRATION_TOOLS, SKILLS, STAGE_CONFIGS } from '../../src/workspaces/_data/seed';

const isObjectId = (value: string): boolean => /^[a-f\d]{24}$/i.test(value);

const prisma = await db();
//? Import server modules only after db() resolves the secret-manager pointers; an
//? eager stageRunner import boots core before DATABASE_URL is resolved in this harness.
const { seedDemoWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { loadMcpIntegrations } = await import('../../server/orchestrator/stageRunner');
const { toStageConfig } = await import('../../server/read/workspaceSnapshot');

//? Throwaway owner — unique email so re-runs never collide on @@unique([email, provider]).
const owner = await prisma.user.create({
  data: { email: `seed-test-${Date.now()}@youcomm.nl`, name: 'Seed Test Owner', avatarFallback: 'S' },
});

let workspaceId = '';
try {
  const seeded = await seedDemoWorkspace(prisma, owner.id);
  workspaceId = seeded.workspaceId;
  assert(workspaceId.length > 0, 'seedDemoWorkspace returns a workspaceId');

  //? Row counts (expected values mirror the seed constants — MIGRATION §5.2).
  eq(await prisma.workspaceRole.count({ where: { workspaceId } }), 3, 'WorkspaceRole count');
  eq(await prisma.workspaceMember.count({ where: { workspaceId } }), 6, 'WorkspaceMember count');
  eq(await prisma.pipelineStage.count({ where: { workspaceId } }), 7, 'PipelineStage count');
  eq(await prisma.ticket.count({ where: { workspaceId } }), 12, 'Ticket count');
  eq(await prisma.sprint.count({ where: { workspaceId } }), 2, 'Sprint count (backlog is virtual)');
  eq(await prisma.workspaceSuggestion.count({ where: { workspaceId } }), 2, 'WorkspaceSuggestion count');
  eq(await prisma.infoSource.count({ where: { workspaceId } }), DOCS.length, 'InfoSource count (context documents only)');
  eq(await prisma.skill.count({ where: { workspaceId, skillType: 'capability' } }), SKILLS.length, 'canonical capability Skill count');
  eq(await prisma.envVar.count({ where: { workspaceId } }), 4, 'EnvVar count');
  eq(await prisma.integrationTool.count({ where: { workspaceId } }), 2, 'IntegrationTool count');
  eq(await prisma.invite.count({ where: { workspaceId } }), 1, 'Invite count');
  eq(await prisma.ticketEvent.count({ where: { workspaceId } }), 10, 'TicketEvent count');
  eq(await prisma.workspaceBudget.count({ where: { workspaceId } }), 1, 'WorkspaceBudget count');

  //? Legacy seed ids must never survive as loose refs. EnvVar ids are translated
  //? into IntegrationField.envVarId, then IntegrationTool ids into StageToolCfg.toolId.
  const envRows = await prisma.envVar.findMany({ where: { workspaceId } });
  const integrationRows = await prisma.integrationTool.findMany({ where: { workspaceId } });
  const stageRows = await prisma.pipelineStage.findMany({ where: { workspaceId } });
  for (const expectedTool of INTEGRATION_TOOLS) {
    const integrationRow = integrationRows.find((row) => row.name === expectedTool.name && row.type === expectedTool.type);
    assert(integrationRow !== undefined, `seeded IntegrationTool '${expectedTool.name}' exists`);
    if (!integrationRow) continue;
    assert(isObjectId(integrationRow.id), `seeded IntegrationTool '${expectedTool.name}' has a real ObjectId`);
    for (const expectedField of expectedTool.fields) {
      const field = integrationRow.fields.find((candidate) => candidate.id === expectedField.id);
      assert(field !== undefined, `seeded IntegrationTool field '${expectedField.id}' exists`);
      if (!field) continue;
      if (expectedField.envVarId === null) {
        eq(field.envVarId, null, `field '${expectedField.id}' preserves its empty EnvVar ref`);
        continue;
      }
      const expectedEnv = ENV_VARS.find((envVar) => envVar.id === expectedField.envVarId);
      const envRow = envRows.find((candidate) => candidate.key === expectedEnv?.key);
      assert(envRow !== undefined, `legacy EnvVar '${expectedField.envVarId}' resolves to a seeded row`);
      if (!envRow) continue;
      assert(isObjectId(envRow.id), `seeded EnvVar '${envRow.key}' has a real ObjectId`);
      eq(field.envVarId, envRow.id, `field '${expectedField.id}' points at the real EnvVar ObjectId`);
    }
  }
  for (const expectedStage of STAGE_CONFIGS) {
    const stageRow = stageRows.find((row) => row.key === expectedStage.id);
    assert(stageRow !== undefined, `seeded stage '${expectedStage.id}' exists for tool mapping`);
    if (!stageRow) continue;
    assert(stageRow.tools.every((tool) => isObjectId(tool.toolId)), `stage '${expectedStage.id}' contains only real IntegrationTool ObjectIds`);
    for (const expectedSelection of expectedStage.tools) {
      const expectedTool = INTEGRATION_TOOLS.find((tool) => tool.id === expectedSelection.toolId);
      const integrationRow = integrationRows.find((row) => row.name === expectedTool?.name && row.type === expectedTool?.type);
      assert(integrationRow !== undefined, `legacy tool '${expectedSelection.toolId}' resolves for stage '${expectedStage.id}'`);
      if (!integrationRow) continue;
      assert(stageRow.tools.some((tool) => tool.toolId === integrationRow.id && tool.tier === expectedSelection.tier), `stage '${expectedStage.id}' points at '${integrationRow.name}' by real ObjectId + tier`);
    }
  }

  //? Arbitrary MCP cannot enforce generic read-only access: the seeded Plan stage's
  //? RO selection is omitted, while the Implementation stage's selected RW tools mount.
  const planStage = stageRows.find((row) => row.key === 'plan');
  const implStageForMcp = stageRows.find((row) => row.key === 'impl');
  assert(planStage !== undefined && implStageForMcp !== undefined, 'seeded Plan + Implementation stages exist for MCP tier checks');
  if (planStage && implStageForMcp) {
    eq((await loadMcpIntegrations(prisma, workspaceId, toStageConfig(planStage).tools)).length, 0, 'seeded RO MCP selection fails closed and is omitted');
    const rwMounted = await loadMcpIntegrations(prisma, workspaceId, toStageConfig(implStageForMcp).tools);
    eq(rwMounted.map((tool) => tool.name).sort(), ['MongoDB', 'Redis'], 'seeded RW MCP selections mount exactly');
    eq(rwMounted.find((tool) => tool.name === 'MongoDB')?.env?.MONGODB_URI, ENV_VARS.find((envVar) => envVar.id === 'env-mongo')?.value, 'seeded MCP runtime resolves the mapped Mongo EnvVar value');
  }

  //? Owner membership is roleKey 'owner' and bound to the real owner user.
  const ownerMember = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: owner.id } });
  assert(ownerMember !== null, 'owner has a WorkspaceMember row');
  eq(ownerMember?.roleKey, 'owner', "owner membership roleKey is 'owner'");

  //? The implementation stage: key 'impl' + kind 'code'.
  const implStage = await prisma.pipelineStage.findFirst({ where: { workspaceId, key: 'impl' } });
  assert(implStage !== null, "PipelineStage 'impl' exists");
  eq(implStage?.kind, 'code', "PipelineStage 'impl' has kind 'code'");
} finally {
  //? Best-effort cleanup — remove the workspace, all tenant rows, and demo/owner users.
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/seed.test.mts');
