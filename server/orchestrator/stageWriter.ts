//? Stage-run single-writer apply boundary. The stage runner may read tenant state and perform
//? slow PTY/container/git work, but every authoritative result is revalidated and applied here
//? while the Conductor owns the matching tenant + renewable workspace writer context.

import type { PrismaClient } from '@prisma/client';

import { isTestStage, testStageCiVerdict } from '../ci/gate';
import { persistCiReport, type StageCiReport } from '../ci/runner';
import { reservationOwnsSlot } from './capacity';
import { deterministicObjectId, stageForgeIntentId } from './actionIds';
import { jsonInput } from '../util/json';
import { estTokens, priceFor } from '../spend/record';
import { parseAdvisories } from './questionSet';
import { recordHandoff } from './handoff';
import { assertWorkspaceWriterContext } from './writerContext';
import { tryCatch } from '@luckystack/core';
import { needsInputHash } from './recoveryWriter';
import type {
  StageActivationCompleteInternalAction,
  StageDeferUpdateInternalAction,
  StageForgeCompleteInternalAction,
  StageForgePrepareInternalAction,
  StageHandoffCompleteInternalAction,
  StageRunTarget,
  StageSessionStartInternalAction,
  StageSessionUpdateInternalAction,
  StageToolTrailAppendInternalAction,
  StageTurnCompleteInternalAction,
} from './internalOps';

export const EDITOR_DEFER_MSG = '⏸ Editor open — AI-turn uitgesteld';
export const CAPACITY_DEFER_MSG = '⏳ Wachtrij — te veel AI-turns tegelijk';
export const BLOCKED_DEFER_MSG = '🔒 Geblokkeerd door open ticket(s)';

export interface StageSessionProjection {
  id: string;
  runToken: string;
  runFence: number;
  claudeSessionId: string | null;
  tokenEstimate: number;
}

export type StageSessionStartResult =
  | { applied: true; session: StageSessionProjection; keys: string[] }
  | { applied: false; reason: 'stale'; keys: string[] };

export interface StageApplyResult {
  applied: boolean;
  keys: string[];
  reason?: 'stale';
}

export interface StageToolTrailResult extends StageApplyResult {
  appended: number;
}

export interface StageTurnCompleteResult extends StageApplyResult {
  forgeRequired: boolean;
  pipelineDone: boolean;
  gated: boolean;
  ciBlocked: boolean;
  claudeSessionId: string | null;
  tokenEstimate: number;
}

export interface StageActivationCompleteResult extends StageApplyResult {
  changed: boolean;
}

export interface StageForgePrepareResult extends StageApplyResult {
  intentId: string;
}

export interface StageForgeCompleteResult extends StageApplyResult {
  changed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function stageSessionProjection(value: unknown): StageSessionProjection | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.runToken !== 'string') return null;
  if (typeof value.runFence !== 'number' || !Number.isSafeInteger(value.runFence) || value.runFence <= 0) return null;
  if (value.claudeSessionId !== null && typeof value.claudeSessionId !== 'string') return null;
  if (typeof value.tokenEstimate !== 'number' || !Number.isSafeInteger(value.tokenEstimate)) return null;
  return { id: value.id, runToken: value.runToken, runFence: value.runFence, claudeSessionId: value.claudeSessionId, tokenEstimate: value.tokenEstimate };
}

export function readStageSessionStartResult(value: unknown): StageSessionStartResult | null {
  if (!isRecord(value) || typeof value.applied !== 'boolean') return null;
  const keys = stringArray(value.keys);
  if (!value.applied) return value.reason === 'stale' ? { applied: false, reason: 'stale', keys } : null;
  const session = stageSessionProjection(value.session);
  return session ? { applied: true, session, keys } : null;
}

export function readStageApplyResult(value: unknown): StageApplyResult | null {
  if (!isRecord(value) || typeof value.applied !== 'boolean') return null;
  return { applied: value.applied, keys: stringArray(value.keys), ...(!value.applied && value.reason === 'stale' ? { reason: 'stale' as const } : {}) };
}

export function readStageToolTrailResult(value: unknown): StageToolTrailResult | null {
  const base = readStageApplyResult(value);
  if (!base || !isRecord(value) || typeof value.appended !== 'number' || !Number.isSafeInteger(value.appended)) return null;
  return { ...base, appended: value.appended };
}

export function readStageTurnCompleteResult(value: unknown): StageTurnCompleteResult | null {
  const base = readStageApplyResult(value);
  if (!base || !isRecord(value)) return null;
  if (typeof value.forgeRequired !== 'boolean' || typeof value.pipelineDone !== 'boolean' || typeof value.gated !== 'boolean' || typeof value.ciBlocked !== 'boolean') return null;
  if (value.claudeSessionId !== null && typeof value.claudeSessionId !== 'string') return null;
  if (typeof value.tokenEstimate !== 'number' || !Number.isSafeInteger(value.tokenEstimate)) return null;
  return {
    ...base,
    forgeRequired: value.forgeRequired,
    pipelineDone: value.pipelineDone,
    gated: value.gated,
    ciBlocked: value.ciBlocked,
    claudeSessionId: value.claudeSessionId,
    tokenEstimate: value.tokenEstimate,
  };
}

