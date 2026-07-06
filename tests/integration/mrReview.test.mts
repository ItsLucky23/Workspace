//? Integration test for C3 (AI MR-review, ADR 0041). Runs against the REAL Conductor + Mongo. Asserts the
//? pure finding parser + diff-line validation, and the propose→accept BRIDGE: an mr-review suggestion,
//? on accept, posts each finding as a ReviewComment(authorKind:'ai') via the Conductor (B-23) — the AI
//? never writes directly, and never approves/merges (the MR stays open). The AI completion itself is a live
//? path; here we seed the suggestion the role would produce and drive the accept.

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { enqueueControlAction } = await import('../../server/orchestrator/conductor');
const { parseReviewFindings, validateAgainstDiff } = await import('../../server/mr/reviewRole');

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function poll<T>(fn: () => Promise<T>, timeoutMs = 8000, stepMs = 60): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v !== null && v !== undefined) return v; if (Date.now() >= deadline) return null; await wait(stepMs); }
}

// ---- pure parser + diff validation ----------------------------------------------------------------
const parsed = parseReviewFindings(`Here are findings:
- [src/x.ts:2] null deref when input is empty
- [src/y.ts:10] missing await on the async call
not a finding line
* [src/x.ts:99] hallucinated line`);
eq(parsed.length, 3, 'parseReviewFindings extracts the [path:line] findings');
eq(parsed[0]?.line, 2, 'parseReviewFindings reads the line number');

const rawDiff = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,2 +1,3 @@
 line1
+added at new line 2
 line3`;
const validated = validateAgainstDiff(parsed, rawDiff);
assert(validated.some((f) => f.filePath === 'src/x.ts' && f.line === 2), 'validateAgainstDiff keeps a finding on a real changed line');
assert(!validated.some((f) => f.line === 99) && !validated.some((f) => f.filePath === 'src/y.ts'), 'validateAgainstDiff drops findings not on a changed line');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `mrr-test-${String(stamp)}@youcomm.nl`, name: 'MRR Test' } });
let workspaceId: string | null = null;

try {
  await enqueueControlAction({ workspaceId: '', op: 'create-workspace', target: {}, payload: { name: 'MRR Test WS' }, userId: owner.id, clientRequestId: `mrr-cw-${String(stamp)}` });
  const ws = await poll(() => prisma.workspace.findFirst({ where: { ownerId: owner.id } }));
  workspaceId = ws?.id ?? null;
  const wsId = workspaceId ?? '';
  const proj = await poll(() => prisma.project.findFirst({ where: { workspaceId: wsId } }));
  await enqueueControlAction({ workspaceId: wsId, op: 'quick-add', target: {}, payload: { title: 'MRR Ticket' }, userId: owner.id, clientRequestId: `mrr-t-${String(stamp)}` });
  const ticket = await poll(() => prisma.ticket.findFirst({ where: { workspaceId: wsId, title: 'MRR Ticket' } }));
  const mr = await prisma.mergeRequest.create({ data: { workspaceId: wsId, projectId: proj?.id ?? '', ticketId: ticket?.id ?? '', number: 1, title: 'MRR MR', sourceBranch: ticket?.key ?? 'DEV-1', targetBranch: 'main', status: 'open', headSha: 'h1', mergeStrategy: 'merge' } });

  //? Seed the suggestion the mr-review role would PROPOSE (the AI completion is a live path).
  const suggestion = await prisma.workspaceSuggestion.create({ data: { workspaceId: wsId, type: 'mr-review', title: 'AI review: 2 finding(s)', body: '…', ticketIds: [], patch: { mrId: mr.id, findings: [{ filePath: 'src/x.ts', line: 2, side: 'new', body: 'null deref' }, { filePath: 'src/y.ts', line: 5, side: 'new', body: 'missing await' }] }, status: 'open' } });

  // ---- accept → the Conductor posts the AI review comments ---------------------------------------
  await enqueueControlAction({ workspaceId: wsId, op: 'accept-suggestion', target: { suggestionId: suggestion.id }, payload: {}, userId: owner.id, clientRequestId: `mrr-acc-${String(stamp)}` });
  const comments = await poll(async () => { const c = await prisma.reviewComment.findMany({ where: { workspaceId: wsId, mergeRequestId: mr.id } }); return c.length >= 2 ? c : null; });
  assert(comments !== null && comments.length === 2, 'accepting the mr-review suggestion posts one ReviewComment per finding');
  assert((comments ?? []).every((c) => c.authorKind === 'ai' && c.authorId === null), 'the posted comments are authored by the AI (authorKind:ai, no user)');
  const accepted = await prisma.workspaceSuggestion.findFirst({ where: { id: suggestion.id }, select: { status: true } });
  eq(accepted?.status, 'accepted', 'the suggestion is marked accepted');

  // ---- the AI never approved/merged — the MR stays open with no approvals -------------------------
  const mrAfter = await prisma.mergeRequest.findFirst({ where: { id: mr.id }, select: { status: true } });
  eq(mrAfter?.status, 'open', 'the AI review never approved or merged the MR (stays open)');
  const approvals = await prisma.approval.count({ where: { workspaceId: wsId, mergeRequestId: mr.id } });
  eq(approvals, 0, 'the AI created no approvals (approvals stay human-only)');
} catch (error) {
  assert(false, `unexpected error during the run: ${String(error)}`);
} finally {
  if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id]).catch(() => undefined);
  else await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
}

report('tests/integration/mrReview.test.mts');
