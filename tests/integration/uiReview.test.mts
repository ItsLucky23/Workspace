//? U1 — the ui-review-create control-op through the REAL Conductor + Mongo. Verifies: a request persists with
//? SANITIZED screenshots (only /media/) + problems (only taxonomy keys) + notes, tenant-scoped; and an empty
//? request (no screenshots, no problems) is rejected (no row).

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction, isControlActionFailure } = await import('../../server/orchestrator/conductor');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');
const { enqueueCompareReview } = await import('../../src/workspaces/_api/designerInspiration_v1');
const { loadTicketArtifactContext } = await import('../../server/orchestrator/artifactContext');
const { buildSnapshot } = await import('../../server/read/workspaceSnapshot');

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `ui-${String(stamp)}@youcomm.nl`, name: 'Ui' } });
const restricted = await prisma.user.create({ data: { email: `ui-restricted-${String(stamp)}@youcomm.nl`, name: 'Ui restricted' } });
const foreignOwner = await prisma.user.create({ data: { email: `ui-foreign-${String(stamp)}@youcomm.nl`, name: 'Ui foreign' } });
let workspaceId: string | null = null;
let foreignWorkspaceId: string | null = null;

try {
  const created = await createBlankWorkspace(prisma, owner.id, 'Ui WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;
  const firstProject = await prisma.project.findFirst({ where: { workspaceId: wsId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  await enqueueControlAction({ workspaceId: wsId, op: 'project-create', target: {}, payload: { name: 'u2-project' }, userId: owner.id, clientRequestId: `ui-project-${String(stamp)}` });
  const targetProject = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId, name: 'u2-project' }, select: { id: true } }));
  const targetProjectId = targetProject?.id ?? '';
  assert(targetProjectId.length > 0 && targetProjectId !== firstProject?.id, 'the review target is the explicit second project');

  const foreignCreated = await createBlankWorkspace(prisma, foreignOwner.id, 'Foreign UI WS');
  foreignWorkspaceId = foreignCreated.workspaceId;
  const foreignProject = await prisma.project.findFirst({ where: { workspaceId: foreignCreated.workspaceId }, select: { id: true } });
  const foreignProjectId = foreignProject?.id ?? '';

  await enqueueControlAction({
    workspaceId: wsId, op: 'ui-review-create', target: { projectId: targetProjectId },
    payload: { page: '/settings', screenshots: ['/media/shot1.png', 'https://evil/x.png', '/media/shot2.png'], problems: ['cluttered', 'made-up', 'not-responsive', 'cluttered'], notes: 'the buttons look off' },
    userId: owner.id, clientRequestId: `ui-${String(stamp)}`,
  });
  const req = await poll(() => prisma.uiReviewRequest.findFirst({ where: { workspaceId: wsId } }));
  assert(req !== null, 'the UI review request persisted');
  eq(req?.projectId, targetProjectId, 'an explicit same-workspace project is persisted on the review');
  eq(req?.page, '/settings', 'the page label was stored');
  eq(req?.screenshots.length, 2, 'only the two /media/ screenshots were kept (external dropped)');
  assert((req?.screenshots ?? []).every((s) => s.startsWith('/media/')), 'no external screenshot url');
  eq(req?.problems.length, 2, 'only the valid, deduped taxonomy problems were kept');
  assert((req?.problems ?? []).includes('cluttered') && (req?.problems ?? []).includes('not-responsive') && !(req?.problems ?? []).includes('made-up'), 'off-taxonomy problem dropped');
  eq(req?.notes, 'the buttons look off', 'the free-text note was stored');
  eq(req?.status, 'open', 'a new request is open');
  eq(req?.createdById, owner.id, 'the creator is recorded');

  //? Explicit stale/foreign projects fail closed; no review silently lands in another project.
  const foreignCreate = await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-create', target: { projectId: foreignProjectId }, payload: { screenshots: ['/media/foreign.png'], problems: [] }, userId: owner.id, clientRequestId: `ui-foreign-create-${String(stamp)}` });
  assert(isControlActionFailure(foreignCreate.result), 'a foreign explicit project is rejected at create');
  await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-create', target: { projectId: targetProjectId }, payload: { screenshots: [], problems: [] }, userId: owner.id, clientRequestId: `ui-empty-${String(stamp)}` });
  await wait(300);
  eq(await prisma.uiReviewRequest.count({ where: { workspaceId: wsId } }), 1, 'foreign and empty create requests persist no row');

  //? The snapshot exposes the persisted binding. Simulate switching from project B to A while a
  //? previously rendered review card still exists: the card keeps B and must never retarget to A.
  const snapshotB = await buildSnapshot(prisma, owner.id, wsId, targetProjectId);
  eq(snapshotB.uiReviews.find((review) => review.id === req?.id)?.projectId, targetProjectId, 'the review summary carries project B');
  const snapshotAfterSwitch = await buildSnapshot(prisma, owner.id, wsId, firstProject?.id);
  const staleCardProjectId = snapshotAfterSwitch.uiReviews.find((review) => review.id === req?.id)?.projectId ?? '';
  eq(staleCardProjectId, targetProjectId, 'switching active project does not rewrite the persisted review project');

  const mismatch = await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-to-ticket', target: { projectId: firstProject?.id ?? '' }, payload: { reviewId: req?.id ?? '' }, userId: owner.id, clientRequestId: `ui-mismatch-${String(stamp)}` });
  assert(isControlActionFailure(mismatch.result), 'a conversion request that mismatches persisted project B fails');
  const foreignConversion = await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-to-ticket', target: { projectId: foreignProjectId }, payload: { reviewId: req?.id ?? '' }, userId: owner.id, clientRequestId: `ui-foreign-convert-${String(stamp)}` });
  assert(isControlActionFailure(foreignConversion.result), 'a foreign conversion project fails');
  eq(await prisma.ticket.count({ where: { workspaceId: wsId, labels: { has: 'ui-review' } } }), 0, 'failed project checks create no redesign ticket');

  await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-to-ticket', target: { projectId: staleCardProjectId }, payload: { reviewId: req?.id ?? '' }, userId: owner.id, clientRequestId: `ui-t-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, labels: { has: 'ui-review' } } }));
  assert(ticket !== null, 'a redesign ticket was created from the review');
  eq(ticket?.projectId, targetProjectId, 'the redesign ticket lands in the explicit project, not project #1');
  eq(ticket?.stageId, 'unrefined', 'the redesign ticket enters at unrefined (Conductor invariant)');
  assert((ticket?.description ?? '').includes('cluttered') && (ticket?.description ?? '').includes('the buttons look off'), 'the ticket description carries the problems + notes');
  assert((ticket?.description ?? '').includes('/media/shot1.png'), 'the ticket description carries the screenshot urls');
  const ticketed = await poll(() => prisma.uiReviewRequest.findFirst({ where: { workspaceId: wsId, id: req?.id ?? '', status: 'ticketed' } }));
  assert(ticketed !== null, "the review flipped to 'ticketed' (left the inbox)");
  const reviewLink = await prisma.ticketArtifactLink.findFirst({ where: { workspaceId: wsId, ticketId: ticket?.id ?? '', artifactId: req?.id ?? '', artifactKind: 'ui-review' } });
  assert(reviewLink !== null, 'the ticket keeps a live artifact link to the originating UI review');
  const reviewContext = await loadTicketArtifactContext(prisma, wsId, ticket?.id ?? '');
  assert(reviewContext.some((doc) => doc.content.includes('/media/shot1.png') && doc.content.includes('the buttons look off')), 'the linked review reaches stage context with screenshots + analysis');

  //? U2 — dismiss path: a second review dismissed without a ticket.
  await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-create', target: { projectId: targetProjectId }, payload: { problems: ['confusing'], screenshots: [] }, userId: owner.id, clientRequestId: `ui-2-${String(stamp)}` });
  const second = await poll(() => prisma.uiReviewRequest.findFirst({ where: { workspaceId: wsId, status: 'open' } }));
  assert(second !== null, 'a second open review persisted');
  await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-dismiss', target: {}, payload: { reviewId: second?.id ?? '' }, userId: owner.id, clientRequestId: `ui-d-${String(stamp)}` });
  const dismissed = await poll(() => prisma.uiReviewRequest.findFirst({ where: { workspaceId: wsId, id: second?.id ?? '', status: 'dismissed' } }));
  assert(dismissed !== null, 'dismiss flips the review to dismissed');
  //? Count only redesign tickets — the blank workspace already carries welcome tickets.
  eq(await prisma.ticket.count({ where: { workspaceId: wsId, labels: { has: 'ui-review' } } }), 1, 'dismiss creates NO extra redesign ticket');

  //? Designer compare regression: its already-computed AI result goes through the EXISTING
  //? ui-review-create op, producing exactly one signal + one review (never a direct route write).
  const signalsBeforeCompare = await prisma.workspaceSignal.count({ where: { workspaceId: wsId } });
  const reviewsBeforeCompare = await prisma.uiReviewRequest.count({ where: { workspaceId: wsId } });
  const compared = await enqueueCompareReview(prisma, {
    workspaceId: wsId, projectId: targetProjectId, userId: owner.id, ownUrl: '/media/our-page.png', inspirationUrl: '/media/reference.png',
    notes: '## Differences\n- Reference spacing is calmer.', clientRequestId: `ui-compare-${String(stamp)}`,
  });
  assert(compared.ok, 'designer compare is accepted through ui-review-create');
  const comparedReview = compared.ok ? await prisma.uiReviewRequest.findFirst({ where: { workspaceId: wsId, id: compared.reviewId } }) : null;
  assert(comparedReview !== null, 'the Conductor persisted the compare review');
  eq(comparedReview?.projectId, targetProjectId, 'designer compare persists its explicit project B');
  eq(comparedReview?.page, 'inspiration-compare', 'the compare page label was stored');
  eq(comparedReview?.screenshots, ['/media/our-page.png', '/media/reference.png'], 'both compare screenshots were stored');
  eq(comparedReview?.notes, '## Differences\n- Reference spacing is calmer.', 'the precomputed AI result was stored as notes');
  eq(await prisma.workspaceSignal.count({ where: { workspaceId: wsId } }), signalsBeforeCompare + 1, 'compare emitted exactly one control signal');
  eq(await prisma.uiReviewRequest.count({ where: { workspaceId: wsId } }), reviewsBeforeCompare + 1, 'compare created exactly one review row');
  const duplicateCompare = await enqueueCompareReview(prisma, {
    workspaceId: wsId, projectId: targetProjectId, userId: owner.id, ownUrl: '/media/our-page.png', inspirationUrl: '/media/reference.png',
    notes: '## Differences\n- Reference spacing is calmer.', clientRequestId: `ui-compare-${String(stamp)}`,
  });
  assert(!duplicateCompare.ok, 'a repeated compare request is deduplicated by the Conductor');
  eq(await prisma.workspaceSignal.count({ where: { workspaceId: wsId } }), signalsBeforeCompare + 1, 'the repeated clientRequestId emits no second signal');
  eq(await prisma.uiReviewRequest.count({ where: { workspaceId: wsId } }), reviewsBeforeCompare + 1, 'the repeated clientRequestId creates no second review');
  const foreignCompare = await enqueueCompareReview(prisma, {
    workspaceId: wsId, projectId: foreignProjectId, userId: owner.id, ownUrl: '/media/our-page.png', inspirationUrl: '/media/reference.png',
    notes: 'must not persist', clientRequestId: `ui-compare-foreign-${String(stamp)}`,
  });
  assert(!foreignCompare.ok, 'designer compare rejects a foreign project before enqueue');
  eq(await prisma.workspaceSignal.count({ where: { workspaceId: wsId } }), signalsBeforeCompare + 1, 'foreign compare emits no signal');

  //? A legacy null-project review gets NO first-project fallback. It converts only when the caller
  //? explicitly supplies its currently active project; that project is persisted during conversion.
  const legacy = await prisma.uiReviewRequest.create({ data: { workspaceId: wsId, screenshots: ['/media/legacy.png'], problems: [], status: 'open' } });
  const legacyUnscoped = await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-to-ticket', target: {}, payload: { reviewId: legacy.id }, userId: owner.id, clientRequestId: `ui-legacy-unscoped-${String(stamp)}` });
  assert(isControlActionFailure(legacyUnscoped.result), 'legacy null review without an explicit active project fails');
  eq(await prisma.ticket.count({ where: { workspaceId: wsId, labels: { has: 'ui-review' } } }), 1, 'legacy failure does not silently create a project-A ticket');
  await enqueueControlAction({ workspaceId: wsId, op: 'ui-review-to-ticket', target: { projectId: targetProjectId }, payload: { reviewId: legacy.id }, userId: owner.id, clientRequestId: `ui-legacy-b-${String(stamp)}` });
  const legacyTicket = await prisma.ticket.findFirst({ where: { workspaceId: wsId, description: { contains: '/media/legacy.png' } } });
  eq(legacyTicket?.projectId, targetProjectId, 'legacy conversion uses the explicitly supplied project B');
  eq((await prisma.uiReviewRequest.findUnique({ where: { id: legacy.id } }))?.projectId, targetProjectId, 'legacy conversion persists its resolved project');

  //? A workspace member without workTickets remains forbidden; denial emits/writes nothing.
  await prisma.workspaceRole.create({ data: { workspaceId: wsId, key: 'ui-viewer', label: 'UI viewer', perms: [false, false, false, false, false, false, false, false] } });
  await prisma.workspaceMember.create({ data: { workspaceId: wsId, userId: restricted.id, roleKey: 'ui-viewer' } });
  const signalsBeforeDenied = await prisma.workspaceSignal.count({ where: { workspaceId: wsId } });
  const reviewsBeforeDenied = await prisma.uiReviewRequest.count({ where: { workspaceId: wsId } });
  const denied = await enqueueCompareReview(prisma, {
    workspaceId: wsId, projectId: targetProjectId, userId: restricted.id, ownUrl: '/media/denied-own.png', inspirationUrl: '/media/denied-reference.png',
    notes: 'must not persist', clientRequestId: `ui-compare-denied-${String(stamp)}`,
  });
  assert(!denied.ok && denied.errorCode === 'auth.forbidden', 'designer compare requires workTickets, not membership alone');
  eq(await prisma.workspaceSignal.count({ where: { workspaceId: wsId } }), signalsBeforeDenied, 'forbidden compare emitted no signal');
  eq(await prisma.uiReviewRequest.count({ where: { workspaceId: wsId } }), reviewsBeforeDenied, 'forbidden compare wrote no review');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, restricted.id]).catch(() => undefined);
  else {
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: restricted.id } }).catch(() => undefined);
  }
  if (foreignWorkspaceId) await cleanupWorkspace(prisma, foreignWorkspaceId, [foreignOwner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: foreignOwner.id } }).catch(() => undefined);
}

report('tests/integration/uiReview.test.mts');
