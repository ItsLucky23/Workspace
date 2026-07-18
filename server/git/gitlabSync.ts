//? Forge issue ingestion (ADR 0036 — GitLab + GitHub). External issue snapshots are fetched
//? outside the workspace write lease, normalized into a bounded credential-free payload, then
//? applied by the Conductor. Webhook and poller writes therefore share the same B-23 writer path.

import { createHash } from 'node:crypto';

import { getPrismaClient, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { broadcastTicketDelta } from '../read/broadcast';
import { currentWorkspaceId, runInTenant } from '../tenant/tenantContext';
import { withRetry } from '../util/retry';
import { assertWriterContext } from '../orchestrator/writerContext';
import type { EnqueuedControlAction } from '../orchestrator/conductor';
import type { ForgeSnapshotInternalAction } from '../orchestrator/internalOps';
import { resolveForge, type ResolvedForge } from './forgeResolve';

//? Poll cadence. Exported so the @luckystack/cron overlay job schedules it.
export const SYNC_INTERVAL_MS = Number(process.env.WS_GITLAB_SYNC_MIN ?? '5') * 60_000;
export const MAX_FORGE_ISSUES = 2000;
export const MAX_FORGE_SIGNAL_BYTES = 4_000_000;
export const MAX_FORGE_RESPONSE_BYTES = 2_000_000;
export const MAX_FORGE_TITLE = 500;
export const MAX_FORGE_DESCRIPTION = 2000;
export const MAX_FORGE_LABELS = 20;
export const MAX_FORGE_LABEL = 80;
export const MAX_FORGE_URL = 2000;
export const MAX_FORGE_REPO = 512;
const MAX_FORGE_STATE = 40;
const MAX_PROJECT_ID = 128;
const PER_PAGE = 100;
const MAX_ISSUE_PAGES = MAX_FORGE_ISSUES / PER_PAGE;
const MAX_ISSUE_NUMBER = 2_147_483_647;

export interface ForgeIssue {
  iid: number;
  title: string;
  description: string | null;
  labels: string[];
  web_url: string | null;
  state: string;
}

export interface ForgeSnapshot {
  projectId: string;
  mode: 'gitlab' | 'github';
  repo: string;
  issues: ForgeIssue[];
  capped: boolean;
  //? True only for an authoritative open-issues listing. Webhook snapshots are deltas.
  full: boolean;
}

export interface ForgeApplyResult {
  ok: true;
  synced: number;
  keys: string[];
  skipped: number;
  reason?: 'forge.projectNotFound' | 'forge.projectMismatch' | 'forge.repoMismatch';
}

export type GitlabSyncResult = ForgeApplyResult;

export type ForgeFetchSnapshotResult =
  | { ok: true; snapshot: ForgeSnapshot }
  | { ok: false; error: 'forge.notConfigured' | 'forge.noToken' | 'forge.fetchFailed' };

export type ForgeFetch = (url: string, init: RequestInit) => Promise<Response>;

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) result[key] = entry;
  return result;
}

function boundedString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function boundedNullableString(value: unknown, max: number): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function issueNumber(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_ISSUE_NUMBER
    ? value
    : null;
}

function boundedLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const row = record(entry);
    const raw = typeof entry === 'string' ? entry : row?.name ?? row?.title;
    const label = boundedString(raw, MAX_FORGE_LABEL).trim();
    if (label.length === 0 || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= MAX_FORGE_LABELS) break;
  }
  return labels.toSorted();
}

export function normalizeForgeRepo(repo: string): string {
  return repo.trim().toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '').slice(0, MAX_FORGE_REPO);
}

export function normalizeForgeIssue(value: unknown): ForgeIssue | null {
  const row = record(value);
  if (!row) return null;
  const iid = issueNumber(row.iid ?? row.number);
  if (iid === null) return null;
  return {
    iid,
    title: boundedString(row.title, MAX_FORGE_TITLE),
    description: boundedNullableString(row.description ?? row.body, MAX_FORGE_DESCRIPTION),
    labels: boundedLabels(row.labels),
    web_url: boundedNullableString(row.web_url ?? row.html_url, MAX_FORGE_URL),
    state: boundedString(row.state, MAX_FORGE_STATE),
  };
}

interface GithubIssue {
  number: number;
  title: string;
  body?: string | null;
  labels?: { name?: string }[];
  html_url?: string;
  state?: string;
  pull_request?: unknown;
}

