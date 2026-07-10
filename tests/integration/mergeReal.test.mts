//? Integration test for the REAL git-merge (#9) against a real bare repo + Mongo. Sets up a
//? bare clone (main / feature / conflictA branches) in a throwaway test workspace, then exercises
//? mergeBranches (clean merge advances the target), revertMergeCommit (history-preserving rollback),
//? a genuine merge conflict (target untouched + files reported), and the mergeMr approval GATE
//? (≥1 non-stale approval required — the "MERGE VEREIST ≥1 approval" invariant).

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { mergeBranches, revertMergeCommit, workspaceDataDir, projectDataDir } = await import('../../server/git/repoStore');
const { mergeMr, approveMr } = await import('../../server/mr/service');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const g = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `merge-${String(stamp)}@youcomm.nl`, name: 'Merge Owner' } });
let workspaceId: string | null = null;
let dataDir: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Merge WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  //? R3-b — the merge functions read the per-PROJECT bare repo; seed it in the first project's slot.
  const projRow = await prisma.project.findFirst({ where: { workspaceId: wsId }, select: { id: true } });
  const projId = projRow?.id ?? 'proj-merge-test';
  dataDir = workspaceDataDir(wsId);
  const projDir = projectDataDir(wsId, projId);
  const srcDir = path.join(dataDir, '_src');
  const bareDir = path.join(projDir, 'repo.git');
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(projDir, { recursive: true });

  //? Build a source repo: main(a=base) → feature adds b.txt (clean) ; conflictA edits a.txt from
  //? base ; main edits a.txt to a different value (so conflictA↔main conflict on a.txt).
  g(srcDir, 'init', '-q', '-b', 'main');
  g(srcDir, 'config', 'user.email', 't@t.local');
  g(srcDir, 'config', 'user.name', 'T');
  writeFileSync(path.join(srcDir, 'a.txt'), 'base\n');
  g(srcDir, 'add', '-A'); g(srcDir, 'commit', '-q', '-m', 'base');
  g(srcDir, 'checkout', '-q', '-b', 'feature');
  writeFileSync(path.join(srcDir, 'b.txt'), 'feature file\n');
  g(srcDir, 'add', '-A'); g(srcDir, 'commit', '-q', '-m', 'add b');
  g(srcDir, 'checkout', '-q', '-b', 'conflictA', 'main');
  writeFileSync(path.join(srcDir, 'a.txt'), 'AAA\n');
  g(srcDir, 'add', '-A'); g(srcDir, 'commit', '-q', '-m', 'a=AAA');
  g(srcDir, 'checkout', '-q', 'main');
  writeFileSync(path.join(srcDir, 'a.txt'), 'BBB\n');
  g(srcDir, 'add', '-A'); g(srcDir, 'commit', '-q', '-m', 'a=BBB');
  //? An INDEPENDENT branch for the mergeMr-gate test (never merged/reverted, so it's not already an
  //? ancestor of main — its merge really advances main + lands c.txt).
  g(srcDir, 'checkout', '-q', '-b', 'feature2', 'main');
  writeFileSync(path.join(srcDir, 'c.txt'), 'gate file\n');
  g(srcDir, 'add', '-A'); g(srcDir, 'commit', '-q', '-m', 'add c');
  g(srcDir, 'checkout', '-q', 'main');
  //? Bare clone = the per-workspace baseline the merge functions operate on.
  g(dataDir, 'clone', '-q', '--bare', srcDir, bareDir);

  const mainBefore = g(bareDir, 'rev-parse', 'main');

  //? 1) Clean merge feature → main (feature only adds b.txt; a.txt differs but on main only).
  const merge = await mergeBranches(wsId, projId, 'main', 'feature', 'merge');
  assert(merge.ok, 'clean merge of feature into main succeeds');
  const mainAfter = g(bareDir, 'rev-parse', 'main');
  assert(mainAfter !== mainBefore, 'main advanced after the merge');
  const tree = g(bareDir, 'ls-tree', '-r', '--name-only', 'main');
  assert(tree.includes('b.txt'), "the merged branch's file is now on main");
  const mergeSha = merge.ok ? merge.sha : '';

  //? 2) Rollback via git-revert — b.txt disappears again, history preserved (main advances further).
  const revert = await revertMergeCommit(wsId, projId, 'main', mergeSha);
  assert(revert.ok, 'revert of the merge commit succeeds');
  const treeAfterRevert = g(bareDir, 'ls-tree', '-r', '--name-only', 'main');
  assert(!treeAfterRevert.includes('b.txt'), 'the reverted merge removed b.txt from main again');

  //? 3) Real conflict: conflictA (a=AAA) vs main (a=BBB) — merge is aborted, main untouched.
  const mainPreConflict = g(bareDir, 'rev-parse', 'main');
  const conflict = await mergeBranches(wsId, projId, 'main', 'conflictA', 'merge');
  assert(!conflict.ok && conflict.ok === false && 'conflict' in conflict && conflict.conflict, 'a real conflict is reported, not a silent bad merge');
  const files = !conflict.ok && 'files' in conflict ? conflict.files : [];
  assert(files.includes('a.txt'), 'the conflicting file (a.txt) is reported');
  eq(g(bareDir, 'rev-parse', 'main'), mainPreConflict, 'main is UNTOUCHED after an aborted conflict merge');

  //? 4) mergeMr approval GATE. Create a ticket on `feature` + an MR row targeting main.
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const ticket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', key: 'DEV-9001', number: 9001, title: 'Merge me', stageId: 'unrefined', status: 'idle', labels: [], branch: 'feature2', priority: 'normal' } });
  const featureHead = g(bareDir, 'rev-parse', 'feature2');
  const mr = await prisma.mergeRequest.create({ data: { workspaceId: wsId, projectId: project?.id ?? '', ticketId: ticket.id, number: 1, title: 'Merge me', sourceBranch: 'feature2', targetBranch: 'main', status: 'open', headSha: featureHead, mergeStrategy: 'merge' } });

  const noApproval = await mergeMr(prisma, wsId, mr.id);
  assert(!noApproval.ok && noApproval.reason === 'no-approval', 'merge is BLOCKED without an approval (the ≥1-approval gate)');
  eq((await prisma.mergeRequest.findUnique({ where: { id: mr.id } }))?.status ?? '', 'open', 'the MR stays open when the merge is gated');

  //? Approve at the current head, then merge for real. (main was reverted earlier, so git correctly
  //? treats feature's b.txt as already-accounted-for — the proof of a real merge is that main
  //? advances to a new merge commit whose sha is recorded, not b.txt's presence.)
  const mainPreMerge = g(bareDir, 'rev-parse', 'main');
  await approveMr(prisma, wsId, mr.id, owner.id);
  const withApproval = await mergeMr(prisma, wsId, mr.id);
  assert(withApproval.ok, 'with a fresh approval the merge goes through');
  eq((await prisma.mergeRequest.findUnique({ where: { id: mr.id } }))?.status ?? '', 'merged', 'the MR is now merged');
  const merged = await prisma.mergeRequest.findUnique({ where: { id: mr.id } });
  assert((merged?.mergedSha ?? '').length > 0, 'the merge commit sha is recorded for rollback');
  assert(g(bareDir, 'rev-parse', 'main') !== mainPreMerge, 'the real merge advanced main to a new commit');
  eq(g(bareDir, 'rev-parse', 'main'), merged?.mergedSha ?? '', "main's tip IS the recorded merge commit");
  assert(g(bareDir, 'ls-tree', '-r', '--name-only', 'main').includes('c.txt'), "the merged branch's file (c.txt) landed on main");
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  if (dataDir) { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
}

report('tests/integration/mergeReal.test.mts');
