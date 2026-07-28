//? Single-writer recovery boundary. Watchdog/reaper scans and Docker work stay read/external;
//? only these typed InternalOps may fence a stage owner or mutate its AgentSession/reminder state.

import { createHash } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';

import { jsonInput } from '../util/json';
import { deterministicObjectId } from './actionIds';
import {
  cancelRecoveryReservation,
  cancelRecoveryReservationStrict,
  ensureRecoveryReservation,
  prepareRecoveryReservation,
  recoveryReservation,
  releaseSlotStrict,
  reservationFenceStrict,
  reservationOwnsSlotStrict,
  type SlotReservation,
} from './capacity';
import type {
  AgentRecoveryExpected,
  AgentRecoveryReason,
  AgentRecoveryTransitionInternalAction,
  WatchdogReminderApplyInternalAction,
} from './internalOps';
import { assertWorkspaceWriterContext } from './writerContext';

export type RecoveryTransitionResult =
  | {
      applied: true;
      phase: 'prepare';
      keys: string[];
      intentId: string;
      recovery: { runToken: string; runFence: number };
    }
  | {
      applied: true;
      phase: 'complete' | 'cancel';
      keys: string[];
      intentId: string;
    }
  | {
      applied: false;
      phase: 'prepare' | 'complete' | 'cancel';
      reason: 'live' | 'stale' | 'unavailable';
      keys: string[];
      intentId: string;
    };

export interface ReminderApplyResult {
  applied: boolean;
  keys: string[];
  notified: boolean;
  notificationId: string | null;
  recipient: string | null;
  reason?: 'stale';
}

