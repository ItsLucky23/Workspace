//? Push-on-approval (Track F). After the AI has committed on a ticket's DEV-branch, push it to
//? origin and — for pushPolicy 'merge-request' — open (or find) a GitLab MR against the target
//? branch. Token-safe: the workspace GitLab token is decrypted ONLY here and injected
//? transiently (the git `withAuth` url + the MR `PRIVATE-TOKEN` header) — never stored or
//? logged (git errors are token-scrubbed). Never throws into the caller: returns a result.

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { decryptSecret } from '../crypto/secretBox';
import { normalizeGitConfig } from './branchStrategy';
import { pushBranch } from './repoStore';
import { postIssueComment } from './gitlabSync';
import { openForgeMergeRequest, type ForgeType } from './forgeProvider';

//? Narrow the workspace's stored forge type (defaults to gitlab for any legacy/blank value).
const asForgeType = (s: string | null | undefined): ForgeType => (s === 'github' ? 'github' : 'gitlab');
//? The default API base per provider when the workspace didn't set one (github.com's API host).
const forgeBase = (type: ForgeType, gitlabUrl: string | null): string => {
  const set = (gitlabUrl ?? '').replace(/\/+$/, '');
  if (set.length > 0) return set;
  return type === 'github' ? 'https://api.github.com' : '';
};

export interface ForgeResult { ok: boolean; pushed: boolean; mrUrl?: string; error?: string }

//? Push (and optionally MR) a ticket's committed work per the workspace's pushPolicy. Gated:
//? 'local-only' does nothing; 'push' pushes; 'merge-request' pushes + opens an MR. A protected
//? target as the ticket branch is refused.
export async function pushTicketWork(prisma: PrismaClient, workspaceId: string, ticketKey: string): Promise<ForgeResult> {
  const [ws, project, ticket] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { forgeType: true, gitlabUrl: true, gitlabTokenEnc: true, gitConfig: true } }),
    prisma.project.findFirst({ where: { workspaceId }, select: { gitUrl: true, gitlabPath: true } }),
    prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { branch: true, title: true } }),
  ]);
  if (!ws || !project || !ticket) return { ok: false, pushed: false, error: 'forge.notFound' };
  const cfg = normalizeGitConfig(ws.gitConfig ?? null);
  if (cfg.pushPolicy === 'local-only') return { ok: true, pushed: false };
  const branch = ticket.branch;
  const gitUrl = project.gitUrl;
  if (!branch || !gitUrl) return { ok: false, pushed: false, error: 'forge.notActivated' };
  if (cfg.protectedBranches.includes(branch)) return { ok: false, pushed: false, error: 'forge.protectedBranch' };
  const token = ws.gitlabTokenEnc ? decryptSecret(ws.gitlabTokenEnc) : null;
  if (!token) return { ok: false, pushed: false, error: 'forge.noToken' };

  const [pushErr] = await tryCatch(() => pushBranch({ workspaceId, ticketKey, gitUrl, token, branch }));
  if (pushErr) return { ok: false, pushed: false, error: `forge.pushFailed: ${pushErr.message}` };
  if (cfg.pushPolicy === 'push') return { ok: true, pushed: true };

  //? merge-request: open (or find an existing) MR/PR via the resolved forge provider (GitLab | GitHub).
  const type = asForgeType(ws.forgeType);
  const base = forgeBase(type, ws.gitlabUrl);
  const path = project.gitlabPath;
  if (base.length === 0 || path.length === 0) return { ok: true, pushed: true, error: 'forge.noForgeApi' };
  const [mrErr, mrUrl] = await tryCatch(() => openForgeMergeRequest(type, { base, path, token, source: branch, target: cfg.targetBranch, title: ticket.title }));
  if (mrErr || mrUrl === null) return { ok: true, pushed: true, error: `forge.mrFailed: ${mrErr?.message ?? 'unknown'}` };
  await prisma.ticket.updateMany({ where: { workspaceId, key: ticketKey }, data: { mrUrl } });
  //? Push-back: report the MR on the source GitLab issue (best-effort, off the caller's path).
  void postIssueComment(prisma, workspaceId, ticketKey, `🤖 AI opened a merge request: ${mrUrl}`);
  return { ok: true, pushed: true, mrUrl };
}
