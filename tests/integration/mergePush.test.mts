//? Integration test for C1 — a server-side merge/rollback PUSHES the target to origin. Sets up a
//? real BARE origin repo, a workspace bare clone off it, a project pointing at origin + a forge
//? token, then merges an MR and asserts (a) origin's target ref actually advanced to the merged
//? sha, and (b) a local-only project (no gitUrl) is a no-op SKIP, not a push error.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { workspaceDataDir, bareMirrorPathFor, pushRef } = await import('../../server/git/repoStore');
const { pushMergedTarget } = await import('../../server/git/forge');
const { mergeMr, approveMr } = await import('../../server/mr/service');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { encryptSecret } = await import('../../server/crypto/secretBox');

const g = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `push-${String(stamp)}@youcomm.nl`, name: 'Push Owner' } });
let workspaceId: string | null = null;
let dataDir: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Push WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  dataDir = workspaceDataDir(wsId);
  //? R3-b — the bare repo is per-(workspace,project). Resolve the seeded project up front so the bare clone
  //? lands where pushRef/mergeMr look for it (`bareMirrorPathFor`), and pass projectId through.
  const project = await prisma.project.findFirst({ where: { workspaceId: wsId } });
  const projectId = project?.id ?? '';
  const srcDir = path.join(dataDir, '_src');
  const originBare = path.join(dataDir, 'origin.git');
  const bareDir = bareMirrorPathFor(wsId, projectId);
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(path.dirname(bareDir), { recursive: true });

  //? Source repo: main(base) + feature adds b.txt (a clean merge that advances main).
  g(srcDir, 'init', '-q', '-b', 'main');
  g(srcDir, 'config', 'user.email', 't@t.local');
  g(srcDir, 'config', 'user.name', 'T');
  writeFileSync(path.join(srcDir, 'a.txt'), 'base\n');
  g(srcDir, 'add', '-A'); g(srcDir, 'commit', '-q', '-m', 'base');
  g(srcDir, 'checkout', '-q', '-b', 'feature');
  writeFileSync(path.join(srcDir, 'b.txt'), 'feature\n');
  g(srcDir, 'add', '-A'); g(srcDir, 'commit', '-q', '-m', 'add b');
  g(srcDir, 'checkout', '-q', 'main');
  //? origin = a BARE repo (safe to push to); the workspace bare clone is cut FROM origin so its
  //? `origin` remote points at it — mirrors a real linked repo.
  g(dataDir, 'clone', '-q', '--bare', srcDir, originBare);
  g(dataDir, 'clone', '-q', '--bare', originBare, bareDir);

  const originMainBefore = g(originBare, 'rev-parse', 'main');

  //? Point the workspace's project at origin + give it a forge token (so pushMergedTarget resolves
  //? a push target). gitUrl is a local path — withAuth leaves non-https URLs untouched.
  await prisma.project.update({ where: { id: projectId }, data: { gitUrl: originBare } });
  await prisma.workspace.update({ where: { id: wsId }, data: { forgeType: 'gitlab', gitlabUrl: 'https://gitlab.example', gitlabTokenEnc: encryptSecret('test-token') } });

  //? 1) pushRef directly: advance main locally by fast-forwarding to feature, then push to origin.
  g(bareDir, 'branch', '-f', 'main', 'feature');
  const bareMain = g(bareDir, 'rev-parse', 'main');
  await pushRef({ workspaceId: wsId, projectId, gitUrl: originBare, token: 'test-token', ref: 'main' });
  eq(g(originBare, 'rev-parse', 'main'), bareMain, 'pushRef advanced origin/main to the local tip');
  assert(g(originBare, 'rev-parse', 'main') !== originMainBefore, 'origin/main actually moved');

  //? Reset both bares to base so the mergeMr path is a genuine advance again.
  const base = g(srcDir, 'rev-parse', 'main');
  g(bareDir, 'branch', '-f', 'main', base);
  g(originBare, 'branch', '-f', 'main', base);

  //? 2) mergeMr end-to-end pushes to origin. Ticket on feature + an MR targeting main, approved.
  const ticket = await prisma.ticket.create({ data: { workspaceId: wsId, projectId, key: 'DEV-9100', number: 9100, title: 'Push me', stageId: 'unrefined', status: 'idle', labels: [], branch: 'feature', priority: 'normal' } });
  const featureHead = g(bareDir, 'rev-parse', 'feature');
  const mr = await prisma.mergeRequest.create({ data: { workspaceId: wsId, projectId, ticketId: ticket.id, number: 1, title: 'Push me', sourceBranch: 'feature', targetBranch: 'main', status: 'open', headSha: featureHead, mergeStrategy: 'merge' } });
  await approveMr(prisma, wsId, mr.id, owner.id);
  const merged = await mergeMr(prisma, wsId, mr.id);
  assert(merged.ok, 'mergeMr succeeds');
  assert(merged.ok && merged.pushed === true, 'mergeMr reports pushed=true');
  const mergedSha = merged.ok ? merged.sha ?? '' : '';
  eq(g(originBare, 'rev-parse', 'main'), mergedSha, "origin/main IS the merge commit — the forge received the merge");

  //? 3) A local-only project (no gitUrl) is a SKIP, never a push error.
  await prisma.project.update({ where: { id: projectId }, data: { gitUrl: null } });
  const skip = await pushMergedTarget(prisma, wsId, ticket.id, 'main');
  assert(!skip.pushed && skip.skipped === true && skip.error === undefined, 'no gitUrl → skipped (not an error)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
  if (dataDir) { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
}

report('tests/integration/mergePush.test.mts');