//? GitHub's `/issues` also returns PRs. Keep this public mapper for its existing
//? provider-shape regression while applying the same bounds used by writer payloads.
export function mapGithubIssues(rows: GithubIssue[]): ForgeIssue[] {
  const issues: ForgeIssue[] = [];
  for (const row of rows) {
    if (row.pull_request !== undefined) continue;
    const normalized = normalizeForgeIssue(row);
    if (normalized) issues.push(normalized);
  }
  return issues;
}

function normalizedResponseRows(value: unknown, mode: ResolvedForge['mode']): ForgeIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: ForgeIssue[] = [];
  for (const entry of value.slice(0, PER_PAGE)) {
    const row = record(entry);
    if (mode === 'github' && row?.pull_request !== undefined) continue;
    const issue = normalizeForgeIssue(entry);
    if (issue) issues.push(issue);
  }
  return issues;
}

//? Build the exact payload allowed into WorkspaceSignal/Conductor memory. Sorting and
//? duplicate-iid removal make the dataset digest stable when a forge changes page order.
export function buildForgeSnapshot(
  projectId: string,
  mode: ForgeSnapshot['mode'],
  repo: string,
  rows: readonly unknown[],
  sourceCapped = false,
  full = false,
): ForgeSnapshot {
  const normalized = rows
    .map((row) => normalizeForgeIssue(row))
    .filter((row): row is ForgeIssue => row !== null)
    .toSorted((a, b) => a.iid - b.iid || a.title.localeCompare(b.title));
  const issues: ForgeIssue[] = [];
  const seen = new Set<number>();
  let bytes = Buffer.byteLength(JSON.stringify({ projectId, mode, repo, issues: [], capped: sourceCapped, full }));
  let capped = sourceCapped || rows.length !== normalized.length;

  for (const issue of normalized) {
    if (seen.has(issue.iid)) { capped = true; continue; }
    if (issues.length >= MAX_FORGE_ISSUES) { capped = true; break; }
    const issueBytes = Buffer.byteLength(JSON.stringify(issue)) + (issues.length > 0 ? 1 : 0);
    if (bytes + issueBytes > MAX_FORGE_SIGNAL_BYTES) { capped = true; break; }
    seen.add(issue.iid);
    issues.push(issue);
    bytes += issueBytes;
  }

  return {
    projectId: projectId.slice(0, MAX_PROJECT_ID),
    mode,
    repo: normalizeForgeRepo(repo),
    issues,
    capped,
    full,
  };
}

//? Runtime validation at the public ControlOp boundary. The browser cannot smuggle an
//? unbounded or foreign-project snapshot into the Conductor.
export function readForgeSnapshot(value: unknown): ForgeSnapshot | null {
  const row = record(value);
  if (!row || typeof row.projectId !== 'string' || row.projectId.length === 0 || row.projectId.length > MAX_PROJECT_ID) return null;
  if (row.mode !== 'gitlab' && row.mode !== 'github') return null;
  if (typeof row.repo !== 'string' || row.repo.length === 0 || row.repo.length > MAX_FORGE_REPO) return null;
  if (!Array.isArray(row.issues) || row.issues.length > MAX_FORGE_ISSUES) return null;
  for (const issue of row.issues) if (normalizeForgeIssue(issue) === null) return null;
  return buildForgeSnapshot(row.projectId, row.mode, row.repo, row.issues, row.capped === true, row.full === true);
}

export function forgeSnapshotRequestId(snapshot: ForgeSnapshot): string {
  const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return `forge-snapshot:${snapshot.projectId}:${digest}`;
}

//? Treat a Conductor result as untrusted at the broadcast edge. Only valid bounded DEV
//? keys can escape the internal writer result.
export function forgeTouchedKeys(result: unknown): string[] {
  const row = record(result);
  if (!row || !Array.isArray(row.keys)) return [];
  return row.keys
    .filter((key): key is string => typeof key === 'string' && /^DEV-[1-9]\d*$/.test(key))
    .slice(0, MAX_FORGE_ISSUES);
}

//? Retry ONLY transient forge failures — a 5xx/429/network blip is worth a retry;
//? bad credentials, missing repos, and our own payload bounds fail fast.
export function isTransientForgeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('response too large') || message.includes('invalid response')) return false;
  const match = /\b(\d{3})\b/.exec(message);
  if (!match) return true;
  const code = Number(match[1]);
  return code === 429 || code >= 500;
}

