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

export interface ForgeResult { ok: boolean; pushed: boolean; mrUrl?: string; error?: string }

//? Push (and optionally MR) a ticket's committed work per the workspace's pushPolicy. Gated:
//? 'local-only' does nothing; 'push' pushes; 'merge-request' pushes + opens an MR. A protected
//? target as the ticket branch is refused.
export async function pushTicketWork(prisma: PrismaClient, workspaceId: string, ticketKey: string): Promise<ForgeResult> {
  const [ws, project, ticket] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitlabUrl: true, gitlabTokenEnc: true, gitConfig: true } }),
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

  //? merge-request: open (or find an existing) MR via the GitLab REST API.
  const base = (ws.gitlabUrl ?? '').replace(/\/+$/, '');
  const path = project.gitlabPath;
  if (base.length === 0 || path.length === 0) return { ok: true, pushed: true, error: 'forge.noGitlabApi' };
  const [mrErr, mrUrl] = await tryCatch(() => openMergeRequest({ base, path, token, source: branch, target: cfg.targetBranch, title: ticket.title }));
  if (mrErr || mrUrl === null) return { ok: true, pushed: true, error: `forge.mrFailed: ${mrErr?.message ?? 'unknown'}` };
  await prisma.ticket.updateMany({ where: { workspaceId, key: ticketKey }, data: { mrUrl } });
  return { ok: true, pushed: true, mrUrl };
}

interface MrInput { base: string; path: string; token: string; source: string; target: string; title: string }

//? POST a new MR; on 409 (one already exists for this source branch) GET the open MR and reuse
//? its url. Returns the web_url or null. `PRIVATE-TOKEN` keeps the token out of the url/argv.
async function openMergeRequest(m: MrInput): Promise<string | null> {
  const proj = encodeURIComponent(m.path);
  //? External GitLab REST API (its own /api/v4) — not a framework `/api/*` route, so a raw fetch
  //? is correct here; a json() throw is caught by the caller's tryCatch.
  // eslint-disable-next-line luckystack/no-raw-fetch-in-src
  const res = await fetch(`${m.base}/api/v4/projects/${proj}/merge_requests`, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': m.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_branch: m.source, target_branch: m.target, title: m.title }),
  });
  if (res.ok) {
    const body = (await res.json()) as { web_url?: string };
    return body.web_url ?? null;
  }
  if (res.status === 409) {
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const list = await fetch(`${m.base}/api/v4/projects/${proj}/merge_requests?state=opened&source_branch=${encodeURIComponent(m.source)}`, { headers: { 'PRIVATE-TOKEN': m.token } });
    if (!list.ok) return null;
    const arr = (await list.json()) as { web_url?: string }[];
    return arr[0]?.web_url ?? null;
  }
  return null;
}
