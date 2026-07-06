//? Push-on-approval (Track F). After the AI has committed on a ticket's DEV-branch, push it to
//? origin and — for pushPolicy 'merge-request' — open (or find) a GitLab MR against the target
//? branch. Token-safe: the workspace GitLab token is decrypted ONLY here and injected
//? transiently (the git `withAuth` url + the MR `PRIVATE-TOKEN` header) — never stored or
//? logged (git errors are token-scrubbed). Never throws into the caller: returns a result.

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { normalizeGitConfig } from './branchStrategy';
import { pushBranch } from './repoStore';
import { postIssueComment } from './gitlabSync';
import { resolveForge } from './forgeResolve';
import { openForgeMergeRequest } from './forgeProvider';

export interface ForgeResult { ok: boolean; pushed: boolean; mrUrl?: string; error?: string }

//? Push (and optionally MR) a ticket's committed work per the workspace's pushPolicy. Gated:
//? 'local-only' does nothing; 'push' pushes; 'merge-request' pushes + opens an MR. A protected
//? target as the ticket branch is refused. The forge (GitLab | GitHub) is resolved PER-PROJECT
//? from the ticket's project (ADR 0036) — a ForgeConnection, else the workspace GitLab fields.
export async function pushTicketWork(prisma: PrismaClient, workspaceId: string, ticketKey: string): Promise<ForgeResult> {
  const [ws, ticket] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitConfig: true } }),
    prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { branch: true, title: true, projectId: true } }),
  ]);
  if (!ws || !ticket) return { ok: false, pushed: false, error: 'forge.notFound' };
  const cfg = normalizeGitConfig(ws.gitConfig ?? null);
  if (cfg.pushPolicy === 'local-only') return { ok: true, pushed: false };
  const branch = ticket.branch;
  if (!branch) return { ok: false, pushed: false, error: 'forge.notActivated' };
  if (cfg.protectedBranches.includes(branch)) return { ok: false, pushed: false, error: 'forge.protectedBranch' };

  const project = await prisma.project.findFirst({ where: { id: ticket.projectId }, select: { gitUrl: true } });
  const forge = await resolveForge(prisma, workspaceId, ticket.projectId);
  const gitUrl = project?.gitUrl;
  if (!gitUrl || !forge) return { ok: false, pushed: false, error: 'forge.notActivated' };
  const token = forge.token;
  if (!token) return { ok: false, pushed: false, error: 'forge.noToken' };

  const [pushErr] = await tryCatch(() => pushBranch({ workspaceId, ticketKey, gitUrl, token, branch }));
  if (pushErr) return { ok: false, pushed: false, error: `forge.pushFailed: ${pushErr.message}` };
  if (cfg.pushPolicy === 'push') return { ok: true, pushed: true };

  //? merge-request: open (or find an existing) MR/PR via the resolved forge provider (GitLab | GitHub).
  if (forge.base.length === 0 || forge.repoPath.length === 0) return { ok: true, pushed: true, error: 'forge.noForgeApi' };
  const [mrErr, mrUrl] = await tryCatch(() => openForgeMergeRequest(forge.mode, { base: forge.base, path: forge.repoPath, token, source: branch, target: cfg.targetBranch, title: ticket.title }));
  if (mrErr || mrUrl === null) return { ok: true, pushed: true, error: `forge.mrFailed: ${mrErr?.message ?? 'unknown'}` };
  await prisma.ticket.updateMany({ where: { workspaceId, key: ticketKey }, data: { mrUrl } });
  //? Push-back: report the MR on the source issue (best-effort, off the caller's path).
  void postIssueComment(prisma, workspaceId, ticketKey, `🤖 AI opened a merge request: ${mrUrl}`);
  return { ok: true, pushed: true, mrUrl };
}