interface StoredRecoveryIntent {
  id: string;
  ticketId: string;
  ticketKey: string;
  projectId: string;
  stageId: string;
  sessionId: string;
  reason: AgentRecoveryReason;
  expected: AgentRecoveryExpected;
  recovery: { runToken: string; runFence: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function needsInputHash(value: string | null | undefined): string {
  return createHash('sha256').update(value == null ? 'null' : `string:${value}`).digest('hex');
}

export function recoveryIntentId(workspaceId: string, clientRequestId: string): string {
  return deterministicObjectId(workspaceId, clientRequestId, 'agent-recovery-intent');
}

export function reminderNotificationId(workspaceId: string, clientRequestId: string): string {
  return deterministicObjectId(workspaceId, clientRequestId, 'watchdog-reminder-notification');
}

function readExpected(value: unknown): AgentRecoveryExpected | null {
  if (!isRecord(value)) return null;
  if (typeof value.ticketStatus !== 'string' || typeof value.needsInputHash !== 'string') return null;
  if (value.sessionStatus !== 'busy' && value.sessionStatus !== 'paused') return null;
  if (typeof value.containerId !== 'string' || typeof value.runToken !== 'string') return null;
  if (typeof value.runFence !== 'number' || !Number.isSafeInteger(value.runFence) || value.runFence <= 0) return null;
  if (typeof value.startedAt !== 'number' || !Number.isSafeInteger(value.startedAt) || value.startedAt < 0) return null;
  return {
    ticketStatus: value.ticketStatus,
    needsInputHash: value.needsInputHash,
    sessionStatus: value.sessionStatus,
    containerId: value.containerId,
    runToken: value.runToken,
    runFence: value.runFence,
    startedAt: value.startedAt,
  };
}

function isRecoveryReason(value: unknown): value is AgentRecoveryReason {
  return value === 'boot' || value === 'stuck' || value === 'worker-reap' || value === 'manual-kill';
}

function readStoredRecoveryIntent(value: unknown): StoredRecoveryIntent | null {
  if (!isRecord(value) || !isRecord(value.intent)) return null;
  const intent = value.intent;
  const expected = readExpected(intent.expected);
  const recovery = isRecord(intent.recovery) ? intent.recovery : null;
  const stringFields = ['id', 'ticketId', 'ticketKey', 'projectId', 'stageId', 'sessionId'] as const;
  if (!expected || !recovery || !isRecoveryReason(intent.reason)
    || stringFields.some((field) => typeof intent[field] !== 'string')) return null;
  if (typeof recovery.runToken !== 'string' || typeof recovery.runFence !== 'number' || !Number.isSafeInteger(recovery.runFence) || recovery.runFence <= 0) return null;
  return {
    id: String(intent.id),
    ticketId: String(intent.ticketId),
    ticketKey: String(intent.ticketKey),
    projectId: String(intent.projectId),
    stageId: String(intent.stageId),
    sessionId: String(intent.sessionId),
    reason: intent.reason,
    expected,
    recovery: { runToken: recovery.runToken, runFence: recovery.runFence },
  };
}

function sameExpected(left: AgentRecoveryExpected, right: AgentRecoveryExpected): boolean {
  return left.ticketStatus === right.ticketStatus
    && left.needsInputHash === right.needsInputHash
    && left.sessionStatus === right.sessionStatus
    && left.containerId === right.containerId
    && left.runToken === right.runToken
    && left.runFence === right.runFence
    && left.startedAt === right.startedAt;
}

function recoveryFromIntent(workspaceId: string, ticketKey: string, intent: StoredRecoveryIntent): SlotReservation | null {
  const recovery = recoveryReservation(workspaceId, ticketKey, intent.id, intent.expected.runFence);
  return recovery.runToken === intent.recovery.runToken && recovery.fence === intent.recovery.runFence ? recovery : null;
}

interface StoredRecoverySignal {
  clientRequestId: string;
  userId: string;
  intent: StoredRecoveryIntent;
}

function readStoredRecoverySignal(value: unknown): StoredRecoverySignal | null {
  if (!isRecord(value) || value.op !== 'agent-recovery-transition'
    || typeof value.clientRequestId !== 'string' || typeof value.userId !== 'string') return null;
  const intent = readStoredRecoveryIntent(value);
  return intent ? { clientRequestId: value.clientRequestId, userId: value.userId, intent } : null;
}

async function loadRecoveryIntentSignal(
  prisma: PrismaClient,
  workspaceId: string,
  intentId: string,
  clientRequestId?: string,
): Promise<StoredRecoverySignal | null> {
  const signal = await prisma.workspaceSignal.findUnique({
    where: { id: intentId },
    select: { workspaceId: true, kind: true, payload: true },
  });
  //? The deterministic signal is appended before prepare mutates the session. A crash can therefore
  //? leave processedAt unset after the exact recovering state already landed. Every reconstruction
  //? below also proves the complete session/reservation identity, so the append-only intent itself
  //? is sufficient and prevents that crash window from stranding the session forever.
  if (signal?.workspaceId !== workspaceId || signal.kind !== 'agent-recovery-transition') return null;
  const stored = readStoredRecoverySignal(signal.payload);
  if (stored?.intent.id !== intentId
    || (clientRequestId !== undefined && stored.clientRequestId !== clientRequestId)) return null;
  return stored;
}

export function recoveryPrepareRequestId(input: {
  reason: AgentRecoveryReason;
  sessionId: string;
  runToken: string;
  runFence: number;
  startedAt: number;
}): string {
  return `agent-recovery-prepare:${input.reason}:${input.sessionId}:${input.runToken}:${String(input.runFence)}:${String(input.startedAt)}`;
}

export type AgentRecoveryPrepareAction = Omit<AgentRecoveryTransitionInternalAction, 'payload'> & {
  payload: Extract<AgentRecoveryTransitionInternalAction['payload'], { phase: 'prepare' }>;
};

export interface AcceptedRecoveryPrepare {
  prepare: AgentRecoveryPrepareAction;
  result: Extract<RecoveryTransitionResult, { applied: true; phase: 'prepare' }>;
  state: 'recovering' | 'canceling' | 'stopped';
}

function prepareMatchesIntent(action: AgentRecoveryTransitionInternalAction, intent: StoredRecoveryIntent): boolean {
  return action.payload.phase === 'prepare'
    && intent.ticketId === action.target.ticketId
    && intent.ticketKey === action.target.ticketKey
    && intent.projectId === action.target.projectId
    && intent.stageId === action.target.stageId
    && intent.sessionId === action.target.sessionId
    && intent.reason === action.payload.reason
    && sameExpected(intent.expected, action.payload.expected);
}

//? Terminal dedup intentionally replays only bounded keys. The deterministic append-only
//? prepare signal is the durable source for the rich recovery owner; a crashed short Redis
//? heartbeat may be restored only at the exact already-incremented fence and with no contender.
export async function reconstructAcceptedRecoveryPrepare(
  prisma: PrismaClient,
  action: AgentRecoveryTransitionInternalAction,
): Promise<AcceptedRecoveryPrepare | null> {
  if (action.payload.phase !== 'prepare') return null;
  const intentId = recoveryIntentId(action.workspaceId, action.clientRequestId);
  const stored = await loadRecoveryIntentSignal(prisma, action.workspaceId, intentId, action.clientRequestId);
  if (!stored || !prepareMatchesIntent(action, stored.intent)) return null;
  const recovery = recoveryFromIntent(action.workspaceId, action.target.ticketKey, stored.intent);
  if (!recovery) return null;
  const [recovering, stopped] = await Promise.all([
    exactSession(prisma, action.workspaceId, action, 'recovering'),
    exactSession(prisma, action.workspaceId, action, 'stopped'),
  ]);
  if (recovering) {
    const restored = await ensureRecoveryReservation(recovery);
    let state: AcceptedRecoveryPrepare['state'] | null = null;
    if (restored) state = 'recovering';
    else if (await reservationFenceStrict(action.workspaceId, action.target.ticketKey) === action.payload.expected.runFence) state = 'canceling';
    if (state === null) return null;
    return {
      prepare: { ...action, payload: action.payload },
      state,
      result: {
        applied: true,
        phase: 'prepare',
        keys: [action.target.ticketKey],
        intentId,
        recovery: { runToken: recovery.runToken, runFence: recovery.fence },
      },
    };
  }
  if (!stopped || await reservationOwnsSlotStrict(
    action.workspaceId,
    action.target.ticketKey,
    recovery.runToken,
    recovery.fence,
  )) return null;
  return {
    prepare: { ...action, payload: action.payload },
    state: 'stopped',
    result: {
      applied: true,
      phase: 'prepare',
      keys: [action.target.ticketKey],
      intentId,
      recovery: { runToken: recovery.runToken, runFence: recovery.fence },
    },
  };
}

export interface RecoveryPrepareSessionLookup {
  id: string;
  ticketId: string;
  stageId: string;
  status: 'recovering' | 'stopped';
  containerId: string;
  runToken: string;
  runFence: number;
  startedAt: number;
}

const RECOVERY_REASONS: readonly AgentRecoveryReason[] = ['boot', 'stuck', 'worker-reap', 'manual-kill'];

//? A recovering/stopped retry row has no recovery request id column by design. All four
//? callers use the same deterministic id shape, so the watchdog can locate the one durable
//? prepare intent without an unbounded JSON scan or a schema change.
export async function findAcceptedRecoveryPrepare(
  prisma: PrismaClient,
  workspaceId: string,
  session: RecoveryPrepareSessionLookup,
): Promise<AcceptedRecoveryPrepare | null> {
  for (const reason of RECOVERY_REASONS) {
    const clientRequestId = recoveryPrepareRequestId({
      reason,
      sessionId: session.id,
      runToken: session.runToken,
      runFence: session.runFence,
      startedAt: session.startedAt,
    });
    const intentId = recoveryIntentId(workspaceId, clientRequestId);
    const stored = await loadRecoveryIntentSignal(prisma, workspaceId, intentId, clientRequestId);
    if (stored?.intent.sessionId !== session.id || stored.intent.ticketId !== session.ticketId
      || stored.intent.stageId !== session.stageId || stored.intent.expected.containerId !== session.containerId
      || stored.intent.expected.runToken !== session.runToken || stored.intent.expected.runFence !== session.runFence
      || stored.intent.expected.startedAt !== session.startedAt) continue;
    const prepare: AgentRecoveryPrepareAction = {
      workspaceId,
      op: 'agent-recovery-transition',
      target: {
        ticketId: stored.intent.ticketId,
        ticketKey: stored.intent.ticketKey,
        projectId: stored.intent.projectId,
        stageId: stored.intent.stageId,
        sessionId: stored.intent.sessionId,
      },
      payload: {
        phase: 'prepare',
        reason: stored.intent.reason,
        expected: stored.intent.expected,
        observedAt: Date.now(),
      },
      userId: stored.userId,
      clientRequestId: stored.clientRequestId,
    };
    const accepted = await reconstructAcceptedRecoveryPrepare(prisma, prepare);
    if (accepted && (accepted.state === session.status
      || (session.status === 'recovering' && accepted.state === 'canceling'))) return accepted;
  }
  return null;
}

async function exactTicket(
  prisma: PrismaClient,
  workspaceId: string,
  action: AgentRecoveryTransitionInternalAction,
  status: string = action.payload.expected.ticketStatus,
): Promise<boolean> {
  const expected = action.payload.expected;
  const ticket = await prisma.ticket.findFirst({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      stageId: action.target.stageId,
      status,
      archived: false,
    },
    select: { needsInput: true },
  });
  return ticket !== null && needsInputHash(ticket.needsInput) === expected.needsInputHash;
}

async function setManualKillTicketStatus(
  prisma: PrismaClient,
  workspaceId: string,
  action: AgentRecoveryTransitionInternalAction,
  status: string,
): Promise<boolean> {
  if (action.payload.reason !== 'manual-kill') return true;
  const expectedStatus = action.payload.expected.ticketStatus;
  const updated = await prisma.ticket.updateMany({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      stageId: action.target.stageId,
      status: { in: [...new Set([expectedStatus, 'idle', 'paused', status])] },
      archived: false,
    },
    data: { status },
  });
  return updated.count === 1 && await exactTicket(prisma, workspaceId, action, status);
}

