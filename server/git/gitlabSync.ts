//? Forge issue ingestion (ADR 0036 — GitLab + GitHub) — pull a project's open issues and upsert
//? them as tickets, so the board is fed from the SOURCE forge rather than only quick-add. The
//? forge (GitLab | GitHub) + token + repoPath are resolved PER-PROJECT (`resolveForge`); new
//? issues enter at `unrefined` (the AI moves them on); existing tickets get their title/labels/
//? description refreshed WITHOUT touching their pipeline position. Best-effort: never throws.

import { tryCatch, getPrismaClient } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { broadcastTicketDelta } from '../read/broadcast';
import { isLeader } from '../orchestrator/cluster';
import { resolveForge, type ResolvedForge } from './forgeResolve';

const SYNC_INTERVAL_MS = Number(process.env.WS_GITLAB_SYNC_MIN ?? '5') * 60_000;

export interface GitlabSyncResult { ok: boolean; synced: number; keys: string[]; error?: string }

//? Normalized issue shape (both providers map into this): `iid` = the source issue number.
interface ForgeIssue { iid: number; title: string; description?: string | null; labels?: string[]; web_url?: string; state?: string }

//? Sync ONE project's open issues → tickets (`DEV-<iid>`). Returns the touched keys so the caller
//? can broadcast a live board delta. Dispatches to the GitLab or GitHub REST API per the project's
//? resolved forge (ADR 0036).
export async function syncForgeIssues(prisma: PrismaClient, workspaceId: string, projectId: string): Promise<GitlabSyncResult> {
  const forge = await resolveForge(prisma, workspaceId, projectId);
  if (!forge || forge.base.length === 0 || forge.repoPath.length === 0) return { ok: false, synced: 0, keys: [], error: 'forge.notConfigured' };
  if (!forge.token) return { ok: false, synced: 0, keys: [], error: 'forge.noToken' };

  const [err, issues] = await tryCatch(() => fetchIssues(forge));
  if (err || issues === null) return { ok: false, synced: 0, keys: [], error: `forge.fetchFailed: ${err?.message ?? 'unknown'}` };

  const keys: string[] = [];
  for (const issue of issues) {
    const key = `DEV-${String(issue.iid)}`;
    const common = { title: issue.title, description: issue.description ?? null, labels: issue.labels ?? [], issueUrl: issue.web_url ?? null };
    const existing = await prisma.ticket.findFirst({ where: { workspaceId, key }, select: { id: true } });
    await (existing
      ? prisma.ticket.updateMany({ where: { workspaceId, key }, data: common })
      : prisma.ticket.create({ data: { workspaceId, projectId, key, number: issue.iid, stageId: 'unrefined', status: 'idle', ...common } }));
    keys.push(key);
  }
  return { ok: true, synced: keys.length, keys };
}

//? Back-compat: sync the workspace's FIRST project (the single-project era's entry point). Kept for
//? the poller's per-workspace loop; multi-project callers pass an explicit projectId to syncForgeIssues.
export async function syncGitlabIssues(prisma: PrismaClient, workspaceId: string): Promise<GitlabSyncResult> {
  const project = await prisma.project.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!project) return { ok: false, synced: 0, keys: [], error: 'forge.notConfigured' };
  return syncForgeIssues(prisma, workspaceId, project.id);
}

function fetchIssues(forge: ResolvedForge): Promise<ForgeIssue[]> {
  return forge.mode === 'github' ? fetchGithubIssues(forge.base, forge.repoPath, forge.token ?? '') : fetchGitlabIssues(forge.base, forge.repoPath, forge.token ?? '');
}