//? Follow `page=1..` until a short page or the safety cap. A malicious oversized
//? page is sliced before accumulation, so count is bounded independently of the API.
export async function accumulatePages<T>(
  fetchPage: (page: number) => Promise<T[]>,
  opts: { perPage?: number; maxPages?: number } = {},
): Promise<{ rows: T[]; capped: boolean }> {
  const perPage = opts.perPage ?? PER_PAGE;
  const maxPages = opts.maxPages ?? MAX_ISSUE_PAGES;
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const pageRows = await fetchPage(page);
    rows.push(...pageRows.slice(0, perPage));
    if (pageRows.length < perPage) return { rows, capped: false };
  }
  return { rows, capped: true };
}

async function readBoundedResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('forge invalid response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_FORGE_RESPONSE_BYTES) {
      await tryCatch(() => reader.cancel());
      throw new Error('forge response too large');
    }
    chunks.push(part.value);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

async function fetchGitlabIssues(forge: ResolvedForge, request: ForgeFetch): Promise<{ rows: ForgeIssue[]; capped: boolean }> {
  return accumulatePages<ForgeIssue>((page) => withRetry(async () => {
    //? External GitLab REST API (its own /api/v4) — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const response = await request(`${forge.base}/api/v4/projects/${encodeURIComponent(forge.repoPath)}/issues?state=opened&per_page=${String(PER_PAGE)}&page=${String(page)}`, { headers: { 'PRIVATE-TOKEN': forge.token ?? '' } });
    if (!response.ok) throw new Error(`gitlab ${String(response.status)}`);
    return normalizedResponseRows(await readBoundedResponse(response), 'gitlab');
  }, { attempts: 3, baseMs: 300, retryable: isTransientForgeError }));
}

async function fetchGithubIssues(forge: ResolvedForge, request: ForgeFetch): Promise<{ rows: ForgeIssue[]; capped: boolean }> {
  return accumulatePages<ForgeIssue>((page) => withRetry(async () => {
    //? External GitHub REST API — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const response = await request(`${forge.base}/repos/${forge.repoPath}/issues?state=open&per_page=${String(PER_PAGE)}&page=${String(page)}`, { headers: { Authorization: `Bearer ${forge.token ?? ''}`, Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`github ${String(response.status)}`);
    return normalizedResponseRows(await readBoundedResponse(response), 'github');
  }, { attempts: 3, baseMs: 300, retryable: isTransientForgeError }));
}

//? Read credentials + fetch the authoritative dataset. This function performs NO writes
//? and is called before dispatch/enqueue, so a blocked forge never occupies a workspace lease.
export async function fetchForgeSnapshot(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  request: ForgeFetch = (url, init) => fetch(url, init),
): Promise<ForgeFetchSnapshotResult> {
  const forge = await resolveForge(prisma, workspaceId, projectId);
  if (!forge || forge.base.length === 0 || forge.repoPath.length === 0 || forge.repoPath.length > MAX_FORGE_REPO) {
    return { ok: false, error: 'forge.notConfigured' };
  }
  if (!forge.token) return { ok: false, error: 'forge.noToken' };

  const [fetchError, fetched] = await tryCatch(() => forge.mode === 'github'
    ? fetchGithubIssues(forge, request)
    : fetchGitlabIssues(forge, request));
  if (fetchError || !fetched) return { ok: false, error: 'forge.fetchFailed' };
  if (fetched.capped) {
    console.warn(`[gitlabSync] issue sync hit its bounded cap for ${forge.repoPath}; remaining issues were not included this run.`);
  }
  return {
    ok: true,
    snapshot: buildForgeSnapshot(projectId, forge.mode, forge.repoPath, fetched.rows, fetched.capped, true),
  };
}

function assertForgeWriterScope(workspaceId: string): void {
  assertWriterContext(workspaceId);
  if (currentWorkspaceId() !== workspaceId) {
    throw new Error('[forge] writer tenant context does not match the target workspace');
  }
}