async function exactSession(
  prisma: PrismaClient,
  workspaceId: string,
  action: AgentRecoveryTransitionInternalAction,
  status: 'busy' | 'paused' | 'recovering' | 'stopped',
): Promise<boolean> {
  const expected = action.payload.expected;
  const session = await prisma.agentSession.findFirst({
    where: {
      id: action.target.sessionId,
      workspaceId,
      ticketId: action.target.ticketId,
      stageId: action.target.stageId,
      kind: 'worker',
      sessionKey: `worker:${action.target.ticketId}:${action.target.stageId}`,
      status,
      containerId: expected.containerId,
      runToken: expected.runToken,
      runFence: expected.runFence,
      startedAt: new Date(expected.startedAt),
    },
    select: { id: true },
  });
  return session !== null;
}

async function processedIntent(
  prisma: PrismaClient,
  workspaceId: string,
  action: AgentRecoveryTransitionInternalAction,
): Promise<{ intent: StoredRecoveryIntent; recovery: SlotReservation } | null> {
  if (action.payload.phase === 'prepare') return null;
  const storedSignal = await loadRecoveryIntentSignal(prisma, workspaceId, action.payload.intentId);
  const intent = storedSignal?.intent ?? null;
  if (intent?.id !== action.payload.intentId
    || intent.ticketId !== action.target.ticketId
    || intent.ticketKey !== action.target.ticketKey
    || intent.projectId !== action.target.projectId
    || intent.stageId !== action.target.stageId
    || intent.sessionId !== action.target.sessionId
    || intent.reason !== action.payload.reason
    || !sameExpected(intent.expected, action.payload.expected)) return null;
  const recovery = recoveryFromIntent(workspaceId, action.target.ticketKey, intent);
  return recovery ? { intent, recovery } : null;
}