export function readStageActivationCompleteResult(value: unknown): StageActivationCompleteResult | null {
  const base = readStageApplyResult(value);
  if (!base || !isRecord(value) || typeof value.changed !== 'boolean') return null;
  return { ...base, changed: value.changed };
}

export function readStageForgePrepareResult(value: unknown): StageForgePrepareResult | null {
  const base = readStageApplyResult(value);
  if (!base || !isRecord(value) || typeof value.intentId !== 'string' || !/^[a-f\d]{24}$/i.test(value.intentId)) return null;
  return { ...base, intentId: value.intentId };
}

export function readStageForgeCompleteResult(value: unknown): StageForgeCompleteResult | null {
  const base = readStageApplyResult(value);
  if (!base || !isRecord(value) || typeof value.changed !== 'boolean') return null;
  return { ...base, changed: value.changed };
}

//? Fresh results carry `applied`; terminal dedup replays intentionally carry only bounded keys.
//? A ticket key therefore proves writer success in both cases, while stale outcomes carry no keys.
export function stageActionResultKeys(value: unknown): string[] {
  return isRecord(value) ? stringArray(value.keys) : [];
}

export function stageActionPersisted(value: unknown, ticketKey: string): boolean {
  if (!stageActionResultKeys(value).includes(ticketKey)) return false;
  return !isRecord(value) || !('applied' in value) || value.applied === true;
}

export function resolveStageGate(stageGate: boolean, level: string | null | undefined): boolean {
  if (level === 'full-auto') return false;
  if (level === 'gate-every') return true;
  return stageGate;
}

async function currentRun(
  prisma: PrismaClient,
  workspaceId: string,
  target: StageRunTarget,
  containerId: string,
) {
  assertWorkspaceWriterContext(workspaceId);
  if (!(await reservationOwnsSlot(workspaceId, target.ticketKey, target.runToken, target.runFence))) return null;
  const ticket = await prisma.ticket.findFirst({
    where: {
      id: target.ticketId,
      workspaceId,
      projectId: target.projectId,
      key: target.ticketKey,
      stageId: target.stageId,
      archived: false,
      status: { notIn: ['done', 'paused'] },
    },
  });
  if (!ticket) return null;
  const stage = await prisma.pipelineStage.findFirst({
    where: { workspaceId, projectId: target.projectId, key: target.stageId },
  });
  if (!stage) return null;
  const session = await prisma.agentSession.findFirst({
    where: {
      id: target.sessionId,
      workspaceId,
      ticketId: target.ticketId,
      stageId: target.stageId,
      kind: 'worker',
      sessionKey: `worker:${target.ticketId}:${target.stageId}`,
      runToken: target.runToken,
      runFence: target.runFence,
      containerId,
    },
  });
  if (!session || !(await reservationOwnsSlot(workspaceId, target.ticketKey, target.runToken, target.runFence))) return null;
  return { ticket, stage, session };
}

//? If a crash lands after deterministic SpendRecord creation and after an ungated
//? ticket advance but before the completion marker, the ordinary current-stage CAS no
//? longer matches. The spend row proves this exact stable completion already crossed
//? the fresh stale boundary; reloading the exact session lets the remaining idempotent
//? writes converge without accepting an unrelated moved ticket.
async function partialCompletionRun(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageTurnCompleteInternalAction,
) {
  assertWorkspaceWriterContext(workspaceId);
  if (action.payload.turn.kind !== 'done') return null;
  if (!(await reservationOwnsSlot(workspaceId, action.target.ticketKey, action.target.runToken, action.target.runFence))) return null;
  const expectedSessionKey = `worker:${action.target.ticketId}:${action.target.stageId}`;
  const [spend, ticket, stage, session] = await Promise.all([
    prisma.spendRecord.findFirst({
      where: {
        id: deterministicObjectId(workspaceId, action.clientRequestId, 'stage-spend'),
        workspaceId,
        ticketId: action.target.ticketId,
        stageId: action.target.stageId,
        sessionKey: expectedSessionKey,
      },
      select: { id: true },
    }),
    prisma.ticket.findFirst({
      where: {
        id: action.target.ticketId,
        workspaceId,
        projectId: action.target.projectId,
        key: action.target.ticketKey,
        archived: false,
        status: { notIn: ['done', 'paused'] },
      },
    }),
    prisma.pipelineStage.findFirst({
      where: { workspaceId, projectId: action.target.projectId, key: action.target.stageId },
    }),
    prisma.agentSession.findFirst({
      where: {
        id: action.target.sessionId,
        workspaceId,
        ticketId: action.target.ticketId,
        stageId: action.target.stageId,
        kind: 'worker',
        sessionKey: expectedSessionKey,
        runToken: action.target.runToken,
        runFence: action.target.runFence,
        containerId: action.payload.containerId,
        status: 'busy',
      },
    }),
  ]);
  if (!spend || !ticket || !stage || !session) return null;
  if (!(await reservationOwnsSlot(workspaceId, action.target.ticketKey, action.target.runToken, action.target.runFence))) return null;
  return { ticket, stage, session };
}

function stale(keys: string[] = []): StageApplyResult {
  return { applied: false, reason: 'stale', keys };
}

const STAGE_COMPLETION_EVENT_TYPE = 'stage-completion';

