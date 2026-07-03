//? Integration test for the forge-provider abstraction + webhook ingest (#10): the pure per-provider
//? REST-request SHAPING (GitLab vs GitHub open/find MR, url parse, duplicate status) and the real
//? webhook-driven ingest against Mongo (a normalized issue event upserts the DEV-<iid> ticket).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const fp = await import('../../server/git/forgeProvider');
const wi = await import('../../server/git/webhookIngest');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `forge-${String(stamp)}@youcomm.nl`, name: 'Forge Owner' } });
let workspaceId: string | null = null;

try {
  const input = { base: 'https://gl.example.com/', path: 'grp/proj', token: 'tok', source: 'DEV-7', target: 'main', title: 'Fix' };

  // ---- open-MR request shaping (pure) ----
  const gl = fp.buildOpenMrRequest('gitlab', input);
  assert(gl.url === 'https://gl.example.com/api/v4/projects/grp%2Fproj/merge_requests', 'gitlab open-MR url uses /api/v4 + encoded path');
  eq(gl.headers['PRIVATE-TOKEN'], 'tok', 'gitlab uses PRIVATE-TOKEN header (token off the url)');
  assert((gl.body ?? '').includes('"source_branch":"DEV-7"'), 'gitlab body uses source_branch');

  const gh = fp.buildOpenMrRequest('github', { ...input, base: 'https://api.github.com', path: 'octo/repo' });
  eq(gh.url, 'https://api.github.com/repos/octo/repo/pulls', 'github open-PR url uses /repos/{owner}/{repo}/pulls');
  eq(gh.headers.Authorization, 'Bearer tok', 'github uses a Bearer token');
  assert((gh.body ?? '').includes('"head":"DEV-7"') && (gh.body ?? '').includes('"base":"main"'), 'github body uses head/base');

  // ---- find-existing request shaping (pure) ----
  const ghFind = fp.buildFindMrRequest('github', { ...input, base: 'https://api.github.com', path: 'octo/repo' });
  assert(ghFind.url.includes('head=octo%3ADEV-7') && ghFind.url.includes('state=open'), 'github find-PR filters by head=owner:branch');
  const glFind = fp.buildFindMrRequest('gitlab', input);
  assert(glFind.url.includes('source_branch=DEV-7') && glFind.url.includes('state=opened'), 'gitlab find-MR filters by source_branch');

  // ---- url parsing + duplicate status (pure) ----
  eq(fp.readMrUrl('github', { html_url: 'https://gh/pr/1' }), 'https://gh/pr/1', 'github url = html_url (object)');
  eq(fp.readMrUrl('gitlab', [{ web_url: 'https://gl/mr/2' }]), 'https://gl/mr/2', 'gitlab url = web_url (array)');
  eq(fp.readMrUrl('github', []), null, 'empty list → null');
  eq(fp.isDuplicateStatus('gitlab', 409), true, 'gitlab duplicate = 409');
  eq(fp.isDuplicateStatus('github', 422), true, 'github duplicate = 422');
  eq(fp.isDuplicateStatus('github', 409), false, 'github does not treat 409 as duplicate');

  // ---- webhook parse (pure) ----
  const glIssue = wi.parseWebhookEvent({ object_kind: 'issue', object_attributes: { iid: 42, title: 'GL issue', description: 'body', action: 'open', state: 'opened', url: 'https://gl/i/42' }, labels: [{ title: 'bug' }] });
  eq(glIssue.kind, 'issue', 'gitlab issue webhook parses as an issue');
  eq(glIssue.iid, 42, 'gitlab iid extracted');
  eq(glIssue.action, 'open', 'gitlab action normalized');
  eq(glIssue.labels.join(','), 'bug', 'gitlab labels extracted from {title}');

  const ghIssue = wi.parseWebhookEvent({ action: 'opened', issue: { number: 99, title: 'GH issue', body: 'b', state: 'open', html_url: 'https://gh/i/99', labels: [{ name: 'feature' }] } }, 'issues');
  eq(ghIssue.iid, 99, 'github issue number extracted');
  eq(ghIssue.labels.join(','), 'feature', 'github labels extracted from {name}');
  eq(wi.parseWebhookEvent({ ref: 'refs/heads/main' }, 'push').kind, 'ignored', 'a github push event is ignored');
  eq(wi.parseWebhookEvent({ object_kind: 'push' }).kind, 'ignored', 'a gitlab push event is ignored');

  // ---- real ingest (Mongo): create then update ----
  const created = await createBlankWorkspace(prisma, owner.id, 'Forge WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  const key1 = await wi.ingestIssueEvent(prisma, wsId, wi.parseWebhookEvent({ object_kind: 'issue', object_attributes: { iid: 1234, title: 'First', action: 'open', state: 'opened' } }));
  eq(key1, 'DEV-1234', 'ingest created a DEV-<iid> ticket');
  const t1 = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key: 'DEV-1234' } });
  assert(t1 !== null && t1.title === 'First', 'the ingested ticket has the issue title');

  await wi.ingestIssueEvent(prisma, wsId, wi.parseWebhookEvent({ object_kind: 'issue', object_attributes: { iid: 1234, title: 'First (edited)', action: 'update', state: 'opened' } }));
  const t2 = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key: 'DEV-1234' } });
  eq(t2?.title ?? '', 'First (edited)', 'a second webhook UPDATES the same ticket (idempotent upsert)');
  eq(await prisma.ticket.count({ where: { workspaceId: wsId, key: 'DEV-1234' } }), 1, 'no duplicate ticket created');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/forge.test.mts');
