//? R3 — webhook issue-routing across MULTIPLE projects (the multi-repo #8 gap: every issue landed on project #1).
//? Verifies: parseWebhookEvent extracts the source repo (GitHub full_name / GitLab path_with_namespace); and
//? ingestIssueEvent routes the ticket to the project whose linked repo MATCHES. In a MULTI-project workspace an
//? unroutable repo is SKIPPED (not dumped on an arbitrary project); a SINGLE-project workspace still falls back
//? (zero regression).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { parseWebhookEvent, ingestIssueEvent } = await import('../../server/git/webhookIngest');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

// Part A — parse extracts the repo identity
{
  const gh = parseWebhookEvent({ action: 'opened', repository: { full_name: 'acme/api' }, issue: { number: 7, title: 'GH issue', body: 'x', state: 'open', labels: [] } }, 'issues');
  eq(gh.repo, 'acme/api', 'GitHub full_name → repo');
  const gl = parseWebhookEvent({ object_kind: 'issue', project: { path_with_namespace: 'acme/web' }, object_attributes: { iid: 9, action: 'open', title: 'GL issue', state: 'opened' } });
  eq(gl.repo, 'acme/web', 'GitLab path_with_namespace → repo');
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `wh-${String(stamp)}@youcomm.nl`, name: 'Wh' } });
let workspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Wh WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const projA = await prisma.project.create({ data: { workspaceId: wsId, name: 'A', gitlabPath: 'acme/api' } });
  const projB = await prisma.project.create({ data: { workspaceId: wsId, name: 'B', gitlabPath: 'acme/web' } });

  // Part B — an issue from repo acme/web routes to project B (not the first project).
  const evB = parseWebhookEvent({ object_kind: 'issue', project: { path_with_namespace: 'acme/web' }, object_attributes: { iid: 42, action: 'open', title: 'For B', state: 'opened' } });
  const keyB = await ingestIssueEvent(prisma, wsId, evB);
  eq(keyB, 'DEV-42', 'the issue was ingested');
  const ticketB = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key: 'DEV-42' }, select: { projectId: true } });
  eq(ticketB?.projectId, projB.id, 'the issue routed to project B (its linked repo matched)');
  assert(ticketB?.projectId !== projA.id, 'it did NOT default to project A');

  // an issue from repo acme/api routes to project A
  const evA = parseWebhookEvent({ object_kind: 'issue', project: { path_with_namespace: 'acme/api' }, object_attributes: { iid: 43, action: 'open', title: 'For A', state: 'opened' } });
  await ingestIssueEvent(prisma, wsId, evA);
  const ticketA = await prisma.ticket.findFirst({ where: { workspaceId: wsId, key: 'DEV-43' }, select: { projectId: true } });
  eq(ticketA?.projectId, projA.id, 'the second issue routed to project A');

  // an unknown repo in a MULTI-project workspace is SKIPPED, not mis-routed to an arbitrary project.
  const evX = parseWebhookEvent({ object_kind: 'issue', project: { path_with_namespace: 'acme/unknown' }, object_attributes: { iid: 44, action: 'open', title: 'Unrouted', state: 'opened' } });
  const keyX = await ingestIssueEvent(prisma, wsId, evX);
  eq(keyX, null, 'an unroutable issue in a multi-project workspace is skipped (not dumped on project A)');
  eq(await prisma.ticket.count({ where: { workspaceId: wsId, key: 'DEV-44' } }), 0, 'no ticket was created for the unroutable issue');

  // ...but in a SINGLE-project workspace an unknown/absent repo still falls back (zero regression).
  //? `createBlankWorkspace` seeds exactly ONE project (gitlabPath=''); an event repo that matches nothing
  //? therefore has a single unambiguous target to fall back to.
  const solo = await createBlankWorkspace(prisma, owner.id, 'Solo WS');
  const soloWs = solo.workspaceId;
  try {
    const soloProj = await prisma.project.findFirst({ where: { workspaceId: soloWs }, select: { id: true } });
    const evS = parseWebhookEvent({ object_kind: 'issue', project: { path_with_namespace: 'acme/mismatch' }, object_attributes: { iid: 45, action: 'open', title: 'Solo fallback', state: 'opened' } });
    const keyS = await ingestIssueEvent(prisma, soloWs, evS);
    eq(keyS, 'DEV-45', 'a single-project workspace still ingests an unroutable issue (fallback)');
    const ticketS = await prisma.ticket.findFirst({ where: { workspaceId: soloWs, key: 'DEV-45' }, select: { projectId: true } });
    eq(ticketS?.projectId, soloProj?.id, 'it lands on the single project');
  } finally {
    await cleanupWorkspace(prisma, soloWs, [owner.id]).catch(() => undefined);
  }
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/webhookRouting.test.mts');
