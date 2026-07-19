//? Fenced crash-recovery watchdog. The @luckystack/cron overlay owns scheduling,
//? leadership, overlap, and run dedup; this module performs one idempotent read sweep.
//? Global enumeration is read-only. Every tenant read and every InternalOp enters runInTenant.

import { formatKey, getPrismaClient, redis, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { sendWebPush } from '../hooks/webPush';
import { runInTenant } from '../tenant/tenantContext';
import { runAgentRecovery } from './agentControl';
import { reservationOwnsSlot } from './capacity';
import { reprovisionTicket, reprovisionTicketAndWait, EDITOR_DEFER_MSG, CAPACITY_DEFER_MSG } from './conductor';
import { isEditorRunning } from './editGuard';
import type { AgentRecoveryExpected, AgentRecoveryReason, AgentRecoveryTransitionInternalAction, StageTarget } from './internalOps';
import {
  findAcceptedRecoveryPrepare,
  needsInputHash,
  readReminderApplyResult,
  recoveryPrepareRequestId,
  reminderNotificationId,
  type AcceptedRecoveryPrepare,
} from './recoveryWriter';

const TURN_MAX_MS = Number(process.env.WS_TURN_MAX_MS ?? String(30 * 60 * 1000));
export const WATCHDOG_INTERVAL_MS = Number(process.env.WS_WATCHDOG_INTERVAL_MIN ?? '3') * 60_000;
const REMIND_MS = Number(process.env.WS_NEEDS_INPUT_REMIND_MIN ?? '120') * 60_000;
const PUSH_ONCE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

//? A `needsInput` banner is a REAL human question unless it is an engine defer banner.
export function isRealNeedsInput(needsInput: string | null | undefined): boolean {
  if (!needsInput) return false;
  return needsInput !== EDITOR_DEFER_MSG && needsInput !== CAPACITY_DEFER_MSG;
}

export type SessionAction = 'resume' | 'reprovision' | 'stop' | 'skip';
export function classifyBusySession(input: {
  wsPaused: boolean;
  ticketPaused: boolean;
  ticketDone: boolean;
  stageAiEnabled: boolean;
  realNeedsInput: boolean;
  hasContainer: boolean;
}): SessionAction {
  if (input.ticketDone || !input.stageAiEnabled) return 'stop';
  if (input.wsPaused || input.ticketPaused || input.realNeedsInput) return 'skip';
  return input.hasContainer ? 'resume' : 'reprovision';
}

export function shouldRemind(remindedAt: Date | null, now: number, intervalMs: number): boolean {
  if (!remindedAt) return false;
  return now - remindedAt.getTime() >= intervalMs;
}

export interface SweepCounts {
  recovered: number;
  stopped: number;
  stuck: number;
  idle: number;
  reminded: number;
}

export interface WatchdogDependencies {
  recover?: (input: { workspaceId: string; sessionId: string; ticketKey: string; reason: AgentRecoveryReason; provision: boolean; observedAt: number }) => Promise<boolean>;
  reprovision?: (workspaceId: string, ticketKey: string) => Promise<void>;
  pushReminder?: (prisma: PrismaClient, workspaceId: string, notificationId: string) => Promise<boolean>;
  workspaceIds?: string[];
}

interface RecoveryTicket {
  id: string;
  key: string;
  projectId: string;
  stageId: string;
  status: string;
  archived: boolean;
  needsInput: string | null;
}

interface RecoverySession {
  id: string;
  ticketId: string | null;
  stageId: string | null;
  status: string;
  containerId: string | null;
  runToken: string | null;
  runFence: number;
  startedAt: Date;
}

function recoveryExpected(ticket: RecoveryTicket, session: RecoverySession): AgentRecoveryExpected | null {
  if ((session.status !== 'busy' && session.status !== 'paused')
    || !session.containerId || !session.runToken || session.runFence <= 0) return null;
  return {
    ticketStatus: ticket.status,
    needsInputHash: needsInputHash(ticket.needsInput),
    sessionStatus: session.status,
    containerId: session.containerId,
    runToken: session.runToken,
    runFence: session.runFence,
    startedAt: session.startedAt.getTime(),
  };
}

async function stillExactRecoveryTarget(
  prisma: PrismaClient,
  workspaceId: string,
  target: StageTarget & { sessionId: string },
  expected: AgentRecoveryExpected,
  ticketStatus: string = expected.ticketStatus,
): Promise<boolean> {
  if (await isEditorRunning(workspaceId, target.ticketKey)) return false;
  const [ticket, session] = await Promise.all([
    prisma.ticket.findFirst({
      where: {
        id: target.ticketId,
        workspaceId,
        projectId: target.projectId,
        key: target.ticketKey,
        stageId: target.stageId,
        status: ticketStatus,
        archived: false,
      },
      select: { needsInput: true },
    }),
    prisma.agentSession.findFirst({
      where: {
        id: target.sessionId,
        workspaceId,
        ticketId: target.ticketId,
        stageId: target.stageId,
        status: 'recovering',
        containerId: expected.containerId,
        runToken: expected.runToken,
        runFence: expected.runFence,
        startedAt: new Date(expected.startedAt),
      },
      select: { id: true },
    }),
  ]);
  return ticket !== null && session !== null && needsInputHash(ticket.needsInput) === expected.needsInputHash;
}

async function recoverSession(
  prisma: PrismaClient,
  workspaceId: string,
  session: RecoverySession,
  ticket: RecoveryTicket,
  reason: 'boot' | 'stuck',
  provision: boolean,
  observedAt: number,
  accepted?: AcceptedRecoveryPrepare,
): Promise<boolean> {
  if (!session.ticketId || !session.stageId) return false;
  const expected = accepted?.prepare.payload.expected ?? recoveryExpected(ticket, session);
  const acceptedTicketStatus = accepted?.prepare.payload.reason === 'manual-kill' ? 'idle' : expected?.ticketStatus;
  if (acceptedTicketStatus !== ticket.status || needsInputHash(ticket.needsInput) !== expected?.needsInputHash) return false;
  const target = accepted?.prepare.target ?? {
    ticketId: session.ticketId,
    ticketKey: ticket.key,
    projectId: ticket.projectId,
    stageId: session.stageId,
    sessionId: session.id,
  };
  const recoveryReason = accepted?.prepare.payload.reason ?? reason;
  const prepare: AgentRecoveryTransitionInternalAction = accepted?.prepare ?? {
    workspaceId,
    op: 'agent-recovery-transition',
    target,
    payload: { phase: 'prepare', reason: recoveryReason, expected, observedAt },
    userId: 'watchdog',
    clientRequestId: recoveryPrepareRequestId({
      reason: recoveryReason,
      sessionId: session.id,
      runToken: expected.runToken,
      runFence: expected.runFence,
      startedAt: expected.startedAt,
    }),
  };
  const result = await runAgentRecovery({
    prepare,
    mode: recoveryReason === 'worker-reap' ? 'stop-container' : 'kill-claude',
    shouldProceed: () => runInTenant(workspaceId, () => stillExactRecoveryTarget(
      prisma,
      workspaceId,
      target,
      expected,
      recoveryReason === 'manual-kill' ? 'idle' : expected.ticketStatus,
    )),
    ...(provision
      ? { provision: () => reprovisionTicketAndWait(workspaceId, ticket.key, recoveryReason === 'boot') }
      : {}),
  });
  return result.recovered;
}

async function pushReminderOnce(
  prisma: PrismaClient,
  workspaceId: string,
  notificationId: string,
): Promise<boolean> {
  const onceKey = formatKey(':watchdog-reminder-push', notificationId);
  const [claimError, claimed] = await tryCatch(() => redis.set(onceKey, '1', 'PX', PUSH_ONCE_TTL_MS, 'NX'));
  if (claimError || claimed !== 'OK') return false;
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, workspaceId, type: 'reminder' },
    select: { userId: true, title: true, body: true, ticketId: true },
  });
  if (!notification) return false;
  const ticket = notification.ticketId
    ? await prisma.ticket.findFirst({ where: { id: notification.ticketId, workspaceId }, select: { key: true } })
    : null;
  const key = ticket?.key ?? '';
  await sendWebPush(prisma, notification.userId, {
    title: notification.title,
    body: notification.body,
    url: key.length > 0 ? `/?ticket=${key}` : '/',
    tag: `notification-${notificationId}`,
  }, 'assignment');
  return true;
}

