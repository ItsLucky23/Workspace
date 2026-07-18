//? Forge-provider request shaping + normalized webhook parsing. Real issue mutations
//? enter through the server-only Conductor action; tests never call a DB mutator directly.

import { tryCatch } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const fp = await import('../../server/git/forgeProvider');
const wi = await import('../../server/git/webhookIngest');
const { forgeTouchedKeys } = await import('../../server/git/gitlabSync');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `forge-${String(stamp)}@youcomm.nl`, name: 'Forge Owner' } });
let workspaceId = '';

const [runError] = await tryCatch(async () => {
  const input = { base: 'https://gl.example.com/', path: 'grp/proj', token: 'tok', source: 'DEV-7', target: 'main', title: 'Fix' };

  const gl = fp.buildOpenMrRequest('gitlab', input);
  assert(gl.url === 'https://gl.example.com/api/v4/projects/grp%2Fproj/merge_requests', 'gitlab open-MR url uses /api/v4 + encoded path');
  eq(gl.headers['PRIVATE-TOKEN'], 'tok', 'gitlab uses PRIVATE-TOKEN header (token off the url)');
  assert((gl.body ?? '').includes('"source_branch":"DEV-7"'), 'gitlab body uses source_branch');

  const gh = fp.buildOpenMrRequest('github', { ...input, base: 'https://api.github.com', path: 'octo/repo' });
  eq(gh.url, 'https://api.github.com/repos/octo/repo/pulls', 'github open-PR url uses /repos/{owner}/{repo}/pulls');
  eq(gh.headers.Authorization, 'Bearer tok', 'github uses a Bearer token');
  assert((gh.body ?? '').includes('"head":"DEV-7"') && (gh.body ?? '').includes('"base":"main"'), 'github body uses head/base');

  const ghFind = fp.buildFindMrRequest('github', { ...input, base: 'https://api.github.com', path: 'octo/repo' });
  assert(ghFind.url.includes('head=octo%3ADEV-7') && ghFind.url.includes('state=open'), 'github find-PR filters by head=owner:branch');
  const glFind = fp.buildFindMrRequest('gitlab', input);
  assert(glFind.url.includes('source_branch=DEV-7') && glFind.url.includes('state=opened'), 'gitlab find-MR filters by source_branch');

  eq(fp.readMrUrl('github', { html_url: 'https://gh/pr/1' }), 'https://gh/pr/1', 'github url = html_url (object)');
  eq(fp.readMrUrl('gitlab', [{ web_url: 'https://gl/mr/2' }]), 'https://gl/mr/2', 'gitlab url = web_url (array)');
  eq(fp.readMrUrl('github', []), null, 'empty list → null');
  eq(fp.isDuplicateStatus('gitlab', 409), true, 'gitlab duplicate = 409');
  eq(fp.isDuplicateStatus('github', 422), true, 'github duplicate = 422');
  eq(fp.isDuplicateStatus('github', 409), false, 'github does not treat 409 as duplicate');

  const glIssue = wi.parseWebhookEvent({
    object_kind: 'issue',
    project: { path_with_namespace: 'forge/test' },
    object_attributes: { iid: 42, title: 'GL issue', description: 'body', action: 'open', state: 'opened', url: 'https://gl/i/42' },
    labels: [{ title: 'bug' }],
  });
  eq(glIssue.kind, 'issue', 'gitlab issue webhook parses as an issue');
  eq(glIssue.iid, 42, 'gitlab iid extracted');
  eq(glIssue.action, 'open', 'gitlab action normalized');
  eq(glIssue.labels.join(','), 'bug', 'gitlab labels extracted from {title}');

  const ghIssue = wi.parseWebhookEvent({
    action: 'opened',
    repository: { full_name: 'octo/repo' },
    issue: { number: 99, title: 'GH issue', body: 'b', state: 'open', html_url: 'https://gh/i/99', labels: [{ name: 'feature' }] },
  }, 'issues');
  eq(ghIssue.iid, 99, 'github issue number extracted');
  eq(ghIssue.labels.join(','), 'feature', 'github labels extracted from {name}');
  eq(wi.parseWebhookEvent({ ref: 'refs/heads/main' }, 'push').kind, 'ignored', 'a github push event is ignored');
  eq(wi.parseWebhookEvent({ object_kind: 'push' }).kind, 'ignored', 'a gitlab push event is ignored');

  const created = await createBlankWorkspace(prisma, owner.id, 'Forge WS');
  workspaceId = created.workspaceId;
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  assert(project !== null, 'the workspace has a project');
  if (!project) return;
  await prisma.project.update({ where: { id: project.id }, data: { gitlabPath: 'forge/test' } });

  const first = await enqueueInternalAction({
    workspaceId,
    op: 'forge-event-apply',
    target: {},
    payload: { event: glIssue, acceptedAt: Date.now() },
    userId: 'forge-test',
    clientRequestId: `forge-create-${String(stamp)}`,
  });
  eq(forgeTouchedKeys(first.result), ['DEV-42'], 'the writer result returns the touched key');
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-42' } });
  assert(ticket !== null && ticket.title === 'GL issue', 'the Conductor-created ticket has the issue title');

  const edited = wi.parseWebhookEvent({
    object_kind: 'issue',
    project: { path_with_namespace: 'forge/test' },
    object_attributes: { iid: 42, title: 'GL issue edited', action: 'update', state: 'opened' },
  });
  await enqueueInternalAction({
    workspaceId,
    op: 'forge-event-apply',
    target: {},
    payload: { event: edited, acceptedAt: Date.now() },
    userId: 'forge-test',
    clientRequestId: `forge-update-${String(stamp)}`,
  });
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-42' } }))?.title, 'GL issue edited', 'a later delivery updates the same ticket');
  eq(await prisma.ticket.count({ where: { workspaceId, key: 'DEV-42' } }), 1, 'no duplicate ticket was created');
});

if (runError) assert(false, `unexpected error during the run: ${runError.message}`);
if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
else await prisma.user.deleteMany({ where: { id: owner.id } });

report('tests/integration/forge.test.mts');
