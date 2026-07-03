//? GitLab issue ingestion (Fase 2) — pull the linked project's open issues and upsert them as
//? tickets, so the board is fed from the SOURCE (GitLab) rather than only quick-add. Reuses the
//? forge token model (decrypt only here, `PRIVATE-TOKEN` header). New issues enter at
//? `unrefined` (the AI moves them on); existing tickets get their title/labels/description
//? refreshed WITHOUT touching their pipeline position. Best-effort: never throws into the caller.

import { tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { decryptSecret } from '../crypto/secretBox';

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
