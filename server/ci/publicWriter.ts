//? Writer-only completion for public CI. Browser `ci-run` prepares one durable,
//? processed intent; Docker/repo work stays outside the Conductor and only this
//? server-internal bounded report may materialize Pipeline rows.

import type { PrismaClient } from '@prisma/client';

import type { CiPublicCompleteInternalAction } from '../orchestrator/internalOps';
import { assertWorkspaceWriterContext } from '../orchestrator/writerContext';
import { persistCiReport, readCanonicalCiReport, type PersistCiReportResult } from './runner';

interface StoredPublicCiIntent {
  id: string;
  signalId: string;
  ticketId: string;
  ticketKey: string;
  projectId: string;
  branch: string;
  commitHash: string;
  mergeRequestId: string | null;
  trigger: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readStoredPublicCiIntent(value: unknown): StoredPublicCiIntent | null {
  if (!isRecord(value) || !isRecord(value.intent)) return null;
  const intent = value.intent;
  const fields = ['id', 'signalId', 'ticketId', 'ticketKey', 'projectId', 'branch', 'commitHash', 'trigger'] as const;
  if (fields.some((field) => typeof intent[field] !== 'string')) return null;
  if (intent.mergeRequestId !== null && typeof intent.mergeRequestId !== 'string') return null;
  return {
    id: String(intent.id),
    signalId: String(intent.signalId),
    ticketId: String(intent.ticketId),
    ticketKey: String(intent.ticketKey),
    projectId: String(intent.projectId),
    branch: String(intent.branch),
    commitHash: String(intent.commitHash),
    mergeRequestId: intent.mergeRequestId ?? null,
    trigger: String(intent.trigger),
  };
}

export interface PublicCiCompleteResult extends PersistCiReportResult {
  applied: boolean;
  stale: boolean;
  keys: string[];
}

export async function applyPublicCiComplete(
  prisma: PrismaClient,
  workspaceId: string,
  action: CiPublicCompleteInternalAction,
): Promise<PublicCiCompleteResult | { applied: false; reason: 'stale'; keys: string[] }> {
  assertWorkspaceWriterContext(workspaceId);
  const report = readCanonicalCiReport(action.payload.report);
  if (report?.commitHash !== action.payload.commitHash) return { applied: false, reason: 'stale', keys: [] };

  const signal = await prisma.workspaceSignal.findFirst({
    where: {
      id: action.payload.prepareSignalId,
      workspaceId,
      kind: 'ci-run',
      processedAt: { not: null },
    },
    select: { payload: true },
  });
  const intent = readStoredPublicCiIntent(signal?.payload);
  const intentMatches = intent !== null
    && intent.id === action.payload.intentId
    && intent.signalId === action.payload.prepareSignalId
    && intent.ticketId === action.target.ticketId
    && intent.ticketKey === action.target.ticketKey
    && intent.projectId === action.target.projectId
    && intent.branch === action.payload.branch
    && intent.commitHash === action.payload.commitHash
    && intent.mergeRequestId === action.payload.mergeRequestId
    && intent.trigger === action.payload.trigger;
  if (!intentMatches) return { applied: false, reason: 'stale', keys: [] };

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      branch: action.payload.branch,
    },
    select: { id: true },
  });
  if (!ticket) return { applied: false, reason: 'stale', keys: [] };

  const latestMr = await prisma.mergeRequest.findFirst({
    where: { workspaceId, projectId: action.target.projectId, ticketId: ticket.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, headSha: true },
  });
  const stale = action.payload.mergeRequestId === null
    ? latestMr !== null || action.payload.observedHead !== action.payload.commitHash
    : latestMr?.id !== action.payload.mergeRequestId
      || latestMr.headSha !== action.payload.commitHash
      || action.payload.observedHead !== action.payload.commitHash;

  const persisted = await persistCiReport(prisma, workspaceId, report, {
    projectId: action.target.projectId,
    //? The unit this run tested. It scopes the Pipeline row, the deterministic ids, and every gate — a run
    //? persisted without it would silently be attributed to the project root.
    serviceId: action.target.serviceId ?? null,
    ticketId: ticket.id,
    mergeRequestId: action.payload.mergeRequestId,
    trigger: action.payload.trigger,
    clientRequestId: `ci-public:${action.payload.intentId}`,
    stale,
  });
  return { applied: true, stale, keys: [action.target.ticketKey], ...persisted };
}
