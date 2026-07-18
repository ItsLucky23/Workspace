//? Webhook issue routing across multiple projects. All mutations run through the
//? internal Conductor action; repo/provider ambiguity and sibling-key collisions fail closed.

import { tryCatch } from '@luckystack/core';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { parseWebhookEvent } = await import('../../server/git/webhookIngest');
const { enqueueInternalAction } = await import('../../server/orchestrator/internalOps');
const { forgeTouchedKeys } = await import('../../server/git/gitlabSync');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const githubParsed = parseWebhookEvent({
  action: 'opened',
  repository: { full_name: 'acme/api' },
  issue: { number: 7, title: 'GH issue', body: 'x', state: 'open', labels: [] },
}, 'issues');
eq(githubParsed.repo, 'acme/api', 'GitHub full_name becomes the bounded repo identity');
const gitlabParsed = parseWebhookEvent({
  object_kind: 'issue',
  project: { path_with_namespace: 'acme/web' },
  object_attributes: { iid: 9, action: 'open', title: 'GL issue', state: 'opened' },
});
eq(gitlabParsed.repo, 'acme/web', 'GitLab path_with_namespace becomes the bounded repo identity');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `wh-${String(stamp)}@youcomm.nl`, name: 'Wh' } });
let workspaceId = '';

const [runError] = await tryCatch(async () => {
  const created = await createBlankWorkspace(prisma, owner.id, 'Wh WS');
  workspaceId = created.workspaceId;
  const projectA = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  assert(projectA !== null, 'the workspace has project A');
  if (!projectA) return;
  await prisma.project.update({ where: { id: projectA.id }, data: { name: 'A', gitlabPath: 'acme/api' } });
  const projectB = await prisma.project.create({ data: { workspaceId, name: 'B', gitlabPath: 'acme/web' } });

  const apply = async (event: ReturnType<typeof parseWebhookEvent>, delivery: string): Promise<string[]> => {
    const result = await enqueueInternalAction({
      workspaceId,
      op: 'forge-event-apply',
      target: {},
      payload: { event, acceptedAt: Date.now() },
      userId: 'webhook-routing-test',
      clientRequestId: delivery,
    });
    return forgeTouchedKeys(result.result);
  };

  const eventB = parseWebhookEvent({
    object_kind: 'issue',
    project: { path_with_namespace: 'acme/web' },
    object_attributes: { iid: 42, action: 'open', title: 'For B', state: 'opened' },
  });
  eq(await apply(eventB, `wh-b-${String(stamp)}`), ['DEV-42'], 'the project-B issue is applied');
  const ticketB = await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-42' }, select: { projectId: true } });
  eq(ticketB?.projectId, projectB.id, 'the issue routes to project B');
  assert(ticketB?.projectId !== projectA.id, 'the issue does not default to project A');

  const eventA = parseWebhookEvent({
    object_kind: 'issue',
    project: { path_with_namespace: 'acme/api' },
    object_attributes: { iid: 43, action: 'open', title: 'For A', state: 'opened' },
  });
  await apply(eventA, `wh-a-${String(stamp)}`);
  eq((await prisma.ticket.findFirst({ where: { workspaceId, key: 'DEV-43' }, select: { projectId: true } }))?.projectId, projectA.id, 'the API issue routes to project A');

  const unknown = parseWebhookEvent({
    object_kind: 'issue',
    project: { path_with_namespace: 'acme/unknown' },
    object_attributes: { iid: 44, action: 'open', title: 'Unrouted', state: 'opened' },
  });
  eq(await apply(unknown, `wh-unknown-${String(stamp)}`), [], 'an unknown repo is skipped');
  eq(await prisma.ticket.count({ where: { workspaceId, key: 'DEV-44' } }), 0, 'an unknown repo creates no ticket');

  const solo = await createBlankWorkspace(prisma, owner.id, 'Solo WS');
  const soloWorkspaceId = solo.workspaceId;
  const [soloError] = await tryCatch(async () => {
    const soloProject = await prisma.project.findFirst({ where: { workspaceId: soloWorkspaceId }, select: { id: true } });
    assert(soloProject !== null, 'the solo workspace has a project');
    if (!soloProject) return;
    await prisma.project.update({
      where: { id: soloProject.id },
      data: { gitlabPath: 'acme/legacy', gitUrl: 'https://gitlab.example/acme/stale.git' },
    });
    await prisma.forgeConnection.create({
      data: {
        workspaceId: soloWorkspaceId,
        projectId: soloProject.id,
        mode: 'gitlab',
        repoPath: 'acme/canonical',
        status: 'connected',
      },
    });
    const mismatch = parseWebhookEvent({
      object_kind: 'issue',
      project: { path_with_namespace: 'acme/stale' },
      object_attributes: { iid: 45, action: 'open', title: 'Stale URL event', state: 'opened' },
    });
    const result = await enqueueInternalAction({
      workspaceId: soloWorkspaceId,
      op: 'forge-event-apply',
      target: {},
      payload: { event: mismatch, acceptedAt: Date.now() },
      userId: 'webhook-routing-test',
      clientRequestId: `wh-solo-mismatch-${String(stamp)}`,
    });
    eq(forgeTouchedKeys(result.result), [], 'an explicit ForgeConnection repoPath wins over a stale matching gitUrl');
    eq(await prisma.ticket.count({ where: { workspaceId: soloWorkspaceId, key: 'DEV-45' } }), 0, 'gitUrl A / connection B / event A fails closed instead of relabelling the event');
  });
  if (soloError) assert(false, `unexpected solo-workspace error: ${soloError.message}`);
  await cleanupWorkspace(prisma, soloWorkspaceId, [owner.id]);
});

if (runError) assert(false, `unexpected webhook-routing error: ${runError.message}`);
if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]);
else await prisma.user.deleteMany({ where: { id: owner.id } });

report('tests/integration/webhookRouting.test.mts');
