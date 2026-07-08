//? G1 — greenfield real repo generation, end-to-end against REAL git + Mongo. Runs the actual
//? `project-from-template` control-op through the Conductor and asserts the workspace bare repo now exists
//? (`isLinked` true), has a `main` commit, and that commit carries the template's seed file-tree — so the
//? runtime can cut a worktree + container from it (container → code). Cleans up its data + the on-disk repo.

import { rmSync } from 'node:fs';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { isLinked, branchHead, showRepoFile, listRepoFiles, workspaceDataDir } = await import('../../server/git/repoStore');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 10000, stepMs = 80): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `gf-${String(stamp)}@youcomm.nl`, name: 'GF' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'GF WS' }, userId: owner.id, clientRequestId: `gf-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';

  //? The greenfield op — a fresh Node API project from the template (no external forge).
  await enqueueControlAction({ workspaceId: wsId, op: 'project-from-template', target: {}, payload: { name: 'My Greenfield API', template: 'node-api' }, userId: owner.id, clientRequestId: `gf-t-${String(stamp)}` });
  const project = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, name: 'My Greenfield API' } }));
  assert(project !== null, 'the greenfield project row was created');

  //? The workspace now has a REAL repo with a main commit (this is what flips isLinked → container → code).
  const linked = await poll(() => Promise.resolve(isLinked(wsId) ? true : null));
  assert(linked === true, 'the workspace bare repo exists (isLinked)');
  const head = await poll(() => branchHead(wsId, 'main').then((h) => (h.length > 0 ? h : null)));
  assert((head ?? '').length >= 7, 'main has a real commit hash');
  eq(project?.gitUrl ?? '', `greenfield://${wsId}`, 'the project is marked linked to the greenfield repo');

  //? The seed file-tree is actually committed on main.
  const pkg = await showRepoFile(wsId, 'main', 'package.json');
  assert(pkg.includes('node-api'), 'package.json from the template is committed');
  const entry = await showRepoFile(wsId, 'main', 'src/index.js');
  assert(entry.includes('createServer'), 'the entry file (src/index.js) is committed + runnable');
  const files = await listRepoFiles(wsId, 'main');
  assert(files.some((f) => f.path === 'package.json'), 'listRepoFiles sees the seed tree');
  console.log(`[gf] ✓ greenfield repo @ ${(head ?? '').slice(0, 8)} with ${String(files.length)} indexed file(s)`);
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
} finally {
  const wsId = workspaceId;
  if (wsId) { await cleanupWorkspace(prisma, wsId, [owner.id]); rmSync(workspaceDataDir(wsId), { recursive: true, force: true }); }
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => null);
}

report('tests/integration/greenfield.test.mts');
