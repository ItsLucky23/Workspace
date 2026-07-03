//? Built-in merge-request review service (BUILTIN_MR_REVIEW). The operations behind the MR control-
//? ops + the read the frontend renders: open an MR from a ticket's branch, compute its diff, thread
//? + comment on lines, approve (stale on new head), merge, resolve threads. Explicit-workspaceId
//? prisma style (matches the orchestrator). Never throws catastrophically; returns nulls the caller
//? maps to error codes.

import type { PrismaClient, MergeRequest } from '@prisma/client';

import { normalizeGitConfig } from '../git/branchStrategy';
import { branchDiff, branchHead } from '../git/repoStore';
import { parseUnifiedDiff, type MrDiff } from './diff';

export interface MrThreadView {
  id: string; filePath: string | null; line: number | null; side: string; resolved: boolean;
  comments: { id: string; authorId: string | null; authorKind: string; body: string; createdAt: string }[];
}
export interface MrApprovalView { userId: string; stale: boolean; createdAt: string }
export interface MrView {
  id: string; number: number; title: string; status: string; sourceBranch: string; targetBranch: string;
  headSha: string | null; externalUrl: string | null; mergeStrategy: string;
  diff: MrDiff; threads: MrThreadView[]; approvals: MrApprovalView[];
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

//? Mark the MR merged. The built-in record is the decision of record; a forge-backed MR
//? (externalUrl) is merged on the forge. Sets the ticket done when it has no next stage.
export async function mergeMr(prisma: PrismaClient, workspaceId: string, mergeRequestId: string): Promise<boolean> {
  const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId, id: mergeRequestId }, select: { id: true, status: true } });
  if (mr?.status !== 'open') return false;
  await prisma.mergeRequest.update({ where: { id: mr.id }, data: { status: 'merged', mergedAt: new Date() } });
  return true;
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
