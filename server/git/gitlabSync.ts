//? GitLab issue ingestion (Fase 2) — pull the linked project's open issues and upsert them as
//? tickets, so the board is fed from the SOURCE (GitLab) rather than only quick-add. Reuses the
//? forge token model (decrypt only here, `PRIVATE-TOKEN` header). New issues enter at
//? `unrefined` (the AI moves them on); existing tickets get their title/labels/description
//? refreshed WITHOUT touching their pipeline position. Best-effort: never throws into the caller.

import { tryCatch, getPrismaClient } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { decryptSecret } from '../crypto/secretBox';
import { broadcastTicketDelta } from '../read/broadcast';

const SYNC_INTERVAL_MS = Number(process.env.WS_GITLAB_SYNC_MIN ?? '5') * 60_000;

export interface GitlabSyncResult { ok: boolean; synced: number; keys: string[]; error?: string }

interface GitlabIssue { iid: number; title: string; description?: string | null; labels?: string[]; web_url?: string; state?: string }

//? Fetch the project's open issues + upsert them by `DEV-<iid>`. Returns the touched keys so the
//? caller can broadcast a live board delta.
export async function syncGitlabIssues(prisma: PrismaClient, workspaceId: string): Promise<GitlabSyncResult> {
  const [ws, project] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitlabUrl: true, gitlabTokenEnc: true } }),
    prisma.project.findFirst({ where: { workspaceId }, select: { id: true, gitlabPath: true } }),
  ]);
  const base = (ws?.gitlabUrl ?? '').replace(/\/+$/, '');
  const path = project?.gitlabPath ?? '';
  if (base.length === 0 || path.length === 0 || !project) return { ok: false, synced: 0, keys: [], error: 'gitlab.notConfigured' };
  const token = ws?.gitlabTokenEnc ? decryptSecret(ws.gitlabTokenEnc) : null;
  if (!token) return { ok: false, synced: 0, keys: [], error: 'gitlab.noToken' };

  const [err, issues] = await tryCatch(() => fetchOpenIssues(base, path, token));
  if (err || issues === null) return { ok: false, synced: 0, keys: [], error: `gitlab.fetchFailed: ${err?.message ?? 'unknown'}` };

  const keys: string[] = [];
  for (const issue of issues) {
    const key = `DEV-${String(issue.iid)}`;
    const common = { title: issue.title, description: issue.description ?? null, labels: issue.labels ?? [], issueUrl: issue.web_url ?? null };
    const existing = await prisma.ticket.findFirst({ where: { workspaceId, key }, select: { id: true } });
    await (existing
      ? prisma.ticket.updateMany({ where: { workspaceId, key }, data: common })
      : prisma.ticket.create({ data: { workspaceId, projectId: project.id, key, number: issue.iid, stageId: 'unrefined', status: 'idle', ...common } }));
    keys.push(key);
  }
  return { ok: true, synced: keys.length, keys };
}

async function fetchOpenIssues(base: string, path: string, token: string): Promise<GitlabIssue[]> {
  //? External GitLab REST API (its own /api/v4) — not a framework `/api/*` route.
  // eslint-disable-next-line luckystack/no-raw-fetch-in-src
  const res = await fetch(`${base}/api/v4/projects/${encodeURIComponent(path)}/issues?state=opened&per_page=100`, { headers: { 'PRIVATE-TOKEN': token } });
  if (!res.ok) throw new Error(`gitlab ${String(res.status)}`);
  return (await res.json()) as GitlabIssue[];
}

//? Push-back — post a comment on the ticket's GitLab issue (the AI reporting its state back to
//? the source: an MR opened, the pipeline finished). Best-effort; the ticket's `number` is the
//? issue iid. Returns whether the note was posted.
export async function postIssueComment(prisma: PrismaClient, workspaceId: string, ticketKey: string, body: string): Promise<boolean> {
  const [ws, project, ticket] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { gitlabUrl: true, gitlabTokenEnc: true } }),
    prisma.project.findFirst({ where: { workspaceId }, select: { gitlabPath: true } }),
    prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { number: true } }),
  ]);
  const base = (ws?.gitlabUrl ?? '').replace(/\/+$/, '');
  const path = project?.gitlabPath ?? '';
  const token = ws?.gitlabTokenEnc ? decryptSecret(ws.gitlabTokenEnc) : null;
  if (base.length === 0 || path.length === 0 || token === null || !ticket) return false;
  const [err, ok] = await tryCatch(async () => {
    //? External GitLab REST API — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const res = await fetch(`${base}/api/v4/projects/${encodeURIComponent(path)}/issues/${String(ticket.number)}/notes`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    return res.ok;
  });
  return !err && ok === true;
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

//? Continuous sync — poll every workspace with a linked GitLab repo on a timer and upsert its
//? issues (no webhook infra needed). Broadcasts touched tickets so boards stay live. Started at
//? boot. A webhook-driven push model is a later refinement for lower latency / fewer API calls.
export function startGitlabSyncPoller(): void {
  if (syncTimer) return;
  syncTimer = setInterval(() => { void pollLinkedWorkspaces(); }, SYNC_INTERVAL_MS);
}

async function pollLinkedWorkspaces(): Promise<void> {
  const prisma = getPrismaClient();
  const [err, workspaces] = await tryCatch(() => prisma.workspace.findMany({ where: { gitlabTokenEnc: { not: null }, gitlabUrl: { not: null } }, select: { id: true } }));
  if (err || workspaces === null) return;
  for (const ws of workspaces) {
    const res = await syncGitlabIssues(prisma, ws.id);
    if (res.ok && res.keys.length > 0) await broadcastTicketDelta(prisma, ws.id, res.keys);
  }
}