async function applyPrepare(
  prisma: PrismaClient,
  workspaceId: string,
  action: AgentRecoveryTransitionInternalAction,
): Promise<RecoveryTransitionResult> {
  if (action.payload.phase !== 'prepare') throw new Error('[recovery-writer] expected prepare phase');
  const intentId = recoveryIntentId(workspaceId, action.clientRequestId);
  const expected = action.payload.expected;
  const retryRecovery = recoveryReservation(workspaceId, action.target.ticketKey, intentId, expected.runFence);
  const retryTicketMatches = await exactTicket(prisma, workspaceId, action)
    || (action.payload.reason === 'manual-kill' && await exactTicket(prisma, workspaceId, action, 'paused'));
  if (retryTicketMatches
    && await exactSession(prisma, workspaceId, action, 'recovering')
    && await reservationOwnsSlotStrict(workspaceId, action.target.ticketKey, retryRecovery.runToken, retryRecovery.fence)) {
    if (!(await setManualKillTicketStatus(prisma, workspaceId, action, 'paused'))) {
      throw new Error('[recovery-writer] manual-kill retry could not establish paused ticket state');
    }
    return {
      applied: true,
      phase: 'prepare',
      keys: [action.target.ticketKey],
      intentId,
      recovery: { runToken: retryRecovery.runToken, runFence: retryRecovery.fence },
    };
  }
  if (!(await exactTicket(prisma, workspaceId, action)) || !(await exactSession(prisma, workspaceId, action, expected.sessionStatus))) {
    return { applied: false, phase: 'prepare', reason: 'stale', keys: [], intentId };
  }
  const hardTurnMaxMs = Number(process.env.WS_TURN_MAX_MS ?? String(30 * 60 * 1000));
  if (action.payload.reason === 'stuck' && action.payload.observedAt - expected.startedAt < hardTurnMaxMs) {
    return { applied: false, phase: 'prepare', reason: 'stale', keys: [], intentId };
  }
  const prepared = await prepareRecoveryReservation({
    workspaceId,
    ticketKey: action.target.ticketKey,
    oldRunToken: expected.runToken,
    oldRunFence: expected.runFence,
    intentId,
    allowLiveOwner: action.payload.reason === 'stuck' || action.payload.reason === 'manual-kill',
    now: action.payload.observedAt,
  });
  if (!prepared.prepared) return { applied: false, phase: 'prepare', reason: prepared.reason, keys: [], intentId };

  const updated = await prisma.agentSession.updateMany({
    where: {
      id: action.target.sessionId,
      workspaceId,
      ticketId: action.target.ticketId,
      stageId: action.target.stageId,
      kind: 'worker',
      status: expected.sessionStatus,
      containerId: expected.containerId,
      runToken: expected.runToken,
      runFence: expected.runFence,
      startedAt: new Date(expected.startedAt),
    },
    data: { status: 'recovering' },
  });
  if (updated.count !== 1) {
    await cancelRecoveryReservation(prepared.reservation, expected.runFence);
    return { applied: false, phase: 'prepare', reason: 'stale', keys: [], intentId };
  }
  //? Manual kill parks the ticket only after its durable recovery fence exists. `paused`
  //? prevents capacity from recreating the canonical container before exact teardown finishes.
  //? Replay repairs a crash between the session and ticket writes.
  if (!(await setManualKillTicketStatus(prisma, workspaceId, action, 'paused'))) {
    const restored = await prisma.agentSession.updateMany({
      where: {
        id: action.target.sessionId,
        workspaceId,
        status: 'recovering',
        runToken: expected.runToken,
        runFence: expected.runFence,
        containerId: expected.containerId,
      },
      data: { status: expected.sessionStatus },
    });
    await cancelRecoveryReservation(prepared.reservation, expected.runFence);
    if (restored.count !== 1) throw new Error('[recovery-writer] manual-kill prepare rollback could not restore its session');
    return { applied: false, phase: 'prepare', reason: 'stale', keys: [], intentId };
  }
  return {
    applied: true,
    phase: 'prepare',
    keys: [action.target.ticketKey],
    intentId,
    recovery: { runToken: prepared.reservation.runToken, runFence: prepared.reservation.fence },
  };
}

