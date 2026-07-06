//? Built-in merge-request review service (BUILTIN_MR_REVIEW). The operations behind the MR control-
//? ops + the read the frontend renders: open an MR from a ticket's branch, compute its diff, thread
//? + comment on lines, approve (stale on new head), merge, resolve threads. Explicit-workspaceId
//? prisma style (matches the orchestrator). Never throws catastrophically; returns nulls the caller
//? maps to error codes.

import type { PrismaClient, MergeRequest } from '@prisma/client';

import { normalizeGitConfig } from '../git/branchStrategy';
import { branchDiff, branchHead, mergeBranches, revertMergeCommit } from '../git/repoStore';
import { ciGateForMr, allowMergeOnRedCI } from '../ci/gate';
import { parseUnifiedDiff, type MrDiff } from './diff';

//? The outcome of a merge/rollback attempt — the caller maps `reason` to a UI message. `conflict`
//? carries the unmerged files. Never throws; the real git-merge is done under the caller's lease.
export type MergeMrResult =
  | { ok: true; sha?: string }
  | { ok: false; reason: 'not-open' | 'no-approval' | 'ci-red' | 'ci-running' | 'ci-stale' | 'conflict' | 'not-linked' | 'nothing-to-merge' | 'error'; files?: string[]; message?: string };

export interface MrThreadView {
  id: string; filePath: string | null; line: number | null; side: string; resolved: boolean;
  comments: { id: string; authorId: string | null; authorKind: string; body: string; createdAt: string }[];
}
export interface MrApprovalView { userId: string; stale: boolean; createdAt: string }
//? The transient outcome of a merge/rollback attached to the returned view so the client can toast
//? success or the reason it was blocked (no-approval / conflict + files). Not persisted.
export interface MrActionOutcome { ok: boolean; reason?: string; files?: string[] }
export interface MrView {
  id: string; number: number; title: string; status: string; sourceBranch: string; targetBranch: string;
  headSha: string | null; externalUrl: string | null; mergeStrategy: string;
  diff: MrDiff; threads: MrThreadView[]; approvals: MrApprovalView[];
  actionResult?: MrActionOutcome;
}

//? Open (or refresh) the MR for a ticket's branch → the workspace's target branch. Idempotent per
//? open MR; refreshes headSha when the branch advanced. Returns null if the ticket has no branch yet.
export async function createMr(prisma: PrismaClient, workspaceId: string, ticketKey: string, authorId?: string): Promise<MergeRequest | null> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { id: true, projectId: true, title: true, branch: true } });
  if (!ticket?.branch) return null;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitConfig: true } });
  const cfg = normalizeGitConfig(ws?.gitConfig ?? null);
  const source = ticket.branch;
  const headSha = await branchHead(workspaceId, source);

  const existing = await prisma.mergeRequest.findFirst({ where: { workspaceId, ticketId: ticket.id, sourceBranch: source, status: 'open' } });
  if (existing) {
    if (headSha.length > 0 && headSha !== existing.headSha) await prisma.mergeRequest.update({ where: { id: existing.id }, data: { headSha } });
    return existing;
  }
  const last = await prisma.mergeRequest.findFirst({ where: { workspaceId }, orderBy: { number: 'desc' }, select: { number: true } });
  return prisma.mergeRequest.create({
    data: {
      workspaceId, projectId: ticket.projectId, ticketId: ticket.id, number: (last?.number ?? 0) + 1,
      title: ticket.title, sourceBranch: source, targetBranch: cfg.targetBranch, status: 'open',
      headSha: headSha.length > 0 ? headSha : null, ...(authorId ? { authorId } : {}),
    },
  });
}

//? Add a review comment. Creates a thread (line-anchored or MR-level) if `threadId` is omitted.
export async function addReviewComment(
  prisma: PrismaClient, workspaceId: string,
  input: { mergeRequestId: string; threadId?: string; filePath?: string | null; line?: number | null; side?: string; body: string; authorId?: string; authorKind?: string },
): Promise<boolean> {
  let threadId = input.threadId;
  if (!threadId) {
    const thread = await prisma.reviewThread.create({
      data: { workspaceId, mergeRequestId: input.mergeRequestId, filePath: input.filePath ?? null, line: input.line ?? null, side: input.side ?? 'new' },
    });
    threadId = thread.id;
  }
  await prisma.reviewComment.create({
    data: { workspaceId, threadId, mergeRequestId: input.mergeRequestId, body: input.body, authorKind: input.authorKind ?? 'user', ...(input.authorId ? { authorId: input.authorId } : {}) },
  });
  return true;
}

//? Approve the MR at its current head. Re-approving refreshes the head the approval is bound to.
export async function approveMr(prisma: PrismaClient, workspaceId: string, mergeRequestId: string, userId: string): Promise<boolean> {
  const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId, id: mergeRequestId }, select: { headSha: true } });
  if (!mr) return false;
  const existing = await prisma.approval.findFirst({ where: { workspaceId, mergeRequestId, userId } });
  await (existing
    ? prisma.approval.update({ where: { id: existing.id }, data: { headSha: mr.headSha, stale: false } })
    : prisma.approval.create({ data: { workspaceId, mergeRequestId, userId, headSha: mr.headSha } }));
  return true;
}

//? Resolve / unresolve a review thread.
export async function resolveThread(prisma: PrismaClient, workspaceId: string, threadId: string, resolved: boolean): Promise<boolean> {
  await prisma.reviewThread.updateMany({ where: { workspaceId, id: threadId }, data: { resolved } });
  return true;
}

