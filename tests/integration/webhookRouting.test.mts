//? R3 — webhook issue-routing across MULTIPLE projects (the multi-repo #8 gap: every issue landed on project #1).
//? Verifies: parseWebhookEvent extracts the source repo (GitHub full_name / GitLab path_with_namespace); and
//? ingestIssueEvent routes the ticket to the project whose linked repo MATCHES, falling back to the first project
//? for an unknown/absent repo (single-project = zero regression).

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

  // an unknown/absent repo falls back to the first project (no crash, zero regression)
  const evX = parseWebhookEvent({ object_kind: 'issue', project: { path_with_namespace: 'acme/unknown' }, object_attributes: { iid: 44, action: 'open', title: 'Unrouted', state: 'opened' } });
  const keyX = await ingestIssueEvent(prisma, wsId, evX);
  eq(keyX, 'DEV-44', 'an unroutable issue still ingests (falls back to the first project)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/webhookRouting.test.mts');