export interface RecoveryWriterCapacityDependencies {
  owns: typeof reservationOwnsSlotStrict;
  release: typeof releaseSlotStrict;
  cancel: typeof cancelRecoveryReservationStrict;
  fence: typeof reservationFenceStrict;
}

const recoveryWriterCapacity: RecoveryWriterCapacityDependencies = {
  owns: reservationOwnsSlotStrict,
  release: releaseSlotStrict,
  cancel: cancelRecoveryReservationStrict,
  fence: reservationFenceStrict,
};

async function applyCompleteOrCancel(
  prisma: PrismaClient,
  workspaceId: string,
  action: AgentRecoveryTransitionInternalAction,
  capacity: RecoveryWriterCapacityDependencies,
): Promise<RecoveryTransitionResult> {
  if (action.payload.phase === 'prepare') throw new Error('[recovery-writer] expected terminal phase');
  const phase = action.payload.phase;
  const stored = await processedIntent(prisma, workspaceId, action);
  if (!stored) return { applied: false, phase, reason: 'stale', keys: [], intentId: action.payload.intentId };
  const exactRecovering = await exactSession(prisma, workspaceId, action, 'recovering');
  const exactStopped = phase === 'complete' && await exactSession(prisma, workspaceId, action, 'stopped');
  if (!exactRecovering && !exactStopped) return { applied: false, phase, reason: 'stale', keys: [], intentId: stored.intent.id };

  if (phase === 'complete') {
    const terminalTicketStatus = action.payload.reason === 'manual-kill' ? 'paused' : action.payload.expected.ticketStatus;
    if (!(await exactTicket(prisma, workspaceId, action, terminalTicketStatus))) {
      return { applied: false, phase, reason: 'stale', keys: [], intentId: stored.intent.id };
    }
    if (exactStopped) {
      const released = await capacity.release(stored.recovery);
      if (!released && await capacity.owns(
        workspaceId,
        action.target.ticketKey,
        stored.recovery.runToken,
        stored.recovery.fence,
      )) throw new Error('[recovery-writer] stopped recovery owner could not be released');
      return { applied: true, phase, keys: [action.target.ticketKey], intentId: stored.intent.id };
    }
    if (!(await capacity.owns(
      workspaceId,
      action.target.ticketKey,
      stored.recovery.runToken,
      stored.recovery.fence,
    ))) return { applied: false, phase, reason: 'stale', keys: [], intentId: stored.intent.id };

    //? Redis certainty comes first. A transport/script error throws while the session is
    //? still recovering; only a proven exact-owner release permits the stopped transition.
    if (!(await capacity.release(stored.recovery))) {
      return { applied: false, phase, reason: 'stale', keys: [], intentId: stored.intent.id };
    }
    const stopped = await prisma.agentSession.updateMany({
      where: {
        id: action.target.sessionId,
        workspaceId,
        status: 'recovering',
        runToken: action.payload.expected.runToken,
        runFence: action.payload.expected.runFence,
        containerId: action.payload.expected.containerId,
      },
      data: { status: 'stopped' },
    });
    if (stopped.count !== 1) throw new Error('[recovery-writer] released recovery session could not be stopped');
    return { applied: true, phase, keys: [action.target.ticketKey], intentId: stored.intent.id };
  }

  if (!exactRecovering) return { applied: false, phase, reason: 'stale', keys: [], intentId: stored.intent.id };
  const ownsRecovery = await capacity.owns(
    workspaceId,
    action.target.ticketKey,
    stored.recovery.runToken,
    stored.recovery.fence,
  );
  if (ownsRecovery) {
    if (!(await capacity.cancel(stored.recovery, action.payload.expected.runFence))) {
      return { applied: false, phase, reason: 'stale', keys: [], intentId: stored.intent.id };
    }
  } else if (await capacity.fence(workspaceId, action.target.ticketKey) !== action.payload.expected.runFence) {
    return { applied: false, phase, reason: 'stale', keys: [], intentId: stored.intent.id };
  }
  //? The old fence proves a prior cancel crossed Redis before a crash. Repairing the
  //? still-recovering row is therefore idempotent and cannot revive a successor.
  const restored = await prisma.agentSession.updateMany({
    where: {
      id: action.target.sessionId,
      workspaceId,
      status: 'recovering',
      runToken: action.payload.expected.runToken,
      runFence: action.payload.expected.runFence,
      containerId: action.payload.expected.containerId,
    },
    data: { status: action.payload.expected.sessionStatus },
  });
  if (restored.count !== 1) throw new Error('[recovery-writer] canceled recovery session could not be restored');
  if (!(await setManualKillTicketStatus(prisma, workspaceId, action, action.payload.expected.ticketStatus))) {
    throw new Error('[recovery-writer] canceled manual-kill could not restore its ticket');
  }
  return { applied: true, phase, keys: [action.target.ticketKey], intentId: stored.intent.id };
}