async function liveForgeIdentity(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
): Promise<{ mode: ForgeSnapshot['mode']; repo: string } | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true, gitlabPath: true },
  });
  if (!project) return null;
  const connection = await prisma.forgeConnection.findFirst({
    where: { workspaceId, projectId },
    select: { mode: true, repoPath: true },
  });
  if (connection) {
    return {
      mode: connection.mode === 'github' ? 'github' : 'gitlab',
      repo: normalizeForgeRepo(connection.repoPath ?? project.gitlabPath),
    };
  }
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { forgeType: true } });
  return workspace
    ? {
        mode: workspace.forgeType === 'github' ? 'github' : 'gitlab',
        repo: normalizeForgeRepo(project.gitlabPath),
      }
    : null;
}

function forgeIssueArchiveState(state: string): boolean | null {
  const normalized = state.trim().toLowerCase();
  if (normalized === 'closed') return true;
  if (normalized === 'open' || normalized === 'opened' || normalized === 'reopened') return false;
  return null;
}

async function applyIssueToProject(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  issue: ForgeIssue,
): Promise<{ key: string; touched: boolean }> {
  assertForgeWriterScope(workspaceId);
  const key = `DEV-${String(issue.iid)}`;
  const existing = await prisma.ticket.findFirst({
    where: { workspaceId, key },
    select: {
      id: true,
      projectId: true,
      title: true,
      description: true,
      labels: true,
      issueUrl: true,
      archived: true,
    },
  });
  //? Ticket.key is globally unique within a workspace. Until the schema changes, the
  //? same forge iid in a sibling project is a collision: never update that sibling.
  if (existing?.projectId && existing.projectId !== projectId) return { key, touched: false };
  const archiveState = forgeIssueArchiveState(issue.state);
  //? A close webhook is a delta, not a create instruction. Unknown closed issues stay unknown.
  if (!existing && archiveState === true) return { key, touched: false };
  const common = {
    title: issue.title,
    description: issue.description,
    labels: issue.labels,
    issueUrl: issue.web_url ?? existing?.issueUrl ?? null,
    archived: archiveState ?? existing?.archived ?? false,
  };
  const unchanged = existing?.title === common.title
    && existing.description === common.description
    && existing.issueUrl === common.issueUrl
    && existing.archived === common.archived
    && existing.labels.length === common.labels.length
    && existing.labels.every((label, index) => label === common.labels[index]);
  if (unchanged) return { key, touched: false };
  await (existing
    ? prisma.ticket.updateMany({
        where: { id: existing.id, workspaceId, projectId, key },
        data: common,
      })
    : prisma.ticket.create({
        data: {
          workspaceId,
          projectId,
          key,
          number: issue.iid,
          stageId: 'unrefined',
          status: 'idle',
          ...common,
        },
      }));
  return { key, touched: true };
}

//? The mutation half. It may run only under runInTenant + the Conductor writer context.
//? Project and forge identity are re-resolved at apply time so config changes during a
//? slow fetch fail closed rather than writing a now-foreign dataset.
export async function applyForgeSnapshot(
  prisma: PrismaClient,
  workspaceId: string,
  projectId: string,
  input: ForgeSnapshot,
): Promise<ForgeApplyResult> {
  assertForgeWriterScope(workspaceId);
  const snapshot = readForgeSnapshot(input);
  if (snapshot?.projectId !== projectId) {
    return { ok: true, synced: 0, keys: [], skipped: input.issues.length, reason: 'forge.projectMismatch' };
  }
  const identity = await liveForgeIdentity(prisma, workspaceId, projectId);
  if (!identity) {
    return { ok: true, synced: 0, keys: [], skipped: snapshot.issues.length, reason: 'forge.projectNotFound' };
  }
  if (identity.mode !== snapshot.mode || identity.repo.length === 0 || identity.repo !== normalizeForgeRepo(snapshot.repo)) {
    return { ok: true, synced: 0, keys: [], skipped: snapshot.issues.length, reason: 'forge.repoMismatch' };
  }

  const keys: string[] = [];
  let skipped = 0;
  for (const issue of snapshot.issues) {
    const applied = await applyIssueToProject(prisma, workspaceId, projectId, issue);
    if (applied.touched) keys.push(applied.key);
    else skipped += 1;
  }

  //? Forge wins: only a COMPLETE, uncapped open-issue listing proves absence. Archive
  //? forge-linked local projections missing from that set; capped listings and webhook
  //? deltas can never infer absence. Local-only tickets (no issueUrl) remain untouched.
  if (snapshot.full && !snapshot.capped) {
    const openNumbers = snapshot.issues
      .filter((issue) => forgeIssueArchiveState(issue.state) !== true)
      .map((issue) => issue.iid);
    const missing = await prisma.ticket.findMany({
      where: {
        workspaceId,
        projectId,
        archived: false,
        issueUrl: { not: null },
        ...(openNumbers.length > 0 ? { number: { notIn: openNumbers } } : {}),
      },
      select: { id: true, key: true },
    });
    if (missing.length > 0) {
      await prisma.ticket.updateMany({
        where: { workspaceId, projectId, id: { in: missing.map((ticket) => ticket.id) } },
        data: { archived: true },
      });
      keys.push(...missing.map((ticket) => ticket.key));
    }
  }
  return { ok: true, synced: keys.length, keys, skipped };
}

