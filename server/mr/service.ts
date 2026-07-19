//? Built-in merge-request review service (BUILTIN_MR_REVIEW). The operations behind the MR control-
//? ops + the read the frontend renders: open an MR from a ticket's branch, compute its diff, thread
//? + comment on lines, approve (stale on new head), merge, resolve threads. Explicit-workspaceId
//? prisma style (matches the orchestrator). Never throws catastrophically; returns nulls the caller
//? maps to error codes.

import type { PrismaClient, MergeRequest } from '@prisma/client';

import { normalizeGitConfig } from '../git/branchStrategy';
import { branchDiff, branchHead, mergeBranches, revertMergeCommit } from '../git/repoStore';
import { pushMergedTarget } from '../git/forge';
import { ciGateForMr, allowMergeOnRedCI } from '../ci/gate';
import { SEVERITY_RANK } from '../ci/security';
import { parseUnifiedDiff, type MrDiff } from './diff';

//? The outcome of a merge/rollback attempt — the caller maps `reason` to a UI message. `conflict`
//? carries the unmerged files. Never throws; the real git-merge is done under the caller's lease.
export type MergeMrResult =
  | { ok: true; sha?: string; pushed?: boolean; pushError?: string }
  | { ok: false; reason: 'not-open' | 'no-approval' | 'ci-red' | 'ci-running' | 'ci-stale' | 'conflict' | 'not-linked' | 'nothing-to-merge' | 'error'; files?: string[]; message?: string };

export interface MrThreadView {
  id: string; filePath: string | null; line: number | null; side: string; resolved: boolean;
  comments: { id: string; authorId: string | null; authorKind: string; body: string; createdAt: string }[];
}
export interface MrApprovalView { userId: string; stale: boolean; createdAt: string }
//? The transient outcome of a merge/rollback attached to the returned view so the client can toast
//? success or the reason it was blocked (no-approval / conflict + files). Not persisted.
export interface MrActionOutcome { ok: boolean; reason?: string; files?: string[] }
export interface MrCheckJob { name: string; status: string; severity: string | null }
export interface MrCheckFinding { severity: string; title: string }
//? Per-service CI: `status`/`jobs`/`findings` stay the ROLLED-UP view (the worst verdict across units — a
//? green sibling must never read as "the MR is green"), and `units` carries the attributable breakdown.
export interface MrCheckUnit { serviceId: string | null; serviceName: string; status: string; maxSeverity: string | null; jobs: MrCheckJob[] }
export interface MrChecks { status: string; maxSeverity: string | null; jobs: MrCheckJob[]; findings: MrCheckFinding[]; units: MrCheckUnit[] }
export interface MrView {
  id: string; number: number; title: string; status: string; sourceBranch: string; targetBranch: string;
  headSha: string | null; externalUrl: string | null; mergeStrategy: string;
  diff: MrDiff; threads: MrThreadView[]; approvals: MrApprovalView[];
  actionResult?: MrActionOutcome; checks?: MrChecks;
}

//? #52 — parse a PipelineJob.findings Json (SecurityFinding[] = {id,severity,title}) defensively.
function parseFindings(raw: unknown): MrCheckFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: MrCheckFinding[] = [];
  for (const f of raw) {
    if (f !== null && typeof f === 'object') {
      const rec = f as Record<string, unknown>;
      if (typeof rec.severity === 'string' && typeof rec.title === 'string') out.push({ severity: rec.severity, title: rec.title });
    }
  }
  return out.slice(0, 50);
}

//? Open (or refresh) the MR for a ticket's branch → the workspace's target branch. Idempotent per
//? open MR; refreshes headSha when the branch advanced. Returns null if the ticket has no branch yet.
export async function createMr(prisma: PrismaClient, workspaceId: string, ticketKey: string, authorId?: string): Promise<MergeRequest | null> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { id: true, projectId: true, title: true, branch: true } });
  if (!ticket?.branch) return null;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitConfig: true } });
  const cfg = normalizeGitConfig(ws?.gitConfig ?? null);
  const source = ticket.branch;
  const headSha = await branchHead(workspaceId, ticket.projectId, source);

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

  const outcome = await mergeBranches(workspaceId, mr.projectId, mr.targetBranch, mr.sourceBranch, mr.mergeStrategy);
  if (!outcome.ok) {
    if (outcome.conflict) {
      await prisma.mergeRequest.update({ where: { id: mr.id }, data: { status: 'conflict' } });
      return { ok: false, reason: 'conflict', files: outcome.files };
    }
    if (outcome.error === 'not-linked') return { ok: false, reason: 'not-linked' };
    return { ok: false, reason: 'error', message: outcome.error };
  }
  await prisma.mergeRequest.update({ where: { id: mr.id }, data: { status: 'merged', mergedAt: new Date(), mergedSha: outcome.sha } });
  //? C1: the merge advanced `target` in the bare clone — push it to origin so the forge ref
  //? receives it. Non-fatal: the local merge is authoritative; a push failure is surfaced, not rolled back.
  const push = await pushMergedTarget(prisma, workspaceId, mr.ticketId, mr.targetBranch);
  return { ok: true, sha: outcome.sha, pushed: push.pushed, ...(push.error ? { pushError: push.error } : {}) };
}

