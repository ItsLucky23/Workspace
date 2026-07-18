//? End-to-end project execution scope (ADR 0035; A12/F21/E02/E15). Runs against the REAL
//? Conductor + Mongo with two projects that deliberately reuse stage keys and APP_BRIEF.md.
//? Proves runtime/context/next-stage/reprovision/edit-guard, stage mutations, bulk move,
//? finding handoff, snapshot scoping, and services never fall through to the first project.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction, isControlActionFailure, resolveReprovisionTarget } = await import('../../server/orchestrator/conductor');
const { resolveProjectId } = await import('../../server/orchestrator/projectResolve');
const { resolveStageRuntime, loadStageContextDocs, resolveNextProjectStage } = await import('../../server/orchestrator/stageRunner');
const { ticketEditGuard } = await import('../../server/orchestrator/editGuard');
const { executeTriggerAction } = await import('../../server/automation/executor');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');
const { loadCtx: loadChatCtx, validateChatAction } = await import('../../server/ai/workspaceChat');

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
const owner = await prisma.user.create({ data: { email: `mp-test-${String(stamp)}@youcomm.nl`, name: 'MP Test' } });
let workspaceId: string | null = null;

try {
  // ---- workspace → project A ----------------------------------------------------
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'MP Test WS' }, userId: owner.id, clientRequestId: `mp-cw-${String(stamp)}` });
  const workspace = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  assert(workspace !== null, 'create-workspace creates a Workspace');
  workspaceId = workspace?.id ?? null;
  const wsId = workspaceId ?? '';
  const projectA = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId }, orderBy: { createdAt: 'asc' } }));
  const projectAId = projectA?.id ?? '';
  assert(projectAId.length > 0, 'the workspace has project A');

  // ---- project resolver: fallback only when genuinely unspecified ----------------
  eq(await resolveProjectId(prisma, wsId), projectAId, 'unspecified legacy resolve falls back to project A');
  eq(await resolveProjectId(prisma, wsId, '000000000000000000000000'), null, 'an absent explicit id never falls through to project A');
  eq(await resolveProjectId(prisma, wsId, 'malformed-not-hex'), null, 'a malformed explicit id fails closed without a Prisma throw');

  // ---- project B: identical pipeline keys + its own starter library ---------------
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'Backend B' }, userId: owner.id, clientRequestId: `mp-pc-${String(stamp)}` });
  const projectB = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, name: 'Backend B' } }));
  const projectBId = projectB?.id ?? '';
  assert(projectBId.length > 0 && projectBId !== projectAId, 'project-create adds project B');
  eq(await resolveProjectId(prisma, wsId, projectBId), projectBId, 'the explicit project B id resolves exactly');
  assert(await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, projectId: projectBId, key: 'impl' } }) !== null, 'project B has its own impl stage');
  const starterName = (await prisma.infoSource.findFirst({ where: { workspaceId: wsId, projectId: projectAId, source: 'starter' }, select: { name: true } }))?.name ?? '';
  assert(starterName.length > 0, 'project A has starter guidance');
  eq(await prisma.infoSource.count({ where: { workspaceId: wsId, source: 'starter', name: starterName, projectId: { in: [projectAId, projectBId] } } }), 2, 'the same starter artifact is seeded independently for A and B');

  // ---- tickets land in the explicit project --------------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'B Ticket', projectId: projectBId }, userId: owner.id, clientRequestId: `mp-tb-${String(stamp)}` });
  const ticketB = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'B Ticket' } }));
  assert(ticketB !== null, 'quick-add writes the project B ticket');
  eq(ticketB?.projectId, projectBId, 'quick-add with projectId lands in B, not A');

  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'A Ticket', projectId: projectAId }, userId: owner.id, clientRequestId: `mp-ta-${String(stamp)}` });
  const ticketA = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'A Ticket' } }));
  assert(ticketA !== null, 'quick-add writes the project A ticket');
  eq(ticketA?.projectId, projectAId, 'the project A ticket stays in A');

  // ---- runtime stage + next stage + APP_BRIEF context ----------------------------
  await prisma.pipelineStage.updateMany({ where: { workspaceId: wsId, projectId: projectAId, key: 'impl' }, data: { name: 'A implementation', systemPrompt: 'PROJECT_A_STAGE', userEditable: false } });
  await prisma.pipelineStage.updateMany({ where: { workspaceId: wsId, projectId: projectBId, key: 'impl' }, data: { name: 'B implementation', systemPrompt: 'PROJECT_B_STAGE', userEditable: true } });
  await prisma.pipelineStage.updateMany({ where: { workspaceId: wsId, projectId: projectBId, key: 'test' }, data: { order: 5 } });
  await prisma.pipelineStage.updateMany({ where: { workspaceId: wsId, projectId: projectBId, key: 'review' }, data: { order: 6 } });
  await prisma.pipelineStage.updateMany({ where: { workspaceId: wsId, projectId: projectBId, key: 'final' }, data: { order: 7 } });
  await prisma.ticket.update({ where: { id: ticketB?.id ?? '' }, data: { stageId: 'impl', branch: ticketB?.key ?? 'DEV-B' } });
  await prisma.infoSource.create({ data: { workspaceId: wsId, projectId: projectAId, mode: 'context-doc', source: 'starter', name: 'APP_BRIEF.md', content: 'APP_BRIEF_PROJECT_A', enabled: true, usedByStages: [] } });
  await prisma.infoSource.create({ data: { workspaceId: wsId, projectId: projectBId, mode: 'context-doc', source: 'starter', name: 'APP_BRIEF.md', content: 'APP_BRIEF_PROJECT_B', enabled: true, usedByStages: [] } });
  await prisma.infoSource.create({ data: { workspaceId: wsId, mode: 'context-doc', source: 'design-system', name: 'Design system', content: 'WORKSPACE_DESIGN_SYSTEM', enabled: true, usedByStages: [] } });
  const contentA = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: projectAId, title: 'A Content' } });
  const contentB = await prisma.contentProject.create({ data: { workspaceId: wsId, projectId: projectBId, title: 'B Content' } });

  // ---- Workspace-AI context + proposal provenance stay inside the active project --
  const chatCtxA = await loadChatCtx(prisma, wsId, projectAId);
  assert(chatCtxA !== null, 'chat context accepts validated project A');
  if (chatCtxA) {
    eq(chatCtxA.projectId, projectAId, 'chat context carries validated project A');
    assert(chatCtxA.tickets.some((ticket) => ticket.key === ticketA?.key) && !chatCtxA.tickets.some((ticket) => ticket.key === ticketB?.key), 'chat context A cannot see project B tickets');
    assert(chatCtxA.stages.some((stage) => stage.name === 'A implementation') && !chatCtxA.stages.some((stage) => stage.name === 'B implementation'), 'chat context A cannot see project B stages');
    assert(chatCtxA.pieces.some((piece) => piece.id === contentA.id) && !chatCtxA.pieces.some((piece) => piece.id === contentB.id), 'chat context A cannot see project B content projects');
    const assignA = validateChatAction({ op: 'assign', ticketKeys: [ticketA?.key], assigneeId: owner.id }, chatCtxA);
    eq(assignA?.projectId, projectAId, 'assign proposal carries project A provenance');
    eq(validateChatAction({ op: 'assign', ticketKeys: [ticketB?.key], assigneeId: owner.id }, chatCtxA), null, 'project A cannot propose assigning a project B ticket');
    eq(validateChatAction({ op: 'add-comment', ticketKeys: [ticketB?.key], body: 'wrong project' }, chatCtxA), null, 'project A cannot propose commenting on a project B ticket');
  }
  const chatCtxB = await loadChatCtx(prisma, wsId, projectBId);
  assert(chatCtxB?.tickets.some((ticket) => ticket.key === ticketB?.key) === true && !chatCtxB?.tickets.some((ticket) => ticket.key === ticketA?.key), 'chat context B contains only project B tickets');
  eq(await loadChatCtx(prisma, wsId, '000000000000000000000000'), null, 'chat context rejects a stale project instead of falling through to A');

  const runtime = await resolveStageRuntime(prisma, wsId, ticketB?.key ?? '', 'impl');
  eq(runtime?.ticket.projectId, projectBId, 'runtime project is always ticket.projectId');
  eq(runtime?.stage.systemPrompt, 'PROJECT_B_STAGE', 'runtime resolves B impl, never identically-keyed A impl');
  eq(await resolveStageRuntime(prisma, wsId, ticketB?.key ?? '', 'plan'), null, 'a stale stage request fails closed');
  const nextStage = await resolveNextProjectStage(prisma, wsId, projectBId, runtime?.stage.order ?? 3);
  eq(nextStage?.projectId, projectBId, 'next-stage lookup stays in project B');
  eq(nextStage?.key, 'test', 'next-stage lookup chooses B test even when A has an earlier order candidate');

  const contextDocs = await loadStageContextDocs(prisma, wsId, projectBId, []);
  const contextText = contextDocs.map((doc) => doc.content).join('\n');
  assert(contextText.includes('APP_BRIEF_PROJECT_B'), 'B runtime receives B APP_BRIEF');
  assert(!contextText.includes('APP_BRIEF_PROJECT_A'), 'B runtime never receives A APP_BRIEF');
  assert(contextText.includes('WORKSPACE_DESIGN_SYSTEM'), 'workspace-wide design-system remains available per ADR 0034');

  const reprovision = await resolveReprovisionTarget(prisma, wsId, ticketB?.key ?? '');
  eq(reprovision?.projectId, projectBId, 'reprovision resolves the stage in ticket project B');
  const editGuard = await ticketEditGuard(prisma, wsId, ticketB?.key ?? '');
  eq(editGuard.allowed, true, 'editGuard reads B userEditable=true, not A userEditable=false');

  // ---- snapshot context follows active project; invalid target never falls back ----
  const snapshotB = await buildSnapshot(prisma, owner.id, wsId, projectBId);
  eq(snapshotB.activeProjectId, projectBId, 'snapshot selects explicit project B');
  assert(snapshotB.tickets.some((ticket) => ticket.title === 'B Ticket') && !snapshotB.tickets.some((ticket) => ticket.title === 'A Ticket'), 'snapshot tickets are scoped to B');
  const snapshotContext = snapshotB.docs.map((doc) => doc.content).join('\n');
  assert(snapshotContext.includes('APP_BRIEF_PROJECT_B') && !snapshotContext.includes('APP_BRIEF_PROJECT_A'), 'snapshot context-docs are scoped to B');
  assert(snapshotB.stageConfigs.every((stage) => stage.projectId === projectBId), 'every stage config carries its projectId');
  const invalidSnapshot = await buildSnapshot(prisma, owner.id, wsId, '000000000000000000000000');
  eq(invalidSnapshot.activeProjectId, null, 'an invalid explicit snapshot project does not show project A');
  eq(invalidSnapshot.tickets.length, 0, 'invalid explicit snapshot target exposes no project tickets');

  // ---- UI review binding survives an active-project switch ------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-create', target: { projectId: projectBId }, payload: { screenshots: ['/media/project-b-review.png'], problems: [] }, userId: owner.id, clientRequestId: `mp-review-b-${String(stamp)}` });
  const reviewB = await poll(() => prisma.uiReviewRequest.findFirst({ where: { workspaceId: wsId, projectId: projectBId, status: 'open' } }));
  const snapshotAAfterReview = await buildSnapshot(prisma, owner.id, wsId, projectAId);
  const persistedReviewProject = snapshotAAfterReview.uiReviews.find((review) => review.id === reviewB?.id)?.projectId ?? '';
  eq(persistedReviewProject, projectBId, 'project A snapshot cannot rewrite the review persisted for B');
  await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-to-ticket', target: { projectId: persistedReviewProject }, payload: { reviewId: reviewB?.id ?? '' }, userId: owner.id, clientRequestId: `mp-review-ticket-b-${String(stamp)}` });
  const reviewTicketB = await prisma.ticket.findFirst({ where: { workspaceId: wsId, labels: { has: 'ui-review' } } });
  eq(reviewTicketB?.projectId, projectBId, 'review conversion after the switch still creates the ticket in B');
  assert(await prisma.ticketArtifactLink.findFirst({ where: { workspaceId: wsId, ticketId: reviewTicketB?.id ?? '', artifactId: reviewB?.id ?? '' } }) !== null, 'the review artifact link remains attached to the B ticket');

  // ---- stage save/create/delete/reorder: target A, B never touched ----------------
  const unscopedSave = await enqueueControlAction({ workspaceId: wsId, op: 'save-stage-config', target: { stageId: 'impl' }, payload: { name: 'must-not-land' }, userId: owner.id, clientRequestId: `mp-save-unscoped-${String(stamp)}` });
  assert(isControlActionFailure(unscopedSave.result), 'save-stage-config without projectId is rejected');
  await enqueueControlAction({ workspaceId: wsId, op: 'save-stage-config', target: { projectId: projectAId, stageId: 'impl' }, payload: { name: 'A implementation edited' }, userId: owner.id, clientRequestId: `mp-save-a-${String(stamp)}` });
  eq((await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, projectId: projectAId, key: 'impl' } }))?.name, 'A implementation edited', 'save edits A impl');
  eq((await prisma.pipelineStage.findFirst({ where: { workspaceId: wsId, projectId: projectBId, key: 'impl' } }))?.name, 'B implementation', 'save leaves identically-keyed B impl untouched');

  await enqueueControlAction({ workspaceId: wsId, op: 'stage-create', target: { projectId: projectAId }, payload: { key: 'security', name: 'A security', kind: 'review' }, userId: owner.id, clientRequestId: `mp-create-a-${String(stamp)}` });
  await enqueueControlAction({ workspaceId: wsId, op: 'stage-create', target: { projectId: projectBId }, payload: { key: 'security', name: 'B security', kind: 'review' }, userId: owner.id, clientRequestId: `mp-create-b-${String(stamp)}` });
  eq(await prisma.pipelineStage.count({ where: { workspaceId: wsId, key: 'security' } }), 2, 'the same custom key is valid once per project');
  const projectBOrderBefore = (await prisma.pipelineStage.findMany({ where: { workspaceId: wsId, projectId: projectBId }, orderBy: { order: 'asc' }, select: { key: true, order: true } })).map((stage) => `${stage.key}:${String(stage.order)}`).join('|');

  await enqueueControlAction({ workspaceId: wsId, op: 'stage-delete', target: { projectId: projectAId, stageId: 'security' }, payload: {}, userId: owner.id, clientRequestId: `mp-delete-a-${String(stamp)}` });
  eq(await prisma.pipelineStage.count({ where: { workspaceId: wsId, projectId: projectAId, key: 'security' } }), 0, 'delete removes A security');
  eq(await prisma.pipelineStage.count({ where: { workspaceId: wsId, projectId: projectBId, key: 'security' } }), 1, 'delete never removes identically-keyed B security');

  const projectAOrder = (await prisma.pipelineStage.findMany({ where: { workspaceId: wsId, projectId: projectAId }, orderBy: { order: 'asc' }, select: { key: true } })).map((stage) => stage.key).reverse();
  await enqueueControlAction({ workspaceId: wsId, op: 'stage-reorder', target: { projectId: projectAId }, payload: { order: projectAOrder }, userId: owner.id, clientRequestId: `mp-reorder-a-${String(stamp)}` });
  const projectBOrderAfter = (await prisma.pipelineStage.findMany({ where: { workspaceId: wsId, projectId: projectBId }, orderBy: { order: 'asc' }, select: { key: true, order: true } })).map((stage) => `${stage.key}:${String(stage.order)}`).join('|');
  eq(projectBOrderAfter, projectBOrderBefore, 'reordering A leaves every B stage order untouched');

  // ---- bulk move validates every ticket + target stage before any mutation --------
  const mixedMove = await enqueueControlAction({ workspaceId: wsId, op: 'bulk-move', target: { projectId: projectAId, ticketIds: [ticketA?.key ?? '', ticketB?.key ?? ''] }, payload: { stageId: 'refined' }, userId: owner.id, clientRequestId: `mp-mixed-${String(stamp)}` });
  assert(isControlActionFailure(mixedMove.result), 'an explicit A move rejects a B ticket in the batch');
  eq((await prisma.ticket.findUnique({ where: { id: ticketA?.id ?? '' } }))?.stageId, 'unrefined', 'failed mixed move does not mutate A');
  eq((await prisma.ticket.findUnique({ where: { id: ticketB?.id ?? '' } }))?.stageId, 'impl', 'failed mixed move does not mutate B');
  await enqueueControlAction({ workspaceId: wsId, op: 'bulk-move', target: { projectId: projectAId, ticketIds: [ticketA?.key ?? ''] }, payload: { stageId: 'refined' }, userId: owner.id, clientRequestId: `mp-move-a-${String(stamp)}` });
  eq((await prisma.ticket.findUnique({ where: { id: ticketA?.id ?? '' } }))?.stageId, 'refined', 'valid A move reaches A refined');
  eq((await prisma.ticket.findUnique({ where: { id: ticketB?.id ?? '' } }))?.stageId, 'impl', 'valid A move leaves B untouched');

  // ---- automation start-stage scopes its target to the event ticket's project ---
  await prisma.ticket.update({ where: { id: ticketB?.id ?? '' }, data: { stageId: 'test', status: 'busy' } });
  eq((await executeTriggerAction(prisma, wsId, { action: 'start-stage', params: { targetStageId: 'missing-stage' }, ticketKey: ticketA?.key })).status, 'noop', 'a missing start-stage target is a noop');
  eq((await executeTriggerAction(prisma, wsId, { action: 'start-stage', params: { targetStageId: 'security' }, ticketKey: ticketA?.key })).status, 'noop', 'a B-only start-stage target is a noop for ticket A');
  const unchangedA = await prisma.ticket.findUnique({ where: { id: ticketA?.id ?? '' } });
  const unchangedB = await prisma.ticket.findUnique({ where: { id: ticketB?.id ?? '' } });
  eq(unchangedA?.stageId, 'refined', 'invalid start-stage targets do not mutate ticket A');
  eq(unchangedA?.status, 'idle', 'invalid start-stage targets preserve ticket A status');
  eq(unchangedB?.stageId, 'test', 'invalid start-stage targets do not mutate ticket B');
  eq(unchangedB?.status, 'busy', 'invalid start-stage targets preserve ticket B status');
  eq((await executeTriggerAction(prisma, wsId, { action: 'start-stage', params: { targetStageId: 'impl' }, ticketKey: ticketA?.key })).status, 'executed', 'a shared stage key resolves in ticket A project');
  const movedA = await prisma.ticket.findUnique({ where: { id: ticketA?.id ?? '' } });
  const untouchedB = await prisma.ticket.findUnique({ where: { id: ticketB?.id ?? '' } });
  eq(movedA?.stageId, 'impl', 'start-stage moves the exact project A ticket');
  eq(movedA?.status, 'idle', 'start-stage preserves idle activation semantics');
  eq(untouchedB?.stageId, 'test', 'start-stage never updates the project B ticket');
  eq(untouchedB?.status, 'busy', 'start-stage preserves the project B ticket status');

  // ---- finding → explicit project A (E02) ----------------------------------------
  const finding = await prisma.interviewFinding.create({ data: { workspaceId: wsId, area: 'reliability', severity: 'high', title: 'Scoped finding', summary: 'Keep it in project A.' } });
  await enqueueControlAction({ workspaceId: wsId, op: 'finding-to-ticket', target: { findingId: finding.id, projectId: projectAId }, payload: {}, userId: owner.id, clientRequestId: `mp-finding-a-${String(stamp)}` });
  const acceptedFinding = await prisma.interviewFinding.findUnique({ where: { id: finding.id } });
  const findingTicket = acceptedFinding?.ticketId ? await prisma.ticket.findUnique({ where: { id: acceptedFinding.ticketId } }) : null;
  eq(findingTicket?.projectId, projectAId, 'finding ticket uses the explicit active project A');

  // ---- service remains attached to project B ------------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'service-create', target: { projectId: projectBId }, payload: { name: 'api', path: 'apps/api' }, userId: owner.id, clientRequestId: `mp-sc-${String(stamp)}` });
  const service = await poll(() => prisma.service.findFirst({ where: { workspaceId: wsId, projectId: projectBId, name: 'api' } }));
  assert(service !== null, 'service-create attaches the service to project B');
  const snapshotBWithService = await buildSnapshot(prisma, owner.id, wsId, projectBId);
  assert(snapshotBWithService.services.some((entry) => entry.name === 'api' && entry.path === 'apps/api'), 'project B snapshot lists its service');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/multiProject.test.mts');