interface StageCompletionMetadata {
  forgeRequired: boolean;
  pipelineDone: boolean;
  gated: boolean;
  ciBlocked: boolean;
}

export function stageCompletionMarkerId(workspaceId: string, clientRequestId: string): string {
  return deterministicObjectId(workspaceId, clientRequestId, 'stage-completion-marker');
}

function readStageCompletionMetadata(value: unknown): StageCompletionMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.forgeRequired !== 'boolean' || typeof value.pipelineDone !== 'boolean'
    || typeof value.gated !== 'boolean' || typeof value.ciBlocked !== 'boolean') return null;
  return {
    forgeRequired: value.forgeRequired,
    pipelineDone: value.pipelineDone,
    gated: value.gated,
    ciBlocked: value.ciBlocked,
  };
}

//? The deterministic marker is written after every other completion side effect and
//? immediately before the session status. A retry can therefore repair either a stopped
//? session or the narrow marker→status crash window while preserving the original outcome.
async function stageCompletionFromMarker(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageTurnCompleteInternalAction,
  repairStatus: boolean,
): Promise<StageTurnCompleteResult | null> {
  const marker = await prisma.ticketEvent.findFirst({
    where: {
      id: stageCompletionMarkerId(workspaceId, action.clientRequestId),
      workspaceId,
      ticketId: action.target.ticketId,
      stageId: action.target.stageId,
      sessionKey: `worker:${action.target.ticketId}:${action.target.stageId}`,
      type: STAGE_COMPLETION_EVENT_TYPE,
    },
    select: { metadata: true },
  });
  const metadata = readStageCompletionMetadata(marker?.metadata);
  if (!metadata) return null;
  const session = await prisma.agentSession.findFirst({
    where: {
      id: action.target.sessionId,
      workspaceId,
      ticketId: action.target.ticketId,
      stageId: action.target.stageId,
      kind: 'worker',
      sessionKey: `worker:${action.target.ticketId}:${action.target.stageId}`,
      runToken: action.target.runToken,
      runFence: action.target.runFence,
      containerId: action.payload.containerId,
      status: { in: ['busy', 'stopped'] },
    },
    select: { claudeSessionId: true, tokenEstimate: true },
  });
  if (!session) return null;
  let current = session;
  if (repairStatus) {
    const expectedStatus = action.payload.turn.kind === 'needs-input' ? 'busy' : 'stopped';
    const claudeSessionId = action.payload.claudeSessionId ?? session.claudeSessionId;
    const repaired = await prisma.agentSession.updateMany({
      where: {
        id: action.target.sessionId,
        workspaceId,
        runToken: action.target.runToken,
        runFence: action.target.runFence,
        containerId: action.payload.containerId,
      },
      data: {
        status: expectedStatus,
        ...(claudeSessionId === null ? {} : { claudeSessionId }),
      },
    });
    if (repaired.count !== 1) return null;
    const reloaded = await prisma.agentSession.findUnique({
      where: { id: action.target.sessionId },
      select: { claudeSessionId: true, tokenEstimate: true },
    });
    if (!reloaded) return null;
    current = reloaded;
  }
  return {
    applied: true,
    keys: [action.target.ticketKey],
    ...metadata,
    claudeSessionId: current.claudeSessionId,
    tokenEstimate: current.tokenEstimate,
  };
}

//? F44 — the immediate "a question is waiting" notification + web push for a NEWLY asked question.
//? Recipient: the ticket's assignee, else its creator, else the workspace owner — the human who is
//? actually expected to answer. Every step is tryCatch'd: an audit/notify failure is never allowed to
//? roll back a completed stage write.
export async function notifyNewQuestion(
  prisma: PrismaClient,
  input: { workspaceId: string; ticketId: string; ticketKey: string; question: string },
): Promise<{ notified: boolean; recipient: string | null }> {
  const [, outcome] = await tryCatch(async () => {
    const ticket = await prisma.ticket.findFirst({
      where: { workspaceId: input.workspaceId, id: input.ticketId },
      select: { assigneeId: true, creatorId: true },
    });
    const owner = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { ownerId: true } });
    const recipient = ticket?.assigneeId ?? ticket?.creatorId ?? owner?.ownerId ?? null;
    if (!recipient) return { notified: false, recipient: null };

    const title = 'A question is waiting';
    const body = `${input.ticketKey}: ${input.question.slice(0, 160)}`;
    //? Deterministic id so a retried writer action cannot produce a second notification for the same
    //? question (the whole action layer is idempotent; this must be too).
    const notificationId = deterministicObjectId(input.workspaceId, `needs-input:${input.ticketId}`, needsInputHash(input.question));
    await prisma.notification.upsert({
      where: { id: notificationId },
      create: {
        id: notificationId,
        workspaceId: input.workspaceId,
        userId: recipient,
        type: 'question',
        title,
        body,
        ticketId: input.ticketId,
        deepLink: jsonInput({ view: 'board', ticketId: input.ticketKey }),
        read: false,
      },
      update: {},
    });

    //? The push itself is what makes this phone-first; imported lazily so the writer keeps no web-push
    //? dependency at module load (the same pattern the publish path uses).
    const { sendWebPush } = await import('../hooks/webPush');
    await sendWebPush(prisma, recipient, { title, body, url: `/?ticket=${input.ticketKey}`, tag: `question-${input.ticketKey}` }, 'assignment');
    return { notified: true, recipient };
  });
  return outcome ?? { notified: false, recipient: null };
}