//? Push-back — post a comment on the ticket's source issue. This is a provider side
//? effect, not authoritative board state; callers retain the existing best-effort contract.
export async function postIssueComment(
  prisma: PrismaClient,
  workspaceId: string,
  ticketKey: string,
  body: string,
): Promise<boolean> {
  const ticket = await prisma.ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { number: true, projectId: true } });
  if (!ticket) return false;
  const forge = await resolveForge(prisma, workspaceId, ticket.projectId);
  if (!forge || forge.base.length === 0 || forge.repoPath.length === 0 || !forge.token) return false;
  const token = forge.token;
  const [error, ok] = await tryCatch(async () => {
    const url = forge.mode === 'github'
      ? `${forge.base}/repos/${forge.repoPath}/issues/${String(ticket.number)}/comments`
      : `${forge.base}/api/v4/projects/${encodeURIComponent(forge.repoPath)}/issues/${String(ticket.number)}/notes`;
    const headers: Record<string, string> = forge.mode === 'github'
      ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
      : { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' };
    //? External forge REST API — not a framework `/api/*` route.
    // eslint-disable-next-line luckystack/no-raw-fetch-in-src
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ body }) });
    return response.ok;
  });
  return !error && ok === true;
}

interface ForgeProjectRef { id: string; workspaceId: string }

export interface GitlabSyncTickDependencies {
  listProjects: () => Promise<ForgeProjectRef[]>;
  fetchSnapshot: (workspaceId: string, projectId: string) => Promise<ForgeFetchSnapshotResult>;
  enqueueSnapshot: (action: ForgeSnapshotInternalAction) => Promise<EnqueuedControlAction>;
  broadcast: (workspaceId: string, keys: string[]) => Promise<void>;
}

function defaultTickDependencies(): GitlabSyncTickDependencies {
  const prisma = getPrismaClient();
  return {
    listProjects: () => prisma.project.findMany({ select: { id: true, workspaceId: true } }),
    fetchSnapshot: (workspaceId, projectId) => runInTenant(
      workspaceId,
      () => fetchForgeSnapshot(prisma, workspaceId, projectId),
    ),
    enqueueSnapshot: async (action) => {
      const { enqueueInternalAction } = await import('../orchestrator/internalOps');
      return enqueueInternalAction(action);
    },
    broadcast: (workspaceId, keys) => broadcastTicketDelta(prisma, workspaceId, keys),
  };
}

//? Poll every project. Enumeration + all external HTTP complete before enqueueing the
//? bounded snapshot; only enqueueSnapshot enters the workspace lease. Broadcast occurs
//? after the writer result and therefore outside its AsyncLocalStorage writer scope.
export async function runGitlabSyncTick(dependencies?: GitlabSyncTickDependencies): Promise<void> {
  const deps = dependencies ?? defaultTickDependencies();
  const [listError, projects] = await tryCatch(() => deps.listProjects());
  if (listError || !projects) return;
  for (const project of projects) {
    const [fetchError, fetched] = await tryCatch(() => deps.fetchSnapshot(project.workspaceId, project.id));
    if (fetchError || !fetched?.ok) continue;
    const action: ForgeSnapshotInternalAction = {
      workspaceId: project.workspaceId,
      op: 'forge-snapshot-apply',
      target: { projectId: project.id },
      payload: { snapshot: fetched.snapshot },
      userId: 'forge-poller',
      clientRequestId: forgeSnapshotRequestId(fetched.snapshot),
    };
    const [applyError, applied] = await tryCatch(() => deps.enqueueSnapshot(action));
    if (applyError || !applied) continue;
    const keys = forgeTouchedKeys(applied.result);
    if (keys.length > 0) await tryCatch(() => deps.broadcast(project.workspaceId, keys));
  }
}
