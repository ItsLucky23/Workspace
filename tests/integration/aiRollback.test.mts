//? Integration test for B3 (AI-assisted rollback, ADR 0042). Runs against the REAL Conductor + Mongo.
//? Asserts the pure culprit parser and the propose→accept BRIDGE: accepting a `rollback` suggestion
//? forward-reverts the culprit MR (best-effort — no-op without a repo) AND drafts a DEV tracking ticket
//? pre-filled from the analysis. The AI never reverts directly (B-23); the Conductor does, on accept.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { parseCulprit } = await import('../../server/mr/rootCauseRole');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure culprit parser ---------------------------------------------------------------------------
const pick = parseCulprit('CULPRIT: MR-3\nREASON: the auth refactor in this merge dropped the null check.');
eq(pick.mrNumber, 3, 'parseCulprit extracts the MR number');
assert(pick.reason.includes('auth refactor'), 'parseCulprit extracts the reason');
eq(parseCulprit('no clear culprit here').mrNumber, null, 'parseCulprit yields null when no culprit named');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `rb-test-${String(stamp)}@youcomm.nl`, name: 'RB Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'RB Test WS' }, userId: owner.id, clientRequestId: `rb-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'RB Ticket' }, userId: owner.id, clientRequestId: `rb-t-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'RB Ticket' } }));
  const mr = await prisma.mergeRequest.create({ data: { workspaceId: wsId, projectId: proj?.id ?? '', ticketId: ticket?.id ?? '', number: 3, title: 'Auth refactor', sourceBranch: 'DEV-3', targetBranch: 'main', status: 'merged', mergedSha: 'deadbeef', mergeStrategy: 'merge' } });

  //? Seed the rollback suggestion the root-cause role would PROPOSE (the AI completion is a live path).
  const suggestion = await prisma.workspaceSuggestion.create({ data: { workspaceId: wsId, type: 'rollback', title: 'Rollback MR-3', body: '…', ticketIds: [], patch: { mrId: mr.id, symptom: 'login is broken in prod', reason: 'the auth refactor dropped the null check' }, status: 'open' } });

  const ticketsBefore = await prisma.ticket.count({ where: { workspaceId: wsId } });

  // ---- accept → the Conductor reverts (best-effort) + drafts a tracking ticket -------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'accept-suggestion', target: { suggestionId: suggestion.id }, payload: {}, userId: owner.id, clientRequestId: `rb-acc-${String(stamp)}` });
  const tracking = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, labels: { has: 'rollback' } } }));
  assert(tracking !== null, 'accepting a rollback suggestion drafts a tracking ticket');
  assert((tracking?.title ?? '').includes('login is broken'), 'the tracking ticket is pre-filled from the symptom');
  eq(tracking?.priority, 'high', 'the rollback tracking ticket is high priority');
  eq(tracking?.stageId, 'unrefined', 'the tracking ticket enters at unrefined');
  const ticketsAfter = await prisma.ticket.count({ where: { workspaceId: wsId } });
  eq(ticketsAfter, ticketsBefore + 1, 'exactly one tracking ticket is created');

  const accepted = await prisma.workspaceSuggestion.findFirst({ where: { id: suggestion.id }, select: { status: true } });
  eq(accepted?.status, 'accepted', 'the rollback suggestion is marked accepted');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/aiRollback.test.mts');
