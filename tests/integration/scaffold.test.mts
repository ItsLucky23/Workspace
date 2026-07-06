//? Integration test for F1 (greenfield scaffolding, ADR 0046). Runs against the REAL Conductor + Mongo.
//? Asserts the curated template catalog (pure) and that project-from-template scaffolds a fresh project:
//? the template's dev command, its starter convention docs (as InfoSources), and its own default pipeline.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { listTemplates, getTemplate } = await import('../../server/scaffold/templates');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure catalog ---------------------------------------------------------------------------------
assert(listTemplates().length >= 3, 'the catalog exposes the curated templates');
assert(listTemplates().every((t) => t.key.length > 0 && t.label.length > 0), 'each template has a key + label');
assert(getTemplate('react-vite')?.devCommand.includes('--host 0.0.0.0') === true, 'getTemplate returns the full template with its dev command');
eq(getTemplate('does-not-exist'), null, 'getTemplate is null for an unknown key');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `sc-test-${String(stamp)}@youcomm.nl`, name: 'SC Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'SC Test WS' }, userId: owner.id, clientRequestId: `sc-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));   // wait for the seed project

  // ---- project-from-template scaffolds a fresh project -------------------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'project-from-template', target: {}, payload: { name: 'Frontend', template: 'react-vite' }, userId: owner.id, clientRequestId: `sc-pt-${String(stamp)}` });
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, name: 'Frontend' } }));
  assert(proj !== null, 'project-from-template creates the project');
  assert((proj?.devCommand ?? '').includes('--host 0.0.0.0'), 'the project gets the template dev command');

  const starterDocs = await prisma.infoSource.findMany({ where: { workspaceId: wsId, projectId: proj?.id ?? '', source: 'starter' } });
  assert(starterDocs.length >= 1 && starterDocs.some((d) => d.name === 'CONVENTIONS.md'), 'the template starter convention docs are seeded as InfoSources');

  const stages = await prisma.pipelineStage.findMany({ where: { workspaceId: wsId, projectId: proj?.id ?? '' } });
  assert(stages.some((s) => s.key === 'unrefined'), 'the scaffolded project gets its own default pipeline');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/scaffold.test.mts');
