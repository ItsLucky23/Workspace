//? H4 — workspace data export through Mongo. Verifies the bundle assembles the workspace's own data (tickets,
//? pipeline, sources, content, members) and that SECRETS ARE EXCLUDED — env var VALUES never appear, only KEYS.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { buildWorkspaceExport } = await import('../../server/export/workspaceExport');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ex-${String(stamp)}@youcomm.nl`, name: 'Exporter' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Export WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const dev = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  await prisma.ticket.create({ data: { workspaceId: wsId, projectId: dev?.id ?? '', key: 'DEV-5', number: 5, title: 'Exportable ticket', stageId: 'unrefined', status: 'idle', labels: [] } });
  await prisma.infoSource.create({ data: { workspaceId: wsId, projectId: dev?.id ?? '', mode: 'context-doc', source: 'uploaded', name: 'Spec doc', content: 'x', enabled: true } });
  await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: dev?.id ?? '', title: 'Exportable content' } });
  await prisma.envVar.create({ data: { workspaceId: wsId, key: 'STRIPE_KEY', value: 'sk_live_TOPSECRET', secret: true } });

  const bundle = await buildWorkspaceExport(prisma, wsId, 1_700_000_000_000);
  assert(bundle !== null, 'the export bundle was built');
  eq(bundle?.workspace.name, 'Export WS', 'the workspace meta is included');
  assert((bundle?.tickets ?? []).some((t) => t.key === 'DEV-5'), 'tickets are exported');
  assert((bundle?.pipeline ?? []).length >= 4, 'the pipeline stages are exported');
  assert((bundle?.knowledgeSources ?? []).some((s) => s.name === 'Spec doc'), 'knowledge sources are exported');
  assert((bundle?.content ?? []).some((c) => c.title === 'Exportable content'), 'content pieces are exported');
  assert((bundle?.members ?? []).some((m) => m.name === 'Exporter'), 'members (with names) are exported');
  eq(bundle?.exportedAt, '2023-11-14T22:13:20.000Z', 'the injected timestamp is used (deterministic)');

  //? The env KEY is listed; the secret VALUE is NOWHERE in the bundle.
  assert((bundle?.envKeys ?? []).includes('STRIPE_KEY'), 'env KEYS are listed (so the operator can re-provision)');
  assert(!JSON.stringify(bundle).includes('sk_live_TOPSECRET'), 'the secret VALUE is NOT in the export');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/workspaceExport.test.mts');