export async function applyAgentRecoveryTransition(
  prisma: PrismaClient,
  workspaceId: string,
  action: AgentRecoveryTransitionInternalAction,
  capacity: RecoveryWriterCapacityDependencies = recoveryWriterCapacity,
): Promise<RecoveryTransitionResult> {
  assertWorkspaceWriterContext(workspaceId);
  return action.payload.phase === 'prepare'
    ? applyPrepare(prisma, workspaceId, action)
    : applyCompleteOrCancel(prisma, workspaceId, action, capacity);
}

export function readRecoveryTransitionResult(value: unknown): RecoveryTransitionResult | null {
  if (!isRecord(value) || typeof value.applied !== 'boolean' || typeof value.phase !== 'string' || typeof value.intentId !== 'string') return null;
  if (value.phase !== 'prepare' && value.phase !== 'complete' && value.phase !== 'cancel') return null;
  const keys = stringArray(value.keys);
  if (!value.applied) {
    if (value.reason !== 'live' && value.reason !== 'stale' && value.reason !== 'unavailable') return null;
    return { applied: false, phase: value.phase, reason: value.reason, keys, intentId: value.intentId };
  }
  if (value.phase === 'prepare') {
    if (!isRecord(value.recovery) || typeof value.recovery.runToken !== 'string' || typeof value.recovery.runFence !== 'number') return null;
    return { applied: true, phase: 'prepare', keys, intentId: value.intentId, recovery: { runToken: value.recovery.runToken, runFence: value.recovery.runFence } };
  }
  return { applied: true, phase: value.phase, keys, intentId: value.intentId };
}

