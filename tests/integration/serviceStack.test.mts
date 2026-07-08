//? K1-b — provisioning a service stack through the REAL persistence path (Mongo) with an INJECTED docker runner
//? (no daemon). Verifies: a clean compose is sanitized + persisted as a ServiceStack (namespaced compose up
//? called), a DANGEROUS compose is rejected with violations + NEVER touches Docker + persists no row, and
//? teardown removes the row + calls `compose down`. Cleans up its own data.

import { existsSync, rmSync } from 'node:fs';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { provisionServiceStack, teardownServiceStack } = await import('../../server/container/composeEngine');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { workspaceDataDir } = await import('../../server/git/repoStore');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `svc-${String(stamp)}@youcomm.nl`, name: 'Svc' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Svc WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  // 1) a clean compose → sanitized + persisted + docker compose up called (namespaced project).
  let upArgs: string[] = [];
  const cleanCompose = 'services:\n  db:\n    image: postgres:16\n    ports:\n      - "5432:5432"\n';
  const ok = await provisionServiceStack(prisma, wsId, 'data', cleanCompose, {
    run: async (a) => { if (a.includes('up')) upArgs = a; return { code: 0, out: '', err: '' }; },
  });
  assert(ok.ok, 'a clean compose provisions');
  assert(ok.services?.includes('db'), 'the db service is recorded');
  const row = await prisma.serviceStack.findFirst({ where: { workspaceId: wsId, name: 'data' } });
  assert(row !== null, 'the ServiceStack row is persisted');
  eq(row?.status, 'running', 'the stack is running after a successful up');
  assert(!(row?.compose ?? '').includes('5432:5432'), 'the persisted compose has the host port stripped (sanitized)');
  assert((row?.compose ?? '').includes('ws-') && (row?.compose ?? '').includes('external: true'), 'the per-workspace network is baked into the stored compose');
  assert(upArgs.join(' ').includes(`-p ws-`), 'docker compose up ran under the namespaced project');

  // 2) a DANGEROUS compose → rejected, NO docker, NO row.
  let dockerCalled = false;
  const bad = await provisionServiceStack(prisma, wsId, 'evil', 'services:\n  x:\n    image: a\n    privileged: true\n', {
    run: async () => { dockerCalled = true; return { code: 0, out: '', err: '' }; },
  });
  assert(!bad.ok && (bad.violations ?? []).length > 0, 'a dangerous compose is rejected with violations');
  assert(!dockerCalled, 'a rejected compose NEVER touches Docker');
  eq(await prisma.serviceStack.findFirst({ where: { workspaceId: wsId, name: 'evil' } }), null, 'a rejected compose persists no row');

  // 3) teardown → row removed + compose down called.
  let downCalled = false;
  await teardownServiceStack(prisma, wsId, 'data', { run: async (a) => { if (a.includes('down')) downCalled = true; return { code: 0, out: '', err: '' }; } });
  assert(downCalled, 'teardown calls docker compose down');
  eq(await prisma.serviceStack.findFirst({ where: { workspaceId: wsId, name: 'data' } }), null, 'teardown removes the row');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) { rmSync(workspaceDataDir(workspaceId), { recursive: true, force: true }); await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined); }
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  if (existsSync('data/workspaces')) { /* leave other workspaces' dirs */ }
}

report('tests/integration/serviceStack.test.mts');
