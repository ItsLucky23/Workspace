//? Integration test for FREEDOM_PROGRAM K3 — creative knowledge grounding. Verifies buildKnowledgeContext
//? folds ENABLED context-doc InfoSources (and excludes disabled ones), so a user's uploaded docs actually
//? steer creative text generation. Real Mongo.

import { db, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { buildKnowledgeContext } = await import('../../server/content/knowledgeContext');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `kc-${String(stamp)}@youcomm.nl`, name: 'KC' } });
const ws = await prisma.workspace.create({ data: { name: 'KC WS', slug: `kc-${String(stamp)}`, ownerId: owner.id } });
const wsId = ws.id;

try {
  eq(await buildKnowledgeContext(prisma, wsId), '', 'no enabled docs → empty grounding');

  await prisma.infoSource.create({ data: { workspaceId: wsId, mode: 'context-doc', source: 'uploaded', name: 'house.md', content: 'Always write in British English.', enabled: true, usedByStages: [] } });
  await prisma.infoSource.create({ data: { workspaceId: wsId, mode: 'context-doc', source: 'uploaded', name: 'disabled.md', content: 'THIS SHOULD NOT APPEAR', enabled: false, usedByStages: [] } });

  const ctx = await buildKnowledgeContext(prisma, wsId);
  assert(ctx.includes('British English'), 'an enabled doc is included in the grounding');
  assert(ctx.includes('house.md'), 'the doc name heads its block');
  assert(!ctx.includes('THIS SHOULD NOT APPEAR'), 'a disabled doc is excluded');
  assert(ctx.startsWith('Reference knowledge'), 'the grounding is labelled');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  await prisma.infoSource.deleteMany({ where: { workspaceId: wsId } }).catch(() => undefined);
  await prisma.workspace.deleteMany({ where: { id: wsId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: owner.id } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
}

report('tests/integration/knowledgeContext.test.mts');