export async function applyStageActivationComplete(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageActivationCompleteInternalAction,
): Promise<StageActivationCompleteResult> {
  assertWorkspaceWriterContext(workspaceId);
  const ticket = await prisma.ticket.findFirst({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      stageId: action.target.stageId,
      archived: false,
      status: { notIn: ['done', 'paused'] },
    },
    select: { id: true, branch: true, commitHash: true },
  });
  const stage = ticket
    ? await prisma.pipelineStage.findFirst({
        where: { workspaceId, projectId: action.target.projectId, key: action.target.stageId },
        select: { id: true, aiEnabled: true },
      })
    : null;
  if (!ticket || stage?.aiEnabled !== true) return { ...stale(), changed: false };
  if (ticket.branch !== null && ticket.branch !== action.payload.branch) return { ...stale(), changed: false };
  if (ticket.branch === action.payload.branch && ticket.commitHash === action.payload.commitHash) {
    return { applied: true, keys: [action.target.ticketKey], changed: false };
  }
  const updated = await prisma.ticket.updateMany({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      stageId: action.target.stageId,
    },
    data: { branch: action.payload.branch, commitHash: action.payload.commitHash },
  });
  return updated.count === 1
    ? { applied: true, keys: [action.target.ticketKey], changed: true }
    : { ...stale(), changed: false };
}

export async function applyStageSessionStart(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageSessionStartInternalAction,
): Promise<StageSessionStartResult> {
  assertWorkspaceWriterContext(workspaceId);
  const ownsReservation = (): Promise<boolean> => reservationOwnsSlot(
    workspaceId,
    action.target.ticketKey,
    action.payload.runToken,
    action.payload.runFence,
  );
  if (!(await ownsReservation())) return { applied: false, reason: 'stale', keys: [] };
  const ticket = await prisma.ticket.findFirst({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      stageId: action.target.stageId,
      archived: false,
      status: { notIn: ['done', 'paused'] },
    },
    select: { id: true },
  });
  const stage = ticket
    ? await prisma.pipelineStage.findFirst({
        where: { workspaceId, projectId: action.target.projectId, key: action.target.stageId },
        select: { id: true },
      })
    : null;
  const expectedSessionKey = `worker:${action.target.ticketId}:${action.target.stageId}`;
  if (!ticket || !stage || action.payload.sessionKey !== expectedSessionKey || !(await ownsReservation())) {
    return { applied: false, reason: 'stale', keys: [] };
  }

  const existing = await prisma.agentSession.findUnique({
    where: { workspaceId_sessionKey: { workspaceId, sessionKey: expectedSessionKey } },
    select: { id: true, runFence: true },
  });
  if (existing && existing.runFence > action.payload.runFence) return { applied: false, reason: 'stale', keys: [] };
  const data = {
    ticketId: action.target.ticketId,
    stageId: action.target.stageId,
    kind: 'worker',
    status: 'busy',
    runToken: action.payload.runToken,
    runFence: action.payload.runFence,
    containerId: action.payload.containerId,
    worktreePath: '/work',
    cliVersion: action.payload.cliVersion,
    model: action.payload.model,
    startedAt: new Date(),
    lastHeartbeatAt: null,
  };
  let sessionId: string;
  if (existing) {
    const updated = await prisma.agentSession.updateMany({
      where: { id: existing.id, workspaceId, runFence: { lte: action.payload.runFence } },
      data,
    });
    if (updated.count !== 1) return { applied: false, reason: 'stale', keys: [] };
    sessionId = existing.id;
  } else {
    const created = await prisma.agentSession.create({
      data: { workspaceId, sessionKey: expectedSessionKey, ...data },
      select: { id: true },
    });
    sessionId = created.id;
  }

  //? Owner recheck closes the await/write window. A stale lower fence may have landed
  //? briefly, but it never reports success and can never overwrite a higher stored fence.
  if (!(await ownsReservation())) return { applied: false, reason: 'stale', keys: [] };
  const session = await prisma.agentSession.findFirst({
    where: {
      id: sessionId,
      workspaceId,
      runToken: action.payload.runToken,
      runFence: action.payload.runFence,
      containerId: action.payload.containerId,
    },
    select: { id: true, runToken: true, runFence: true, claudeSessionId: true, tokenEstimate: true },
  });
  if (!session?.runToken) return { applied: false, reason: 'stale', keys: [] };
  return { applied: true, session: { ...session, runToken: session.runToken }, keys: [action.target.ticketKey] };
}

export async function applyStageSessionUpdate(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageSessionUpdateInternalAction,
): Promise<StageApplyResult> {
  const run = await currentRun(prisma, workspaceId, action.target, action.payload.containerId);
  if (!run) return stale();
  const updated = await prisma.agentSession.updateMany({
    where: { id: run.session.id, workspaceId, runToken: action.target.runToken, runFence: action.target.runFence, containerId: action.payload.containerId },
    data: {
      status: action.payload.status,
      ...(action.payload.claudeSessionId === undefined ? {} : { claudeSessionId: action.payload.claudeSessionId }),
    },
  });
  if (updated.count !== 1) throw new Error('[stage-writer] current session disappeared inside the writer boundary');
  if (action.payload.failure === 'claude.notAuthenticated') {
    const ticket = await prisma.ticket.updateMany({ where: { workspaceId,
        id: action.target.ticketId,
        projectId: action.target.projectId,
        key: action.target.ticketKey,
        stageId: action.target.stageId,
      },
      data: { status: 'stuck' },
    });
    if (ticket.count !== 1) throw new Error('[stage-writer] current ticket disappeared while recording fatal stage failure');
  }
  return { applied: true, keys: [action.target.ticketKey] };
}

