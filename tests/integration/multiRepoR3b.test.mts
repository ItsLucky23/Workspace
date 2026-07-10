//? R3-b — the multi-repo acceptance test (the fix for "a 2nd repo in one workspace overwrites the 1st").
//? Two projects in ONE workspace each greenfield their own repo; the test proves BOTH survive with distinct
//? content, distinct worktrees, and that the legacy-layout boot migration relocates an old per-workspace repo
//? into the first project's slot. Real git + Mongo; no Docker.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';
import { initGreenfieldRepo, addWorktree, isLinked, branchHead, showRepoFile, workspaceDataDir, projectDataDir, migrateLegacyRepoLayout } from '../../server/git/repoStore.ts';
import { createBlankWorkspace } from '../../server/bootstrap/seedWorkspace.ts';

const prisma = await db();
const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `r3b-${String(stamp)}@youcomm.nl`, name: 'R3b' } });
let workspaceId: string | null = null;

const file = (content: string, name = 'app.txt') => [{ path: name, content }];

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'MultiRepo WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  //? Two projects in the SAME workspace.
  const projA = await prisma.project.create({ data: { workspaceId: wsId, name: 'API', gitlabPath: 'ws/api', stack: 'node' } });
  const projB = await prisma.project.create({ data: { workspaceId: wsId, name: 'Frontend', gitlabPath: 'ws/frontend', stack: 'node' } });

  //? Greenfield BOTH — pre-R3-b the 2nd initGreenfieldRepo no-op'd (bare already existed at the workspace path)
  //? so project B got NO repo. Now each lands under its own project slot.
  const a = await initGreenfieldRepo(wsId, projA.id, file('I am project A\n'));
  const b = await initGreenfieldRepo(wsId, projB.id, file('I am project B\n'));
  assert(a.linked && b.linked, 'BOTH projects produced a linked repo (2nd no longer clobbers/no-ops)');

  //? Both repos exist on disk, independently.
  assert(isLinked(wsId, projA.id) && isLinked(wsId, projB.id), 'both project repos are linked');
  assert(existsSync(path.join(projectDataDir(wsId, projA.id), 'repo.git')), 'project A repo.git is under its own slot');
  assert(existsSync(path.join(projectDataDir(wsId, projB.id), 'repo.git')), 'project B repo.git is under its own slot');

  //? Content is DISTINCT — the whole point: A did not overwrite B.
  const aContent = await showRepoFile(wsId, projA.id, 'main', 'app.txt');
  const bContent = await showRepoFile(wsId, projB.id, 'main', 'app.txt');
  eq(aContent.trim(), 'I am project A', 'project A keeps its own content');
  eq(bContent.trim(), 'I am project B', 'project B keeps its own content (NOT clobbered by A)');
  assert(aContent !== bContent, 'the two repos hold different code');

  //? Worktrees are cut from the correct project's repo.
  const wtA = await addWorktree(wsId, projA.id, 'DEV-1', 'DEV-1');
  const wtB = await addWorktree(wsId, projB.id, 'DEV-2', 'DEV-2');
  assert(wtA !== null && wtB !== null, 'a worktree cut from each project succeeds');
  assert((wtA?.path ?? '').includes(projA.id) && (wtB?.path ?? '').includes(projB.id), 'each worktree lives under its own project slot');
  const headA = await branchHead(wsId, projA.id, 'main');
  const headB = await branchHead(wsId, projB.id, 'main');
  assert(headA.length >= 7 && headB.length >= 7 && headA !== headB, 'each project has its own independent HEAD');

  //? Legacy-layout migration: simulate a pre-R3-b workspace-level repo, then migrate it into a fresh project.
  const projC = await prisma.project.create({ data: { workspaceId: wsId, name: 'Legacy', gitlabPath: 'ws/legacy', stack: 'node' } });
  const legacyBare = path.join(workspaceDataDir(wsId), 'repo.git');
  mkdirSync(legacyBare, { recursive: true });
  writeFileSync(path.join(legacyBare, 'MARKER'), 'legacy');
  const moved = migrateLegacyRepoLayout([{ workspaceId: wsId, projectId: projC.id }]);
  eq(moved, 1, 'the legacy per-workspace repo was migrated');
  assert(!existsSync(legacyBare), 'the legacy path is gone after migration');
  assert(existsSync(path.join(projectDataDir(wsId, projC.id), 'repo.git', 'MARKER')), 'the repo now lives in the project slot');
  eq(migrateLegacyRepoLayout([{ workspaceId: wsId, projectId: projC.id }]), 0, 'migration is idempotent (no legacy left)');

  //? RESILIENCE — a legacy repo that could NOT be migrated (e.g. Windows EPERM: a running container holds
  //? repo.git) must still WORK: a project with no own repo but a legacy per-workspace repo present falls back
  //? to the legacy path, so the workspace is never broken by a failed/pending migration.
  const projD = await prisma.project.create({ data: { workspaceId: wsId, name: 'Unmigrated', gitlabPath: 'ws/unmig', stack: 'node' } });
  const legacyBare2 = path.join(workspaceDataDir(wsId), 'repo.git');
  execFileSync('git', ['init', '--bare', '-q', legacyBare2]);
  assert(!existsSync(path.join(projectDataDir(wsId, projD.id), 'repo.git')), 'projD has no own repo (migration did not run)');
  assert(isLinked(wsId, projD.id), 'a project with only a legacy per-workspace repo still reports linked (fallback)');
  const h = await branchHead(wsId, projD.id, 'HEAD').catch(() => '');
  void h; // a bare-init repo has no commits; the point is isLinked resolves the legacy path without throwing
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) { await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined); try { rmSync(workspaceDataDir(workspaceId), { recursive: true, force: true }); } catch { /* best-effort */ } }
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/multiRepoR3b.test.mts');
