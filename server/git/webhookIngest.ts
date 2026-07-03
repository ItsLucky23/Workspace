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
}

const IGNORED: ForgeIssueEvent = { kind: 'ignored', iid: 0, action: 'other', title: '', description: null, labels: [], url: null, state: '' };

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
    return {
      kind: 'issue', iid: i.number, action: normAction(typeof b.action === 'string' ? b.action : ''),
      title: typeof i.title === 'string' ? i.title : '', description: typeof i.body === 'string' ? i.body : null,
      labels: strArr(i.labels, 'name'), url: typeof i.html_url === 'string' ? i.html_url : null,
      state: typeof i.state === 'string' ? i.state : '',
    };
  }

  //? GitLab: `object_kind: 'issue'`, the issue under `object_attributes`.
  if (b.object_kind !== 'issue') return IGNORED;
  const attrs = b.object_attributes;
  if (attrs === null || typeof attrs !== 'object') return IGNORED;
  const a = attrs as Record<string, unknown>;
  if (typeof a.iid !== 'number') return IGNORED;
  return {
    kind: 'issue', iid: a.iid, action: normAction(typeof a.action === 'string' ? a.action : ''),
    title: typeof a.title === 'string' ? a.title : '', description: typeof a.description === 'string' ? a.description : null,
    labels: strArr(b.labels ?? a.labels, 'title'), url: typeof a.url === 'string' ? a.url : null,
    state: typeof a.state === 'string' ? a.state : '',
  };
}

//? Ingest a normalized issue event: upsert the `DEV-<iid>` ticket (create on open, update fields
//? otherwise). Returns the touched key, or null if nothing was done. Idempotent.
export async function ingestIssueEvent(prisma: PrismaClient, workspaceId: string, event: ForgeIssueEvent): Promise<string | null> {
  if (event.kind !== 'issue' || event.iid <= 0) return null;
  const project = await prisma.project.findFirst({ where: { workspaceId }, select: { id: true } });
  if (!project) return null;
  const key = `DEV-${String(event.iid)}`;
  const common = { title: event.title, description: event.description, labels: event.labels, issueUrl: event.url };
  const existing = await prisma.ticket.findFirst({ where: { workspaceId, key }, select: { id: true } });
  await (existing
    ? prisma.ticket.updateMany({ where: { workspaceId, key }, data: common })
    : prisma.ticket.create({ data: { workspaceId, projectId: project.id, key, number: event.iid, stageId: 'unrefined', status: 'idle', ...common } }));
  return key;
}
