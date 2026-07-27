//? Integration test for A2 (GitHubForge, ADR 0036). Runs against the REAL Conductor + Mongo.
//? Asserts forge resolution is PER-PROJECT: a project with no ForgeConnection falls back to the
//? workspace GitLab default; a `forge-connect` op writes a GitHub ForgeConnection (token encrypted)
//? that `resolveForge` then returns (mode/base/repoPath/token); a sibling project in the SAME
//? workspace is unaffected (stays GitLab). Plus the pure GitHub issue mapper (PR filter + fields).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { resolveForge } = await import('../../server/git/forgeResolve');
const { mapGithubIssues } = await import('../../server/git/gitlabSync');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 4000, stepMs = 50): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    if (Date.now() >= deadline) return null;
    await wait(stepMs);
  }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `fc-test-${String(stamp)}@youcomm.nl`, name: 'FC Test' } });
let workspaceId: string | null = null;

try {
  // ---- pure GitHub issue mapper (no network) ------------------------------------
  const mapped = mapGithubIssues([
    { number: 7, title: 'A bug', body: 'desc', labels: [{ name: 'bug' }, { name: '' }], html_url: 'https://gh/7', state: 'open' },
    { number: 8, title: 'A PR', pull_request: { url: 'x' } },
  ]);
  eq(mapped.length, 1, 'mapGithubIssues filters out pull requests (issues only)');
  eq(mapped[0]?.iid, 7, 'mapGithubIssues maps number → iid');
  eq(mapped[0]?.labels, ['bug'], 'mapGithubIssues maps label names + drops blanks');
  eq(mapped[0]?.web_url, 'https://gh/7', 'mapGithubIssues maps html_url → web_url');

  // ---- workspace + project (GitLab default, no ForgeConnection) ------------------
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'FC Test WS' }, userId: owner.id, clientRequestId: `fc-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj1 = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  const proj1Id = proj1?.id ?? '';

  const fallback = await resolveForge(prisma, wsId, proj1Id);
  eq(fallback?.mode, 'gitlab', 'a project with no ForgeConnection falls back to the workspace GitLab default');

  // ---- forge-connect → GitHub ForgeConnection on proj1 --------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'forge-connect', target: { projectId: proj1Id }, payload: { mode: 'github', baseUrl: 'https://api.github.com', token: 'ghp_secrettoken123', repoPath: 'acme/frontend' }, userId: owner.id, clientRequestId: `fc-conn-${String(stamp)}` });
  const conn = await poll(() => prisma.forgeConnection.findFirst({ where: { projectId: proj1Id } }));
  assert(conn !== null, 'forge-connect writes a ForgeConnection for the project');
  eq(conn?.mode, 'github', 'the connection mode is github');
  assert((conn?.tokenEnc ?? '') !== 'ghp_secrettoken123' && (conn?.tokenEnc ?? '').length > 0, 'the token is stored ENCRYPTED (not plaintext)');

  const gh = await resolveForge(prisma, wsId, proj1Id);
  eq(gh?.mode, 'github', 'resolveForge now returns github for the connected project');
  eq(gh?.base, 'https://api.github.com', 'resolveForge returns the GitHub API base');
  eq(gh?.repoPath, 'acme/frontend', 'resolveForge returns the connection repoPath');
  eq(gh?.token, 'ghp_secrettoken123', 'resolveForge decrypts the token');

  const snapshot = await buildSnapshot(prisma, owner.id, wsId, proj1Id);
  const projectSummary = snapshot.projects.find((project) => project.id === proj1Id);
  eq(projectSummary?.forgeMode, 'github', 'the client snapshot exposes the per-project forge mode');
  eq(projectSummary?.forgeStatus, 'connected', 'the client snapshot exposes real forge connection state');
  eq(projectSummary?.forgeRepoPath, 'acme/frontend', 'the client snapshot exposes the non-secret forge repo identity');

  // ---- a sibling project in the SAME workspace is unaffected ---------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Backend' }, userId: owner.id, clientRequestId: `fc-p2-${String(stamp)}` });
  const proj2 = await poll(async () => { const rows = await prisma.project.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: 'asc' } }); return rows.length === 2 ? rows[1] : null; });
  const sibling = await resolveForge(prisma, wsId, proj2?.id ?? '');
  eq(sibling?.mode, 'gitlab', 'a sibling project WITHOUT a ForgeConnection stays on the workspace GitLab default (GitHub connect did not leak)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) {
    await prisma.forgeConnection.deleteMany({ where: { workspaceId } }).catch(() => undefined);
    await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  } else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/forgeConnect.test.mts');
