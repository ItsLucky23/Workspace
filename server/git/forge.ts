//? Push-on-approval (Track F). After the AI has committed on a ticket's DEV-branch, push it to
//? origin and — for pushPolicy 'merge-request' — open (or find) a GitLab MR against the target
//? branch. Token-safe: the workspace GitLab token is decrypted ONLY here and injected
//? transiently (the git `withAuth` url + the MR `PRIVATE-TOKEN` header) — never stored or
//? logged (git errors are token-scrubbed). Never throws into the caller: returns a result.

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { normalizeGitConfig } from './branchStrategy';
import { pushBranch, pushRef } from './repoStore';
import { resolveForge, type ResolvedForge } from './forgeResolve';
import { openForgeMergeRequest } from './forgeProvider';

export interface ForgeResult {
  ok: boolean;
  pushed: boolean;
  ticketId?: string;
  projectId?: string;
  branch?: string;
  mrUrl?: string;
  error?: string;
}

export interface PushTicketExpectation {
  ticketId: string;
  projectId: string;
  branch: string;
  assertAuthority?: () => Promise<void>;
}

export interface PushTicketWorkDependencies {
  push: typeof pushBranch;
  resolve: (prisma: PrismaClient, workspaceId: string, projectId: string) => Promise<ResolvedForge | null>;
  openMr: typeof openForgeMergeRequest;
}

const DEFAULT_PUSH_DEPENDENCIES: PushTicketWorkDependencies = {
  push: pushBranch,
  resolve: resolveForge,
  openMr: openForgeMergeRequest,
};

//? The outcome of pushing a server-side merge/revert result to origin (C1). `skipped` = the project
//? has no forge configured (local-only workspace), which is NOT an error — the local merge is
//? authoritative and the push is simply not applicable. `error` = a real push failure to surface.
export interface TargetPushResult { pushed: boolean; skipped?: boolean; error?: string }

//? Push a target branch to origin after a server-side merge/revert of a ticket's MR (C1). Resolves
//? the ticket's project git URL + the per-project forge token, then pushes the bare-repo `target`
//? ref (with retry/backoff). Never throws — the merge already landed locally; this reports whether
//? the forge received it so a failure is visible without rolling back the authoritative local merge.
export async function pushMergedTarget(prisma: PrismaClient, workspaceId: string, ticketId: string, targetBranch: string): Promise<TargetPushResult> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, id: ticketId }, select: { projectId: true } });
  if (!ticket) return { pushed: false, skipped: true };
  const project = await prisma.project.findFirst({ where: { id: ticket.projectId, workspaceId }, select: { gitUrl: true } });
  const forge = await resolveForge(prisma, workspaceId, ticket.projectId);
  const gitUrl = project?.gitUrl;
  const token = forge?.token;
  //? No remote configured → local-only workspace; the merge stands, nothing to push.
  if (!gitUrl || !token) return { pushed: false, skipped: true };
  const [pushErr] = await tryCatch(() => pushRef({ workspaceId, projectId: ticket.projectId, gitUrl, token, ref: targetBranch }));
  if (pushErr) return { pushed: false, error: `forge.pushFailed: ${pushErr.message}` };
  return { pushed: true };
}

//? Push (and optionally MR) a ticket's committed work per the workspace's pushPolicy. Gated:
//? 'local-only' does nothing; 'push' pushes; 'merge-request' pushes + opens an MR. A protected
//? target as the ticket branch is refused. The forge (GitLab | GitHub) is resolved PER-PROJECT
//? from the ticket's project (ADR 0036) — a ForgeConnection, else the workspace GitLab fields.
export async function pushTicketWork(
  prisma: PrismaClient,
  workspaceId: string,
  ticketKey: string,
  expected: PushTicketExpectation,
  dependencies: PushTicketWorkDependencies = DEFAULT_PUSH_DEPENDENCIES,
): Promise<ForgeResult> {
  const [workspace, ticket] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitConfig: true } }),
    prisma.ticket.findFirst({
      where: { workspaceId, id: expected.ticketId, projectId: expected.projectId, key: ticketKey },
      select: { id: true, branch: true, title: true, projectId: true },
    }),
  ]);
  if (!workspace || ticket?.branch !== expected.branch) return { ok: false, pushed: false, error: 'forge.notFound' };
  const cfg = normalizeGitConfig(workspace.gitConfig ?? null);
  const common = { ticketId: ticket.id, projectId: ticket.projectId, branch: expected.branch };
  if (cfg.pushPolicy === 'local-only') return { ok: true, pushed: false, ...common };
  if (cfg.protectedBranches.includes(expected.branch)) return { ok: false, pushed: false, error: 'forge.protectedBranch', ...common };

  const project = await prisma.project.findFirst({
    where: { id: expected.projectId, workspaceId },
    select: { gitUrl: true },
  });
  const forge = await dependencies.resolve(prisma, workspaceId, expected.projectId);
  const gitUrl = project?.gitUrl;
  if (!gitUrl || !forge) return { ok: false, pushed: false, error: 'forge.notActivated', ...common };
  const token = forge.token;
  if (!token) return { ok: false, pushed: false, error: 'forge.noToken', ...common };

  //? Last reversible checkpoint: forge resolution may have taken time. Re-read the
  //? exact ticket/project/branch immediately before the first external call so a
  //? promote/relink/branch race fails without pushing anything.
  const stillExpected = await prisma.ticket.findFirst({
    where: {
      workspaceId,
      id: expected.ticketId,
      projectId: expected.projectId,
      key: ticketKey,
      branch: expected.branch,
    },
    select: { id: true },
  });
  if (!stillExpected) return { ok: false, pushed: false, error: 'forge.targetChanged', ...common };
  if (expected.assertAuthority) await expected.assertAuthority();

  const [pushErr] = await tryCatch(() => dependencies.push({ workspaceId, projectId: expected.projectId, ticketKey, gitUrl, token, branch: expected.branch }));
  if (pushErr) return { ok: false, pushed: false, error: `forge.pushFailed: ${pushErr.message}`, ...common };
  if (cfg.pushPolicy === 'push') return { ok: true, pushed: true, ...common };

  //? Revalidate again between git push and forge HTTP. The renewable capacity guard
  //? stays active throughout, and exact project/branch identity cannot drift mid-flight.
  const beforeMr = await prisma.ticket.findFirst({
    where: {
      workspaceId,
      id: expected.ticketId,
      projectId: expected.projectId,
      key: ticketKey,
      branch: expected.branch,
    },
    select: { id: true },
  });
  if (!beforeMr) return { ok: false, pushed: true, error: 'forge.targetChanged', ...common };
  if (expected.assertAuthority) await expected.assertAuthority();

  //? External-only: open/find the MR, but never persist its URL here. The stage-forge-complete
  //? InternalOp revalidates ticket/project/branch/session CAS before the Conductor writes it.
  if (forge.base.length === 0 || forge.repoPath.length === 0) return { ok: true, pushed: true, error: 'forge.noForgeApi', ...common };
  const [mrErr, mrUrl] = await tryCatch(() => dependencies.openMr(forge.mode, {
    base: forge.base,
    path: forge.repoPath,
    token,
    source: expected.branch,
    target: cfg.targetBranch,
    title: ticket.title,
  }));
  if (mrErr || mrUrl === null) return { ok: true, pushed: true, error: `forge.mrFailed: ${mrErr?.message ?? 'unknown'}`, ...common };
  return { ok: true, pushed: true, mrUrl, ...common };
}