export async function applyStageToolTrailAppend(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageToolTrailAppendInternalAction,
): Promise<StageToolTrailResult> {
  const run = await currentRun(prisma, workspaceId, action.target, action.payload.containerId);
  if (!run) return { ...stale(), appended: 0 };
  let appended = 0;
  for (const entry of action.payload.entries) {
    const existing = await prisma.ticketEvent.findUnique({ where: { id: entry.eventId }, select: { id: true } });
    if (existing) continue;
    const last = await prisma.ticketEvent.findFirst({
      where: { workspaceId, ticketId: action.target.ticketId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    await prisma.ticketEvent.upsert({
      where: { id: entry.eventId },
      create: {
        id: entry.eventId,
        workspaceId,
        ticketId: action.target.ticketId,
        seq: (last?.seq ?? 0) + 1,
        type: entry.type,
        actor: 'ai',
        sessionKey: run.session.sessionKey,
        stageId: action.target.stageId,
        text: entry.text,
        metadata: jsonInput(entry.metadata),
      },
      update: {},
    });
    appended += 1;
  }
  return { applied: true, keys: [action.target.ticketKey], appended };
}

type StageCiStatus = 'none' | 'success' | 'failed' | 'canceled';

async function applyStageCiReport(
  prisma: PrismaClient,
  workspaceId: string,
  run: NonNullable<Awaited<ReturnType<typeof currentRun>>>,
  action: StageTurnCompleteInternalAction,
  report: StageCiReport,
): Promise<StageCiStatus> {
  const persisted = await persistCiReport(prisma, workspaceId, report, {
    projectId: action.target.projectId,
    ticketId: action.target.ticketId,
    trigger: 'test-stage',
    stageId: action.target.stageId,
    sessionKey: run.session.sessionKey,
    containerId: run.session.containerId,
    clientRequestId: action.clientRequestId,
  });
  return persisted.status;
}

async function applyTurnSpend(
  prisma: PrismaClient,
  workspaceId: string,
  run: NonNullable<Awaited<ReturnType<typeof currentRun>>>,
  action: StageTurnCompleteInternalAction,
): Promise<void> {
  const tokensIn = estTokens(action.payload.spend.inputChars);
  const tokensOut = estTokens(action.payload.spend.outputChars);
  const costEstimate = ((tokensIn + tokensOut) / 1000) * priceFor(action.payload.spend.model);
  const spendId = deterministicObjectId(workspaceId, action.clientRequestId, 'stage-spend');
  await prisma.spendRecord.upsert({
    where: { id: spendId },
    create: {
      id: spendId,
      workspaceId,
      userId: action.payload.spend.userId,
      ticketId: action.target.ticketId,
      stageId: action.target.stageId,
      sessionKey: run.session.sessionKey,
      tokensIn,
      tokensOut,
      model: action.payload.spend.model,
      costEstimate,
      providerId: 'claude-cli',
      feature: 'pipeline-agent',
    },
    update: {},
  });

  //? Counter writes cannot share a Mongo transaction with every append-only row. Recompute
  //? them from the deterministic SpendRecord ledger so a crash after row-create but before
  //? counter-update is repaired by the next retry instead of double-incrementing or staying low.
  const latestReset = await prisma.handoff.findFirst({
    where: { workspaceId, sessionKey: run.session.sessionKey },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const sessionSpend = await prisma.spendRecord.aggregate({
    where: {
      workspaceId,
      sessionKey: run.session.sessionKey,
      ...(latestReset ? { createdAt: { gt: latestReset.createdAt } } : {}),
    },
    _sum: { tokensIn: true, tokensOut: true },
  });
  const sessionUpdate = await prisma.agentSession.updateMany({
    where: { id: action.target.sessionId, workspaceId, runToken: action.target.runToken, runFence: action.target.runFence, containerId: action.payload.containerId },
    data: { tokenEstimate: (sessionSpend._sum.tokensIn ?? 0) + (sessionSpend._sum.tokensOut ?? 0) },
  });
  if (sessionUpdate.count !== 1) throw new Error('[stage-writer] current session disappeared while applying spend');

  const budgets = await prisma.workspaceBudget.findMany({ where: { workspaceId, enabled: true }, select: { id: true, windowStartAt: true } });
  for (const budget of budgets) {
    const total = await prisma.spendRecord.aggregate({
      where: { workspaceId, createdAt: { gte: budget.windowStartAt } },
      _sum: { costEstimate: true },
    });
    await prisma.workspaceBudget.update({ where: { id: budget.id }, data: { spent: total._sum.costEstimate ?? 0 } });
  }
}

export async function applyStageTurnComplete(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageTurnCompleteInternalAction,
): Promise<StageTurnCompleteResult> {
  assertWorkspaceWriterContext(workspaceId);
  const repaired = await stageCompletionFromMarker(prisma, workspaceId, action, true);
  if (repaired) return repaired;
  //? This is the ONLY fresh stale boundary. It runs before Spend/CI/Event/CarryOver/Handoff writes and
  //? validates ticket + session + runToken + container while the single writer is held. No later
  //? CAS can legitimately become stale inside this same writer action.
  const run = await currentRun(prisma, workspaceId, action.target, action.payload.containerId)
    ?? await partialCompletionRun(prisma, workspaceId, action);
  if (run?.session.status !== 'busy') {
    return { ...stale(), forgeRequired: false, pipelineDone: false, gated: false, ciBlocked: false, claudeSessionId: null, tokenEstimate: 0 };
  }

  await applyTurnSpend(prisma, workspaceId, run, action);
  const claudeSessionId = action.payload.claudeSessionId ?? run.session.claudeSessionId;
  const turn = action.payload.turn;
  let forgeRequired = false;
  let pipelineDone = false;
  let gated = false;
  let ciBlocked = false;

  if (turn.kind === 'done') {
    const nextStage = await prisma.pipelineStage.findFirst({
      where: { workspaceId, projectId: action.target.projectId, order: { gt: run.stage.order } },
      orderBy: { order: 'asc' },
    });
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { autonomyLevel: true },
    });
    gated = resolveStageGate(run.stage.gateForApproval, workspace?.autonomyLevel);
    if (isTestStage(run.stage.kind)) {
      const ciStatus = action.payload.ci
        ? await applyStageCiReport(prisma, workspaceId, run, action, action.payload.ci)
        : 'none';
      ciBlocked = testStageCiVerdict(ciStatus) === 'fail';
    }
    const carryOverId = deterministicObjectId(workspaceId, action.clientRequestId, 'stage-carry-over');
    await prisma.carryOver.upsert({
      where: { id: carryOverId },
      create: {
        id: carryOverId,
        workspaceId,
        ticketId: action.target.ticketId,
        fromStageId: action.target.stageId,
        toStageId: nextStage?.key ?? action.target.stageId,
        sessionId: action.target.sessionId,
        envelope: jsonInput({
          summary: turn.envelope.summary,
          changedFiles: turn.envelope.changedFiles,
          openQuestions: turn.envelope.openQuestions,
          ...(turn.envelope.commitHash ? { commitHash: turn.envelope.commitHash } : {}),
          ...(typeof turn.envelope.complexityScore === 'number' ? { complexityScore: turn.envelope.complexityScore } : {}),
        }),
      },
      update: {},
    });

    let advisoryQuestionsUpdate: ReturnType<typeof jsonInput> | null = null;
    if (turn.envelope.advisories && turn.envelope.advisories.length > 0) {
      const existing = parseAdvisories(run.ticket.advisoryQuestions);
      const seen = new Set(existing.map((question) => question.q));
      const additions = turn.envelope.advisories
        .filter((advisory) => !seen.has(advisory.q))
        .map((advisory) => ({ q: advisory.q, assumption: advisory.assumption, a: null, resolved: false }));
      if (additions.length > 0) advisoryQuestionsUpdate = jsonInput([...existing, ...additions]);
    }

    const ticketUpdate = await prisma.ticket.updateMany({
      where: {
        id: action.target.ticketId,
        workspaceId,
        projectId: action.target.projectId,
        key: action.target.ticketKey,
        stageId: action.target.stageId,
      },
      data: {
        carryOver: turn.envelope.summary,
        ...(advisoryQuestionsUpdate === null ? {} : { advisoryQuestions: advisoryQuestionsUpdate }),
        ...(ciBlocked
          ? { needsInput: 'CI failed — fix the failing tests before this ticket advances.', status: 'needs-input', remindedAt: null }
          : (nextStage && !gated
            ? { stageId: nextStage.key }
            : {})),
      },
    });
    if (ticketUpdate.count !== 1) {
      const alreadyAdvanced = !ciBlocked && nextStage !== null && !gated
        ? await prisma.ticket.findFirst({
            where: {
              id: action.target.ticketId,
              workspaceId,
              projectId: action.target.projectId,
              key: action.target.ticketKey,
              stageId: nextStage.key,
              carryOver: turn.envelope.summary,
              archived: false,
              status: { notIn: ['done', 'paused'] },
            },
            select: { id: true },
          })
        : null;
      if (!alreadyAdvanced) throw new Error('[stage-writer] current ticket disappeared inside the writer boundary');
    }
    forgeRequired = !ciBlocked && (gated || !nextStage);
    pipelineDone = !ciBlocked && !nextStage;
  } else if (turn.kind === 'needs-input') {
    const questions = turn.questions.map((question) => question.trim()).filter((question) => question.length > 0);
    if (questions.length > 0) {
      const ticketUpdate = await prisma.ticket.updateMany({
        where: {
          id: action.target.ticketId,
          workspaceId,
          projectId: action.target.projectId,
          key: action.target.ticketKey,
          stageId: action.target.stageId,
        },
        data: {
          needsInput: questions[0],
          needsInputQuestions: jsonInput(questions.map((question) => ({ q: question, a: null }))),
          status: 'needs-input',
          remindedAt: null,
        },
      });
      if (ticketUpdate.count !== 1) throw new Error('[stage-writer] current ticket disappeared inside the writer boundary');
      //? F44 — THE fix for the silent loop. A brand-new question used to notify nobody: this write sets
      //? `remindedAt: null`, and the watchdog's reminder path only notifies when `remindedAt !== null`, so
      //? the first push waited for the reminder sweep — two hours by default, on the one loop this product
      //? is built around (ask → phone buzzes → human answers). The question now pushes IMMEDIATELY, and the
      //? reminder stays what it is: a reminder. Best-effort by design: a failed push must never fail the
      //? authoritative ticket write that already succeeded.
      await notifyNewQuestion(prisma, {
        workspaceId,
        ticketId: action.target.ticketId,
        ticketKey: action.target.ticketKey,
        question: questions[0] ?? '',
      });
    }
  }

  const completionMetadata: StageCompletionMetadata = { forgeRequired, pipelineDone, gated, ciBlocked };
  const markerId = stageCompletionMarkerId(workspaceId, action.clientRequestId);
  const markerExists = await prisma.ticketEvent.findUnique({ where: { id: markerId }, select: { id: true } });
  if (!markerExists) {
    const last = await prisma.ticketEvent.findFirst({
      where: { workspaceId, ticketId: action.target.ticketId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    await prisma.ticketEvent.upsert({
      where: { id: markerId },
      create: {
        id: markerId,
        workspaceId,
        ticketId: action.target.ticketId,
        seq: (last?.seq ?? 0) + 1,
        type: STAGE_COMPLETION_EVENT_TYPE,
        actor: 'conductor',
        sessionKey: run.session.sessionKey,
        stageId: action.target.stageId,
        text: 'Stage completion applied',
        metadata: jsonInput(completionMetadata),
      },
      update: {},
    });
  }

  //? This terminal/busy status write is intentionally the first authoritative write
  //? after the marker. A retry repairs this exact narrow gap from marker metadata.
  const sessionUpdate = await prisma.agentSession.updateMany({
    where: {
      id: action.target.sessionId,
      workspaceId,
      runToken: action.target.runToken,
      runFence: action.target.runFence,
      containerId: action.payload.containerId,
    },
    data: {
      status: turn.kind === 'needs-input' ? 'busy' : 'stopped',
      ...(claudeSessionId === null ? {} : { claudeSessionId }),
    },
  });
  if (sessionUpdate.count !== 1) throw new Error('[stage-writer] current session disappeared inside the writer boundary');
  const session = await prisma.agentSession.findFirst({
    where: { id: action.target.sessionId, workspaceId, runToken: action.target.runToken, runFence: action.target.runFence, containerId: action.payload.containerId },
    select: { claudeSessionId: true, tokenEstimate: true },
  });
  if (!session) throw new Error('[stage-writer] current session could not be re-read inside the writer boundary');
  return {
    applied: true,
    keys: [action.target.ticketKey],
    forgeRequired,
    pipelineDone,
    gated,
    ciBlocked,
    claudeSessionId: session.claudeSessionId,
    tokenEstimate: session.tokenEstimate,
  };
}

//? Terminal Conductor dedup stores only `{keys}`. The deterministic completion marker
//? is the durable rich result; never re-derive forge/gate decisions from later ticket state.
export async function reloadStageTurnCompleteResult(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageTurnCompleteInternalAction,
): Promise<StageTurnCompleteResult | null> {
  return stageCompletionFromMarker(prisma, workspaceId, action, false);
}

export async function applyStageHandoffComplete(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageHandoffCompleteInternalAction,
): Promise<StageApplyResult> {
  const run = await currentRun(prisma, workspaceId, action.target, action.payload.containerId);
  if (run?.session.claudeSessionId !== action.payload.expectedClaudeSessionId) return stale();
  await recordHandoff(prisma, {
    id: deterministicObjectId(workspaceId, action.clientRequestId, 'stage-handoff'),
    workspaceId,
    sessionKey: run.session.sessionKey,
    ticketId: action.target.ticketId,
    stageId: action.target.stageId,
    body: action.payload.body,
    reason: action.payload.reason,
  });
  const updated = await prisma.agentSession.updateMany({
    where: {
      id: action.target.sessionId,
      workspaceId,
      runToken: action.target.runToken,
      runFence: action.target.runFence,
      containerId: action.payload.containerId,
      claudeSessionId: action.payload.expectedClaudeSessionId,
    },
    data: { claudeSessionId: null, tokenEstimate: 0 },
  });
  if (updated.count !== 1) throw new Error('[stage-writer] current handoff session disappeared inside the writer boundary');
  return { applied: true, keys: [action.target.ticketKey] };
}

export async function applyStageForgePrepare(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageForgePrepareInternalAction,
): Promise<StageForgePrepareResult> {
  const run = await currentRun(prisma, workspaceId, action.target, action.payload.containerId);
  const intentId = stageForgeIntentId(workspaceId, action.clientRequestId);
  if (run?.ticket.branch !== action.payload.expectedBranch) return { ...stale(), intentId };
  return { applied: true, keys: [action.target.ticketKey], intentId };
}

interface StoredForgeIntent {
  id: string;
  ticketId: string;
  ticketKey: string;
  projectId: string;
  stageId: string;
  sessionId: string;
  runToken: string;
  runFence: number;
  containerId: string;
  expectedBranch: string;
}

function readStoredForgeIntent(value: unknown): StoredForgeIntent | null {
  if (!isRecord(value) || !isRecord(value.intent)) return null;
  const intent = value.intent;
  const fields = ['id', 'ticketId', 'ticketKey', 'projectId', 'stageId', 'sessionId', 'runToken', 'containerId', 'expectedBranch'] as const;
  if (fields.some((field) => typeof intent[field] !== 'string')) return null;
  if (typeof intent.runFence !== 'number' || !Number.isSafeInteger(intent.runFence) || intent.runFence <= 0) return null;
  return {
    id: String(intent.id),
    ticketId: String(intent.ticketId),
    ticketKey: String(intent.ticketKey),
    projectId: String(intent.projectId),
    stageId: String(intent.stageId),
    sessionId: String(intent.sessionId),
    runToken: String(intent.runToken),
    runFence: intent.runFence,
    containerId: String(intent.containerId),
    expectedBranch: String(intent.expectedBranch),
  };
}

export async function applyStageForgeComplete(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageForgeCompleteInternalAction,
): Promise<StageForgeCompleteResult> {
  assertWorkspaceWriterContext(workspaceId);
  if (!(await reservationOwnsSlot(workspaceId, action.target.ticketKey, action.target.runToken, action.target.runFence))) return { ...stale(), changed: false };
  const [ticket, session, signal] = await Promise.all([
    prisma.ticket.findFirst({
      where: {
        id: action.target.ticketId,
        workspaceId,
        projectId: action.target.projectId,
        key: action.target.ticketKey,
        branch: action.payload.expectedBranch,
      },
      select: { mrUrl: true },
    }),
    prisma.agentSession.findFirst({
      where: {
        id: action.target.sessionId,
        workspaceId,
        ticketId: action.target.ticketId,
        stageId: action.target.stageId,
        kind: 'worker',
        sessionKey: `worker:${action.target.ticketId}:${action.target.stageId}`,
        runToken: action.target.runToken,
        runFence: action.target.runFence,
        containerId: action.payload.containerId,
      },
      select: { id: true },
    }),
    prisma.workspaceSignal.findFirst({
      where: { id: action.payload.intentId, workspaceId, kind: 'stage-forge-prepare', processedAt: { not: null } },
      select: { payload: true },
    }),
  ]);
  const intent = readStoredForgeIntent(signal?.payload);
  const matchesIntent = intent !== null
    && intent.id === action.payload.intentId
    && intent.ticketId === action.target.ticketId
    && intent.ticketKey === action.target.ticketKey
    && intent.projectId === action.target.projectId
    && intent.stageId === action.target.stageId
    && intent.sessionId === action.target.sessionId
    && intent.runToken === action.target.runToken
    && intent.runFence === action.target.runFence
    && intent.containerId === action.payload.containerId
    && intent.expectedBranch === action.payload.expectedBranch;
  if (!ticket || !session || !matchesIntent) return { ...stale(), changed: false };
  if (!(await reservationOwnsSlot(workspaceId, action.target.ticketKey, action.target.runToken, action.target.runFence))) return { ...stale(), changed: false };
  if (ticket.mrUrl === action.payload.mrUrl) return { applied: true, keys: [action.target.ticketKey], changed: false };

  //? No stageId predicate here: a planned promotion after the durable prepare signal
  //? may advance the ticket while the authorized push/MR request is in flight. Session,
  //? capacity owner, project, branch, and the exact prepare intent remain mandatory.
  const updated = await prisma.ticket.updateMany({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      branch: action.payload.expectedBranch,
    },
    data: { mrUrl: action.payload.mrUrl },
  });
  if (updated.count !== 1) throw new Error('[stage-writer] prepared forge ticket disappeared inside the writer boundary');
  return { applied: true, keys: [action.target.ticketKey], changed: true };
}

export async function applyStageDeferUpdate(
  prisma: PrismaClient,
  workspaceId: string,
  action: StageDeferUpdateInternalAction,
): Promise<StageApplyResult> {
  assertWorkspaceWriterContext(workspaceId);
  const ticket = await prisma.ticket.findFirst({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      stageId: action.target.stageId,
    },
    select: { id: true },
  });
  if (!ticket) return stale();
  if (action.payload.mode === 'clear') {
    await prisma.ticket.updateMany({
      where: {
        id: ticket.id,
        workspaceId,
        OR: [
          { needsInput: { in: [EDITOR_DEFER_MSG, CAPACITY_DEFER_MSG] } },
          { needsInput: { startsWith: BLOCKED_DEFER_MSG } },
        ],
      },
      data: { needsInput: null },
    });
    return { applied: true, keys: [action.target.ticketKey] };
  }
  const message = action.payload.reason === 'editor'
    ? EDITOR_DEFER_MSG
    : (action.payload.reason === 'capacity'
      ? CAPACITY_DEFER_MSG
      : `${BLOCKED_DEFER_MSG}: ${action.payload.blockers.join(', ')}`);
  await prisma.ticket.updateMany({ where: { id: ticket.id, workspaceId }, data: { needsInput: message } });
  return { applied: true, keys: [action.target.ticketKey] };
}