async function applyReminders(prisma: PrismaClient, workspaceId: string, now: number, dependencies: WatchdogDependencies): Promise<number> {
  const parked = await prisma.ticket.findMany({
    where: { workspaceId, needsInput: { not: null }, archived: false },
    select: {
      id: true,
      key: true,
      projectId: true,
      stageId: true,
      status: true,
      archived: true,
      needsInput: true,
      remindedAt: true,
    },
  });
  const { enqueueInternalAction } = await import('./internalOps');
  let reminded = 0;
  for (const ticket of parked) {
    if (!isRealNeedsInput(ticket.needsInput)) continue;
    const hash = needsInputHash(ticket.needsInput);
    const expectedRemindedAt = ticket.remindedAt?.getTime() ?? null;
    if (expectedRemindedAt !== null && !shouldRemind(ticket.remindedAt, now, REMIND_MS)) continue;
    const requestId = `watchdog-reminder:${ticket.id}:${hash}:${expectedRemindedAt === null ? 'baseline' : String(expectedRemindedAt)}`;
    const action = {
      workspaceId,
      op: 'watchdog-reminder-apply' as const,
      target: {
        ticketId: ticket.id,
        ticketKey: ticket.key,
        projectId: ticket.projectId,
        stageId: ticket.stageId,
      },
      payload: {
        expected: {
          ticketStatus: ticket.status,
          archived: false as const,
          needsInputHash: hash,
          remindedAt: expectedRemindedAt,
        },
        now,
        intervalMs: REMIND_MS,
      },
      userId: 'watchdog',
      clientRequestId: requestId,
    };
    const [writeError, appliedAction] = await tryCatch(() => enqueueInternalAction(action));
    if (writeError || !appliedAction) continue;
    const applied = readReminderApplyResult(appliedAction.result);
    const notificationId = applied?.notified
      ? applied.notificationId
      : (expectedRemindedAt === null ? null : reminderNotificationId(workspaceId, requestId));
    const push = dependencies.pushReminder ?? pushReminderOnce;
    if (notificationId && await push(prisma, workspaceId, notificationId)) reminded += 1;
  }
  return reminded;
}

