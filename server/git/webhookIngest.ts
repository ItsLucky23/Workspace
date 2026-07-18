//? Forge webhook normalization + Conductor-only apply. Parsing is pure and bounded;
//? accepted events are applied only from the server-internal writer path.

import type { PrismaClient } from '@prisma/client';

import { currentWorkspaceId } from '../tenant/tenantContext';
import { assertWriterContext } from '../orchestrator/writerContext';
import {
  applyForgeSnapshot,
  buildForgeSnapshot,
  normalizeForgeIssue,
  normalizeForgeRepo,
  type ForgeApplyResult,
  type ForgeSnapshot,
} from './gitlabSync';

export interface ForgeIssueEvent {
  kind: 'issue' | 'ignored';
  provider: ForgeSnapshot['mode'];
  iid: number;
  action: 'open' | 'update' | 'close' | 'reopen' | 'other';
  title: string;
  description: string | null;
  labels: string[];
  url: string | null;
  state: string;
  //? Source repo identity: GitLab `path_with_namespace` / GitHub `full_name`.
  repo: string | null;
}

function ignored(provider: ForgeIssueEvent['provider']): ForgeIssueEvent {
  return {
    kind: 'ignored',
    provider,
    iid: 0,
    action: 'other',
    title: '',
    description: null,
    labels: [],
    url: null,
    state: '',
    repo: null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = entry;
  return result;
}

function forgeMode(raw: unknown): ForgeIssueEvent['provider'] {
  return raw === 'github' ? 'github' : 'gitlab';
}

function normAction(raw: unknown): ForgeIssueEvent['action'] {
  const action = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (action === 'open' || action === 'opened') return 'open';
  if (action === 'close' || action === 'closed') return 'close';
  if (action === 'reopen' || action === 'reopened') return 'reopen';
  if (action === 'update' || action === 'updated' || action === 'edited' || action === 'labeled' || action === 'unlabeled') return 'update';
  return 'other';
}

function issueEvent(
  provider: ForgeIssueEvent['provider'],
  action: unknown,
  issueValue: unknown,
  repoValue: unknown,
): ForgeIssueEvent {
  const issue = normalizeForgeIssue(issueValue);
  if (!issue) return ignored(provider);
  const repo = typeof repoValue === 'string' ? normalizeForgeRepo(repoValue) : '';
  return {
    kind: 'issue',
    provider,
    iid: issue.iid,
    action: normAction(action),
    title: issue.title,
    description: issue.description,
    labels: issue.labels,
    url: issue.web_url,
    state: issue.state,
    repo: repo.length > 0 ? repo : null,
  };
}

//? Parse a provider body into a normalized bounded issue event. Non-issue events are
//? still accepted as `ignored` so the internal writer can update last-event metadata.
export function parseWebhookEvent(body: unknown, eventHeader?: string): ForgeIssueEvent {
  const root = record(body);
  const provider: ForgeIssueEvent['provider'] = eventHeader ? 'github' : 'gitlab';
  if (!root) return ignored(provider);

  if (provider === 'github') {
    if (eventHeader !== 'issues') return ignored(provider);
    const repository = record(root.repository);
    return issueEvent(provider, root.action, root.issue, repository?.full_name);
  }

  if (root.object_kind !== 'issue') return ignored(provider);
  const attrs = record(root.object_attributes);
  if (!attrs) return ignored(provider);
  const project = record(root.project);
  return issueEvent(provider, attrs.action, {
    iid: attrs.iid,
    title: attrs.title,
    description: attrs.description,
    labels: root.labels ?? attrs.labels,
    web_url: attrs.url,
    state: attrs.state,
  }, project?.path_with_namespace);
}

function repoMatchesGitUrl(gitUrl: string | null, repo: string): boolean {
  const normalized = normalizeForgeRepo(gitUrl ?? '');
  return normalized.endsWith(`/${repo}`) || normalized.endsWith(`:${repo}`);
}

async function resolveEventProject(
  prisma: PrismaClient,
  workspaceId: string,
  event: ForgeIssueEvent,
): Promise<{ id: string; repo: string } | null> {
  if (event.repo === null) return null;
  const [projects, connections, workspace] = await Promise.all([
    prisma.project.findMany({
      where: { workspaceId },
      select: { id: true, gitlabPath: true, gitUrl: true },
    }),
    prisma.forgeConnection.findMany({
      where: { workspaceId },
      select: { projectId: true, mode: true, repoPath: true },
    }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { forgeType: true } }),
  ]);
  if (!workspace) return null;

  const matches: { id: string; repo: string }[] = [];
  for (const project of projects) {
    const connection = connections.find((entry) => entry.projectId === project.id);
    const workspaceMode = forgeMode(workspace.forgeType);
    const mode = connection ? forgeMode(connection.mode) : workspaceMode;
    if (mode !== event.provider) continue;
    const configuredRepo = normalizeForgeRepo(connection?.repoPath ?? project.gitlabPath);
    const matchesConfigured = configuredRepo.length > 0 && configuredRepo === event.repo;
    const matchesUrl = repoMatchesGitUrl(project.gitUrl, event.repo);
    if (matchesConfigured || matchesUrl) {
      //? A gitUrl-only match is routable, but apply still requires a configured forge repo.
      //? Returning the configured identity makes that later check fail closed when it is blank.
      matches.push({ id: project.id, repo: configuredRepo });
    }
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}

function assertForgeEventWriter(workspaceId: string): void {
  assertWriterContext(workspaceId);
  if (currentWorkspaceId() !== workspaceId) {
    throw new Error('[forge] webhook writer tenant context does not match the target workspace');
  }
}

//? Apply one accepted webhook under the Conductor. `webhookLastEventAt` is updated
//? even for ignored event kinds, but never from the HTTP route itself.
export async function applyForgeEvent(
  prisma: PrismaClient,
  workspaceId: string,
  event: ForgeIssueEvent,
  acceptedAt: number,
): Promise<ForgeApplyResult> {
  assertForgeEventWriter(workspaceId);
  const acceptedDate = Number.isSafeInteger(acceptedAt) && acceptedAt > 0
    ? new Date(acceptedAt)
    : new Date();
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { webhookLastEventAt: acceptedDate },
  });
  if (event.kind !== 'issue') return { ok: true, synced: 0, keys: [], skipped: 0 };

  //? Re-resolve repo→project while holding the writer lease. A config change between
  //? HTTP parse and apply, an ambiguous repo, or a foreign provider all skip safely.
  const project = await resolveEventProject(prisma, workspaceId, event);
  if (!project || project.repo.length === 0) {
    return { ok: true, synced: 0, keys: [], skipped: 1, reason: 'forge.repoMismatch' };
  }
  const snapshot = buildForgeSnapshot(project.id, event.provider, project.repo, [{
    iid: event.iid,
    title: event.title,
    description: event.description,
    labels: event.labels,
    web_url: event.url,
    state: event.state,
  }]);
  return applyForgeSnapshot(prisma, workspaceId, project.id, snapshot);
}