//? Really merge the MR (#9): require ≥1 NON-STALE approval (approving the current head), then merge
//? the source branch into the target IN THE BARE CLONE via a merge-worktree. On conflict the target
//? is untouched and the MR flips to 'conflict' (the UI surfaces the files; an AI --resume can pick it
//? up). On success the merge commit sha is recorded for a later git-revert rollback. The caller (the
//? Conductor) holds the per-workspace write-lease, so merges are serial. Idempotent: a non-open MR
//? or a missing fresh approval is a no-op with a reason.
export async function mergeMr(prisma: PrismaClient, workspaceId: string, mergeRequestId: string): Promise<MergeMrResult> {
  const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId, id: mergeRequestId } });
  if (mr?.status !== 'open') return { ok: false, reason: 'not-open' };
  if (!mr.headSha) return { ok: false, reason: 'nothing-to-merge' };
  //? Merge gate: at least one approval bound to the CURRENT head (a stale approval — cast before the
  //? branch advanced — does not count). This is the "MERGE VEREIST ≥1 approval" invariant.
  const approvals = await prisma.approval.findMany({ where: { workspaceId, mergeRequestId }, select: { headSha: true } });
  const hasFreshApproval = approvals.some((a) => (a.headSha ?? '') === mr.headSha);
  if (!hasFreshApproval) return { ok: false, reason: 'no-approval' };

  //? CI gate (ADR 0039): a required run that is red/running/stale blocks the merge — unless the Admin
  //? `allowMergeOnRedCI` override is on (unwedges a broken runner). No run ⇒ not gated (CI is opt-in).
  const gate = await ciGateForMr(prisma, workspaceId, mergeRequestId, mr.headSha);
  if (gate.gated && !(await allowMergeOnRedCI(prisma, workspaceId))) {
    return { ok: false, reason: gate.reason === 'ci-running' ? 'ci-running' : (gate.reason === 'ci-stale' ? 'ci-stale' : 'ci-red') };
  }

  const outcome = await mergeBranches(workspaceId, mr.targetBranch, mr.sourceBranch, mr.mergeStrategy);
  if (!outcome.ok) {
    if (outcome.conflict) {
      await prisma.mergeRequest.update({ where: { id: mr.id }, data: { status: 'conflict' } });
      return { ok: false, reason: 'conflict', files: outcome.files };
    }
    if (outcome.error === 'not-linked') return { ok: false, reason: 'not-linked' };
    return { ok: false, reason: 'error', message: outcome.error };
  }
  await prisma.mergeRequest.update({ where: { id: mr.id }, data: { status: 'merged', mergedAt: new Date(), mergedSha: outcome.sha } });
  return { ok: true, sha: outcome.sha };
}

//? Roll a merged MR back with a git-revert (#9) — reverts the recorded merge commit on the target
//? (history-preserving, never a destructive reset) and reopens the MR so it can be re-reviewed. Runs
//? under the caller's lease. No-op with a reason when the MR isn't a merged one we can revert.
export async function rollbackMr(prisma: PrismaClient, workspaceId: string, mergeRequestId: string): Promise<MergeMrResult> {
  const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId, id: mergeRequestId } });
  if (mr?.status !== 'merged' || !mr.mergedSha) return { ok: false, reason: 'not-open' };
  const outcome = await revertMergeCommit(workspaceId, mr.targetBranch, mr.mergedSha);
  if (!outcome.ok) return { ok: false, reason: outcome.error === 'not-linked' ? 'not-linked' : 'error', message: outcome.error };
  //? Reopen for re-review; drop the recorded merge sha (the revert is now the target tip).
  await prisma.mergeRequest.update({ where: { id: mr.id }, data: { status: 'open', mergedAt: null, mergedSha: null } });
  return { ok: true, sha: outcome.sha };
}

//? The full MR view for the frontend: fresh diff + threads (with comments) + approvals (staleness
//? computed against the current head). Returns null when the ticket has no MR.
export async function mrForTicket(prisma: PrismaClient, workspaceId: string, ticketKey: string): Promise<MrView | null> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { id: true } });
  if (!ticket) return null;
  const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId, ticketId: ticket.id }, orderBy: { createdAt: 'desc' } });
  if (!mr) return null;

  const raw = await branchDiff(workspaceId, mr.targetBranch, mr.sourceBranch);
  const diff = parseUnifiedDiff(raw);

  const threadRows = await prisma.reviewThread.findMany({ where: { workspaceId, mergeRequestId: mr.id }, orderBy: { createdAt: 'asc' } });
  const commentRows = await prisma.reviewComment.findMany({ where: { workspaceId, mergeRequestId: mr.id }, orderBy: { createdAt: 'asc' } });
  const threads: MrThreadView[] = threadRows.map((t) => ({
    id: t.id, filePath: t.filePath, line: t.line, side: t.side, resolved: t.resolved,
    comments: commentRows.filter((c) => c.threadId === t.id).map((c) => ({ id: c.id, authorId: c.authorId, authorKind: c.authorKind, body: c.body, createdAt: c.createdAt.toISOString() })),
  }));

  const approvalRows = await prisma.approval.findMany({ where: { workspaceId, mergeRequestId: mr.id } });
  const approvals: MrApprovalView[] = approvalRows.map((a) => ({ userId: a.userId, stale: (a.headSha ?? '') !== (mr.headSha ?? ''), createdAt: a.createdAt.toISOString() }));

  return {
    id: mr.id, number: mr.number, title: mr.title, status: mr.status, sourceBranch: mr.sourceBranch, targetBranch: mr.targetBranch,
    headSha: mr.headSha, externalUrl: mr.externalUrl, mergeStrategy: mr.mergeStrategy, diff, threads, approvals,
  };
}