async function fetchGitlabIssues(base: string, path: string, token: string): Promise<ForgeIssue[]> {
  //? External GitLab REST API (its own /api/v4) — not a framework `/api/*` route.
  // eslint-disable-next-line luckystack/no-raw-fetch-in-src
  const res = await fetch(`${base}/api/v4/projects/${encodeURIComponent(path)}/issues?state=opened&per_page=100`, { headers: { 'PRIVATE-TOKEN': token } });
  if (!res.ok) throw new Error(`gitlab ${String(res.status)}`);
  return (await res.json()) as ForgeIssue[];
}

interface GithubIssue { number: number; title: string; body?: string | null; labels?: { name?: string }[]; html_url?: string; state?: string; pull_request?: unknown }

//? Pure map of GitHub `/issues` rows → the normalized `ForgeIssue[]`. GitHub's `/issues` also
//? returns PRs, so entries carrying `pull_request` are filtered out (issues only). Exported for tests.
export function mapGithubIssues(rows: GithubIssue[]): ForgeIssue[] {
  return rows.filter((r) => r.pull_request === undefined).map((r) => ({
    iid: r.number, title: r.title, description: r.body ?? null,
    labels: (r.labels ?? []).map((l) => l.name ?? '').filter((n) => n.length > 0),
    web_url: r.html_url, state: r.state,
  }));
}

async function fetchGithubIssues(base: string, path: string, token: string): Promise<ForgeIssue[]> {
  //? External GitHub REST API — not a framework `/api/*` route. `path` = "owner/repo".
  // eslint-disable-next-line luckystack/no-raw-fetch-in-src
  const res = await fetch(`${base}/repos/${path}/issues?state=open&per_page=100`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`github ${String(res.status)}`);
  return mapGithubIssues((await res.json()) as GithubIssue[]);
}

//? Push-back — post a comment on the ticket's source issue (the AI reporting an MR opened / the
//? pipeline finished). Best-effort; the ticket's `number` is the source issue number. Provider-aware
//? per the ticket's project forge (ADR 0036).
export async function postIssueComment(prisma: PrismaClient, workspaceId: string, ticketKey: string, body: string): Promise<boolean> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { number: true, projectId: true } });
  if (!ticket) return false;
  const forge = await resolveForge(prisma, workspaceId, ticket.projectId);
  if (!forge || forge.base.length === 0 || forge.repoPath.length === 0 || !forge.token) return false;
  const token = forge.token;
  const [err, ok] = await tryCatch(async () => {
    const url = forge.mode === 'github'
      ? `${forge.base}/repos/${forge.repoPath}/issues/${String(ticket.number)}/comments`
      : `${forge.base}/api/v4/projects/${encodeURIComponent(forge.repoPath)}/issues/${String(ticket.number)}/notes`;
    const headers = forge.mode === 'github'
      ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
      : { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' };
    //? External forge REST API — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ body }) });
    return res.ok;
  });
  return !err && ok === true;
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

//? Continuous sync — poll every project with a resolvable forge on a timer and upsert its issues
//? (no webhook infra needed). Broadcasts touched tickets so boards stay live. Started at boot.
export function startGitlabSyncPoller(): void {
  if (syncTimer) return;
  syncTimer = setInterval(() => { void pollLinkedProjects(); }, SYNC_INTERVAL_MS);
}

async function pollLinkedProjects(): Promise<void> {
  //? Only the leader instance polls — otherwise N instances each hammer the forge API.
  if (!isLeader()) return;
  const prisma = getPrismaClient();
  //? Multi-project (ADR 0035/0036): iterate every project; `syncForgeIssues` no-ops a project
  //? with no resolvable forge, so this covers both a per-project ForgeConnection and the
  //? workspace-GitLab fallback without a per-workspace pre-filter.
  const [err, projects] = await tryCatch(() => prisma.project.findMany({ select: { id: true, workspaceId: true } }));
  if (err || projects === null) return;
  for (const p of projects) {
    const res = await syncForgeIssues(prisma, p.workspaceId, p.id);
    if (res.ok && res.keys.length > 0) await broadcastTicketDelta(prisma, p.workspaceId, res.keys);
  }
}