async function runWorkspaceSweep(prisma: PrismaClient, workspaceId: string, now: number, dependencies: WatchdogDependencies): Promise<SweepCounts> {
  const counts: SweepCounts = { recovered: 0, stopped: 0, stuck: 0, idle: 0, reminded: 0 };
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { paused: true } });
  if (!workspace) return counts;
  const sessions = await prisma.agentSession.findMany({
    where: { workspaceId, kind: 'worker', status: { in: ['busy', 'recovering', 'stopped'] } },
    select: {
      id: true,
      ticketId: true,
      stageId: true,
      status: true,
      containerId: true,
      runToken: true,
      runFence: true,
      startedAt: true,
    },
  });
  for (const session of sessions) {
    if (!session.ticketId || !session.stageId) continue;
    const ticket = await prisma.ticket.findFirst({
      where: { id: session.ticketId, workspaceId },
      select: { id: true, key: true, projectId: true, stageId: true, status: true, archived: true, needsInput: true },
    });
    if (!ticket || ticket.archived) continue;
    const stage = await prisma.pipelineStage.findFirst({
      where: { workspaceId, projectId: ticket.projectId, key: ticket.stageId },
      select: { aiEnabled: true },
    });
    const action = classifyBusySession({
      wsPaused: workspace.paused,
      ticketPaused: ticket.status === 'paused',
      ticketDone: ticket.status === 'done',
      stageAiEnabled: stage?.aiEnabled === true,
      realNeedsInput: isRealNeedsInput(ticket.needsInput),
      hasContainer: session.containerId !== null,
    });
    const retryStatus = session.status === 'recovering' || session.status === 'stopped';
    const [acceptedError, accepted] = retryStatus && session.ticketId && session.stageId
      && session.containerId && session.runToken && session.runFence > 0
      ? await tryCatch(() => findAcceptedRecoveryPrepare(prisma, workspaceId, {
          id: session.id,
          ticketId: session.ticketId ?? '',
          stageId: session.stageId ?? '',
          status: session.status === 'recovering' ? 'recovering' : 'stopped',
          containerId: session.containerId ?? '',
          runToken: session.runToken ?? '',
          runFence: session.runFence,
          startedAt: session.startedAt.getTime(),
        }))
      : [null, null];
    if (acceptedError || (retryStatus && !accepted)) continue;
    const acceptedReason = accepted?.prepare.payload.reason ?? null;
    //? A stopped manual/reaper recovery is already terminal. Stopped boot/stuck rows remain
    //? visible until a higher-fence successor is proven, so cron retries their queued launch.
    if (session.status === 'stopped' && acceptedReason !== 'boot' && acceptedReason !== 'stuck') continue;
    if (session.status === 'busy' && action === 'skip') continue;
    const expected = accepted?.prepare.payload.expected ?? recoveryExpected(ticket, session);
    if (!expected) continue;
    const hardStuck = session.status === 'busy' && now - session.startedAt.getTime() >= TURN_MAX_MS;
    if (session.status === 'busy') {
      const owns = await reservationOwnsSlot(workspaceId, ticket.key, expected.runToken, expected.runFence, now);
      //? Boot recovery may only claim an expired owner. A hard-stuck verdict is the sole
      //? path allowed to revoke a still-live owner after WS_TURN_MAX_MS.
      if (!hardStuck && owns) continue;
    }
    const reason = acceptedReason ?? (hardStuck ? 'stuck' : 'boot');
    const shouldProvision = (reason === 'boot' || reason === 'stuck') && action !== 'stop' && action !== 'skip';
    const recovered = dependencies.recover
      ? await dependencies.recover({ workspaceId, sessionId: session.id, ticketKey: ticket.key, reason, provision: shouldProvision, observedAt: now })
      : await recoverSession(prisma, workspaceId, session, ticket, hardStuck ? 'stuck' : 'boot', shouldProvision, now, accepted ?? undefined);
    if (!recovered) continue;
    if (shouldProvision) counts.recovered += 1;
    else counts.stopped += 1;
    if (hardStuck) counts.stuck += 1;
  }

  //? Dropped provisioning has no old session to fence. Admission itself is the shared
  //? authority, so repeated/overlapping sweeps collapse to one slot owner.
  const candidates = await prisma.ticket.findMany({
    where: { workspaceId, branch: { not: null }, archived: false, status: 'idle' },
    select: { id: true, key: true, projectId: true, stageId: true, needsInput: true },
  });
  for (const ticket of candidates) {
    if (workspace.paused || isRealNeedsInput(ticket.needsInput)) continue;
    const stage = await prisma.pipelineStage.findFirst({
      where: { workspaceId, projectId: ticket.projectId, key: ticket.stageId },
      select: { aiEnabled: true, gateForApproval: true },
    });
    if (stage?.aiEnabled !== true || stage.gateForApproval) continue;
    const ran = await prisma.agentSession.findFirst({
      where: { workspaceId, sessionKey: `worker:${ticket.id}:${ticket.stageId}` },
      select: { id: true },
    });
    if (ran) continue;
    const reprovision = dependencies.reprovision ?? ((targetWorkspaceId: string, ticketKey: string) => reprovisionTicket(targetWorkspaceId, ticketKey, false));
    await reprovision(workspaceId, ticket.key);
    counts.idle += 1;
  }
  counts.reminded = await applyReminders(prisma, workspaceId, now, dependencies);
  return counts;
}

//? One cron invocation. Enumerating workspace ids is the only global tenant-model read;
//? every subsequent query and every write runs inside that workspace's tenant scope.
export async function runWatchdogSweep(now: number, dependencies: WatchdogDependencies = {}): Promise<SweepCounts> {
  const prisma = getPrismaClient();
  const workspaceRows = dependencies.workspaceIds === undefined
    ? await prisma.workspace.findMany({ select: { id: true } })
    : [];
  const workspaceIds = dependencies.workspaceIds ?? workspaceRows.map((workspace) => workspace.id);
  const total: SweepCounts = { recovered: 0, stopped: 0, stuck: 0, idle: 0, reminded: 0 };
  for (const workspaceId of workspaceIds) {
    const counts = await runInTenant(workspaceId, () => runWorkspaceSweep(prisma, workspaceId, now, dependencies));
    total.recovered += counts.recovered;
    total.stopped += counts.stopped;
    total.stuck += counts.stuck;
    total.idle += counts.idle;
    total.reminded += counts.reminded;
  }
  if (Object.values(total).some((count) => count > 0)) console.log(`[watchdog] sweep intervened: ${JSON.stringify(total)}`);
  return total;
}