export async function applyWatchdogReminder(
  prisma: PrismaClient,
  workspaceId: string,
  action: WatchdogReminderApplyInternalAction,
): Promise<ReminderApplyResult> {
  assertWorkspaceWriterContext(workspaceId);
  const expected = action.payload.expected;
  const ticket = await prisma.ticket.findFirst({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      stageId: action.target.stageId,
      status: expected.ticketStatus,
      archived: false,
    },
    select: { needsInput: true, remindedAt: true, assigneeId: true, creatorId: true },
  });
  const remindedAt = ticket?.remindedAt?.getTime() ?? null;
  const recipient = ticket?.assigneeId ?? ticket?.creatorId ?? null;
  const notified = expected.remindedAt !== null && recipient !== null;
  const notificationId = notified ? reminderNotificationId(workspaceId, action.clientRequestId) : null;
  if (ticket && needsInputHash(ticket.needsInput) === expected.needsInputHash && remindedAt === action.payload.now) {
    const notificationExists = notificationId === null
      || await prisma.notification.findFirst({ where: { id: notificationId, workspaceId, userId: recipient ?? undefined }, select: { id: true } }) !== null;
    if (notificationExists) return { applied: true, keys: [action.target.ticketKey], notified, notificationId, recipient };
  }
  if (!ticket || needsInputHash(ticket.needsInput) !== expected.needsInputHash || remindedAt !== expected.remindedAt) {
    return { applied: false, reason: 'stale', keys: [], notified: false, notificationId: null, recipient: null };
  }
  if (expected.remindedAt !== null && action.payload.now - expected.remindedAt < action.payload.intervalMs) {
    return { applied: false, reason: 'stale', keys: [], notified: false, notificationId: null, recipient: null };
  }
  if (notified && notificationId && recipient) {
    await prisma.notification.upsert({
      where: { id: notificationId },
      create: {
        id: notificationId,
        workspaceId,
        userId: recipient,
        type: 'reminder',
        title: 'A question is waiting',
        body: `${action.target.ticketKey} is still waiting for your answer.`,
        ticketId: action.target.ticketId,
        deepLink: jsonInput({ view: 'board', ticketId: action.target.ticketKey }),
        read: false,
      },
      update: {},
    });
  }
  const updated = await prisma.ticket.updateMany({
    where: {
      id: action.target.ticketId,
      workspaceId,
      projectId: action.target.projectId,
      key: action.target.ticketKey,
      stageId: action.target.stageId,
      status: expected.ticketStatus,
      archived: false,
      ...(ticket.needsInput === null ? {} : { needsInput: ticket.needsInput }),
      ...(expected.remindedAt === null
        ? { OR: [{ remindedAt: null }, { remindedAt: { isSet: false } }] }
        : { remindedAt: new Date(expected.remindedAt) }),
    },
    data: { remindedAt: new Date(action.payload.now) },
  });
  if (updated.count !== 1) throw new Error('[recovery-writer] reminder ticket disappeared inside writer boundary');
  return { applied: true, keys: [action.target.ticketKey], notified, notificationId, recipient };
}

export function readReminderApplyResult(value: unknown): ReminderApplyResult | null {
  if (!isRecord(value) || typeof value.applied !== 'boolean' || typeof value.notified !== 'boolean') return null;
  if (value.notificationId !== null && typeof value.notificationId !== 'string') return null;
  if (value.recipient !== null && typeof value.recipient !== 'string') return null;
  return {
    applied: value.applied,
    keys: stringArray(value.keys),
    notified: value.notified,
    notificationId: value.notificationId,
    recipient: value.recipient,
    ...(!value.applied && value.reason === 'stale' ? { reason: 'stale' as const } : {}),
  };
}
