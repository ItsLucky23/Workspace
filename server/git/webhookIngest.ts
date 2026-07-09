//? Forge webhook ingest (#10). The GitLab issue sync is poll-based (startGitlabSyncPoller); a
//? webhook gives CONTINUOUS, low-latency ingest — the forge POSTs on every issue change and we
//? upsert the matching ticket immediately. Supports GitLab + GitHub issue events, normalized to one
//? shape. The PARSE is pure (unit-testable without a DB); the ingest upserts + returns the touched
//? key so the caller broadcasts a live board delta.

import type { PrismaClient } from '@prisma/client';

//? A normalized issue event across providers.
export interface ForgeIssueEvent {
  kind: 'issue' | 'ignored';
  iid: number;
  action: 'open' | 'update' | 'close' | 'reopen' | 'other';
  title: string;
  description: string | null;
  labels: string[];
  url: string | null;
  state: string;
  //? R3 — the source repo identity (GitLab `path_with_namespace` / GitHub `full_name`), so a multi-project
  //? workspace routes the issue to the RIGHT project instead of always the first (the multi-repo #8 gap).
  repo: string | null;
}

const IGNORED: ForgeIssueEvent = { kind: 'ignored', iid: 0, action: 'other', title: '', description: null, labels: [], url: null, state: '', repo: null };

function strArr(v: unknown, key: 'title' | 'name'): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((l): unknown => (l !== null && typeof l === 'object' ? (l as Record<string, unknown>)[key] : l)).filter((x): x is string => typeof x === 'string');
}

//? Map a provider's issue action verb → the normalized action.
function normAction(raw: string): ForgeIssueEvent['action'] {
  const a = raw.toLowerCase();
  if (a === 'open' || a === 'opened') return 'open';
  if (a === 'close' || a === 'closed') return 'close';
  if (a === 'reopen' || a === 'reopened') return 'reopen';
  if (a === 'update' || a === 'updated' || a === 'edited' || a === 'labeled' || a === 'unlabeled') return 'update';
  return 'other';
}

//? Parse a webhook body into a normalized issue event. `eventHeader` is GitHub's `X-GitHub-Event`
//? (absent for GitLab). Non-issue events → `ignored`. Pure.
export function parseWebhookEvent(body: unknown, eventHeader?: string): ForgeIssueEvent {
  if (body === null || typeof body !== 'object') return IGNORED;
  const b = body as Record<string, unknown>;

  //? GitHub: identified by the X-GitHub-Event header; the issue lives under `issue`.
  if (eventHeader) {
    if (eventHeader !== 'issues') return IGNORED;
    const issue = b.issue;
    if (issue === null || typeof issue !== 'object') return IGNORED;
    const i = issue as Record<string, unknown>;
    if (typeof i.number !== 'number') return IGNORED;
    const repo = b.repository !== null && typeof b.repository === 'object' ? (b.repository as Record<string, unknown>).full_name : null;
    return {
      kind: 'issue', iid: i.number, action: normAction(typeof b.action === 'string' ? b.action : ''),
      title: typeof i.title === 'string' ? i.title : '', description: typeof i.body === 'string' ? i.body : null,
      labels: strArr(i.labels, 'name'), url: typeof i.html_url === 'string' ? i.html_url : null,
      state: typeof i.state === 'string' ? i.state : '',
      repo: typeof repo === 'string' ? repo : null,
    };
  }

  //? GitLab: `object_kind: 'issue'`, the issue under `object_attributes`.
  if (b.object_kind !== 'issue') return IGNORED;
  const attrs = b.object_attributes;
  if (attrs === null || typeof attrs !== 'object') return IGNORED;
  const a = attrs as Record<string, unknown>;
  if (typeof a.iid !== 'number') return IGNORED;
  const proj = b.project !== null && typeof b.project === 'object' ? (b.project as Record<string, unknown>).path_with_namespace : null;
  return {
    kind: 'issue', iid: a.iid, action: normAction(typeof a.action === 'string' ? a.action : ''),
    title: typeof a.title === 'string' ? a.title : '', description: typeof a.description === 'string' ? a.description : null,
    labels: strArr(b.labels ?? a.labels, 'title'), url: typeof a.url === 'string' ? a.url : null,
    state: typeof a.state === 'string' ? a.state : '',
    repo: typeof proj === 'string' ? proj : null,
  };
}

//? R3 — find the project whose linked repo matches `repo` (GitLab `path_with_namespace` / GitHub `full_name`):
//? an exact `gitlabPath` match, or the `owner/name` tail of `gitUrl`. Null when none match. Pure-ish (one read).
async function resolveProjectByRepo(prisma: PrismaClient, workspaceId: string, repo: string): Promise<{ id: string } | null> {
  const target = repo.trim().toLowerCase().replace(/\.git$/, '');
  if (target.length === 0) return null;
  const projects = await prisma.project.findMany({ where: { workspaceId }, select: { id: true, gitlabPath: true, gitUrl: true } });
  for (const p of projects) {
    if (p.gitlabPath.trim().toLowerCase().replace(/\.git$/, '') === target) return { id: p.id };
    const url = (p.gitUrl ?? '').trim().toLowerCase().replace(/\.git$/, '');
    if (url.length > 0 && (url.endsWith(`/${target}`) || url.endsWith(`:${target}`))) return { id: p.id };
  }
  return null;
}

//? Ingest a normalized issue event: upsert the `DEV-<iid>` ticket (create on open, update fields
//? otherwise). Returns the touched key, or null if nothing was done. Idempotent.
export async function ingestIssueEvent(prisma: PrismaClient, workspaceId: string, event: ForgeIssueEvent): Promise<string | null> {
  if (event.kind !== 'issue' || event.iid <= 0) return null;
  //? R3 — route to the project whose linked repo MATCHES the webhook's source repo (multi-repo): match
  //? `gitlabPath` (or the trailing owner/name of `gitUrl`) against the event repo. Fall back to the first
  //? project when there is no match (single-project workspaces / an unroutable event) — zero regression.
  let project = event.repo ? await resolveProjectByRepo(prisma, workspaceId, event.repo) : null;
  project ??= await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  if (!project) return null;
  const key = `DEV-${String(event.iid)}`;
  const common = { title: event.title, description: event.description, labels: event.labels, issueUrl: event.url };
  const existing = await prisma.ticket.findFirst({ where: { workspaceId, key }, select: { id: true } });
  await (existing
    ? prisma.ticket.updateMany({ where: { workspaceId, key }, data: common })
    : prisma.ticket.create({ data: { workspaceId, projectId: project.id, key, number: event.iid, stageId: 'unrefined', status: 'idle', ...common } }));
  return key;
}