//? Roll a merged MR back with a git-revert (#9) — reverts the recorded merge commit on the target
//? (history-preserving, never a destructive reset) and reopens the MR so it can be re-reviewed. Runs
//? under the caller's lease. No-op with a reason when the MR isn't a merged one we can revert.
export async function rollbackMr(prisma: PrismaClient, workspaceId: string, mergeRequestId: string): Promise<MergeMrResult> {
  const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId, id: mergeRequestId } });
  if (mr?.status !== 'merged' || !mr.mergedSha) return { ok: false, reason: 'not-open' };
  const outcome = await revertMergeCommit(workspaceId, mr.projectId, mr.targetBranch, mr.mergedSha);
  if (!outcome.ok) return { ok: false, reason: outcome.error === 'not-linked' ? 'not-linked' : 'error', message: outcome.error };
  //? Reopen for re-review; drop the recorded merge sha (the revert is now the target tip).
  await prisma.mergeRequest.update({ where: { id: mr.id }, data: { status: 'open', mergedAt: null, mergedSha: null } });
  //? C1: the revert advanced `target` in the bare clone — push it so the forge ref reflects the rollback.
  const push = await pushMergedTarget(prisma, workspaceId, mr.ticketId, mr.targetBranch);
  return { ok: true, sha: outcome.sha, pushed: push.pushed, ...(push.error ? { pushError: push.error } : {}) };
}

//? The full MR view for the frontend: fresh diff + threads (with comments) + approvals (staleness
//? computed against the current head). Returns null when the ticket has no MR.
export async function mrForTicket(prisma: PrismaClient, workspaceId: string, ticketKey: string): Promise<MrView | null> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { id: true } });
  if (!ticket) return null;
  const mr = await prisma.mergeRequest.findFirst({ where: { workspaceId, ticketId: ticket.id }, orderBy: { createdAt: 'desc' } });
  if (!mr) return null;

  const raw = await branchDiff(workspaceId, mr.projectId, mr.targetBranch, mr.sourceBranch);
  const diff = parseUnifiedDiff(raw);

  const threadRows = await prisma.reviewThread.findMany({ where: { workspaceId, mergeRequestId: mr.id }, orderBy: { createdAt: 'asc' } });
  const commentRows = await prisma.reviewComment.findMany({ where: { workspaceId, mergeRequestId: mr.id }, orderBy: { createdAt: 'asc' } });
  const threads: MrThreadView[] = threadRows.map((t) => ({
    id: t.id, filePath: t.filePath, line: t.line, side: t.side, resolved: t.resolved,
    comments: commentRows.filter((c) => c.threadId === t.id).map((c) => ({ id: c.id, authorId: c.authorId, authorKind: c.authorKind, body: c.body, createdAt: c.createdAt.toISOString() })),
  }));

  const approvalRows = await prisma.approval.findMany({ where: { workspaceId, mergeRequestId: mr.id } });
  const approvals: MrApprovalView[] = approvalRows.map((a) => ({ userId: a.userId, stale: (a.headSha ?? '') !== (mr.headSha ?? ''), createdAt: a.createdAt.toISOString() }));

  //? #51/#52 — the CI runs for this MR + their jobs + parsed findings, for the panel's Checks section.
  //?
  //? Per-service CI: taking only the NEWEST run collapsed a monorepo's units into whichever finished last,
  //? so a red service could be reported as green purely by ordering. Every unit's newest run is read, the
  //? panel shows them individually, and the headline status is the WORST of them.
  const runRows = await prisma.pipelineRun.findMany({ where: { workspaceId, mergeRequestId: mr.id }, orderBy: { startedAt: 'desc' }, take: 100 });
  const latestPerUnit = new Map<string, (typeof runRows)[number]>();
  for (const row of runRows) {
    const unit = row.serviceId ?? 'root';
    if (!latestPerUnit.has(unit)) latestPerUnit.set(unit, row);
  }

  let checks: MrChecks | undefined;
  if (latestPerUnit.size > 0) {
    const serviceRows = await prisma.service.findMany({ where: { workspaceId, projectId: mr.projectId }, select: { id: true, name: true } });
    const serviceName = new Map(serviceRows.map((row) => [row.id, row.name]));

    const units: MrCheckUnit[] = [];
    const allJobs: MrCheckJob[] = [];
    const allFindings: MrCheckFinding[] = [];
    for (const run of latestPerUnit.values()) {
      const jobRows = await prisma.pipelineJob.findMany({ where: { workspaceId, pipelineRunId: run.id } });
      const jobs = jobRows.map((j) => ({ name: j.name, status: j.status, severity: j.severity }));
      units.push({
        serviceId: run.serviceId,
        //? A unit whose Service row was deleted after its run still has to be nameable, or the panel shows
        //? an anonymous red check nobody can act on.
        serviceName: run.serviceId === null ? 'root' : serviceName.get(run.serviceId) ?? run.serviceId,
        status: run.status, maxSeverity: run.maxSeverity, jobs,
      });
      allJobs.push(...jobs);
      allFindings.push(...jobRows.flatMap((j) => parseFindings(j.findings)));
    }

    //? The roll-up: any non-success unit decides the headline. "Running" only wins when nothing failed.
    const failed = units.find((u) => u.status !== 'success' && u.status !== 'running' && u.status !== 'canceled');
    const running = units.find((u) => u.status === 'running');
    const status = failed?.status ?? (running ? 'running' : 'success');
    let maxSeverity: string | null = null;
    for (const unit of units) {
      if ((SEVERITY_RANK[unit.maxSeverity ?? 'none'] ?? 0) > (SEVERITY_RANK[maxSeverity ?? 'none'] ?? 0)) maxSeverity = unit.maxSeverity;
    }

    checks = { status, maxSeverity, jobs: allJobs, findings: allFindings, units };
  }

  return {
    id: mr.id, number: mr.number, title: mr.title, status: mr.status, sourceBranch: mr.sourceBranch, targetBranch: mr.targetBranch,
    headSha: mr.headSha, externalUrl: mr.externalUrl, mergeStrategy: mr.mergeStrategy, diff, threads, approvals,
    ...(checks ? { checks } : {}),
  };
}
