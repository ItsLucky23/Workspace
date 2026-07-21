/// <reference types="node" />

//? Operator entry point for Mongo data backfills. Prints the pre/post row counts needed to verify a
//? destructive-looking consolidation instead of relying only on the SchemaVersion watermark.

import { getPrismaClient, loadEnvFiles, tryCatch } from '@luckystack/core';

async function run(): Promise<void> {
  loadEnvFiles();
  const projectConfig = (await import('../config')).default;
  if (projectConfig.secretManager?.url) {
    const secretManager = await import('@luckystack/secret-manager');
    await secretManager.initSecretManager({ ...projectConfig.secretManager, source: 'remote' });
  }
  const prisma = getPrismaClient();
  const before = {
    legacyInfoSourceSkills: await prisma.infoSource.count({ where: { mode: 'skill' } }),
    capabilitySkills: await prisma.skill.count({ where: { skillType: 'capability' } }),
    instructionSkills: await prisma.skill.count({ where: { OR: [{ skillType: 'instruction' }, { skillType: { equals: undefined } }] } }),
  };
  const { runSchemaUpgrade } = await import('../server/db/schemaVersion');
  const outcome = await runSchemaUpgrade(prisma);
  const after = {
    legacyInfoSourceSkills: await prisma.infoSource.count({ where: { mode: 'skill' } }),
    capabilitySkills: await prisma.skill.count({ where: { skillType: 'capability' } }),
    instructionSkills: await prisma.skill.count({ where: { skillType: 'instruction' } }),
    migratedLinks: await prisma.skill.count({ where: { legacyInfoSourceId: { not: null } } }),
  };
  const expectedCapabilities = before.capabilitySkills + before.legacyInfoSourceSkills;
  const verified = outcome.failed === undefined
    && after.legacyInfoSourceSkills === 0
    && after.capabilitySkills === expectedCapabilities
    && after.migratedLinks >= before.legacyInfoSourceSkills;
  await prisma.$disconnect();
  console.log(JSON.stringify({ verified, before, outcome, after }, null, 2));
  process.exit(verified ? 0 : 1);
}

const [error] = await tryCatch(run);
if (error) {
  console.error(`[schema-upgrade] ${error.message}`);
  process.exit(1);
}
