//? Integration test for E1 (reasoning first-class — plan-critique gate, ADR 0044). Runs against the REAL
//? Conductor + Mongo. Asserts the pure plan extractor + prompt builder, and that the plan-critique op is a
//? graceful no-op when a ticket has no plan yet (the adversarial AI pass itself is a live path). The
//? per-stage think-budget (effort/autoEscalate) already surfaces in the pipeline UI — no test here.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { extractPlan, buildCritiquePrompt, registerPlanCritiqueRole } = await import('../../server/reasoning/planCritiqueRole');
//? Roles register at server boot; this test drives the Conductor directly, so register it here.
registerPlanCritiqueRole();

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure plan extractor + prompt builder ---------------------------------------------------------
const plan = extractPlan({ summary: 'Add auth', openQuestions: ['which provider?', 'session store?'], changedFiles: ['a.ts'] });
assert(plan.includes('Add auth') && plan.includes('which provider?'), 'extractPlan pulls the summary + open questions from the CarryOver envelope');
eq(extractPlan(null), '', 'extractPlan is empty for a missing envelope');
eq(extractPlan({ changedFiles: [] }), '', 'extractPlan is empty when there is no summary/questions');
const built = buildCritiquePrompt('Add auth');
assert(built.system.toLowerCase().includes('adversarial') && built.prompt.includes('Add auth'), 'buildCritiquePrompt builds an adversarial prompt containing the plan');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `pc-test-${String(stamp)}@youcomm.nl`, name: 'PC Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'PC Test WS' }, userId: owner.id, clientRequestId: `pc-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'PC Ticket' }, userId: owner.id, clientRequestId: `pc-t-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'PC Ticket' } }));

  // ---- plan-critique on a ticket with NO plan yet → graceful no-op (no suggestion, no AI call) -----
  const res = await enqueueControlAction({ workspaceId: wsId, op: 'plan-critique', target: { ticketId: ticket?.key ?? '' }, payload: {}, userId: owner.id, clientRequestId: `pc-run-${String(stamp)}` });
  assert((res.result as Record<string, unknown> | null)?.ok === true, 'the plan-critique op runs without error even with no plan');
  await wait(300);
  const suggestions = await prisma.workspaceSuggestion.count({ where: { workspaceId: wsId, type: 'plan-critique' } });
  eq(suggestions, 0, 'no plan-critique suggestion is created when the ticket has no plan yet');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/planCritique.test.mts');
