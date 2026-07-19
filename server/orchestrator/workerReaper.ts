//? Idle worker-container reaper. Runtime enumeration is host-global/read-only; each exact
//? workspace/project/ticket/container identity is re-read under runInTenant and stopped only
//? through the same fenced agent-recovery InternalOp as watchdog recovery.

import { createHash } from 'node:crypto';

import { formatKey, getPrismaClient, redis, tryCatch } from '@luckystack/core';
import type { PrismaClient } from '@prisma/client';

import { listRunningWorkerContainers, type WorkerContainerIdentity } from '../container/runtime';
import { editorSockState } from '../proxy/editorReaper';
import { runInTenant } from '../tenant/tenantContext';
import { runAgentRecovery, type AgentRecoveryRunResult } from './agentControl';
import type { AgentRecoveryExpected, AgentRecoveryTransitionInternalAction } from './internalOps';
import { needsInputHash } from './recoveryWriter';

const IDLE_MS = Number(process.env.WS_WORKER_IDLE_MIN ?? '20') * 60_000;
const IDLE_KEY_TTL_MS = Math.max(IDLE_MS * 4, 24 * 60 * 60 * 1000);
export const WORKER_REAP_MS = Number(process.env.WS_REAP_INTERVAL_MIN ?? '5') * 60_000;

export interface WorkerReapTarget {
  target: AgentRecoveryTransitionInternalAction['target'];
  expected: AgentRecoveryExpected;
}

export interface WorkerReapDeps {
  listWorkers: () => Promise<WorkerContainerIdentity[]>;
  loadTarget: (worker: WorkerContainerIdentity) => Promise<WorkerReapTarget | null>;
  hasConnectedEditor: (worker: WorkerContainerIdentity) => Promise<boolean | null>;
  idleSince: (worker: WorkerContainerIdentity, now: number) => Promise<number | null>;
  clearIdle: (worker: WorkerContainerIdentity) => Promise<void>;
  recover: (worker: WorkerContainerIdentity, target: WorkerReapTarget, now: number) => Promise<AgentRecoveryRunResult>;
}

export function workerContainerIdentity(worker: WorkerContainerIdentity): string {
  return `${worker.workspaceId}\0${worker.projectId}\0${worker.ticketKey}\0${worker.containerId}\0${worker.name}`;
}

function idleKey(worker: WorkerContainerIdentity): string {
  const digest = createHash('sha256').update(workerContainerIdentity(worker)).digest('hex');
  return formatKey(':worker-idle', digest);
}

//? One pure-over-dependencies pass. The timestamp storage is deliberately injected;
//? production uses host-global Redis, so a different cron leader continues the same clock.
export async function reapIdleWorkers(now: number, deps: WorkerReapDeps): Promise<{ reaped: string[] }> {
  const workers = await deps.listWorkers();
  const reaped: string[] = [];
  for (const worker of workers) {
    const target = await deps.loadTarget(worker);
    const editor = await deps.hasConnectedEditor(worker);
    if (!target || editor === true) {
      await deps.clearIdle(worker);
      continue;
    }
    //? Docker/editor uncertainty is fail-closed without resetting the shared idle age.
    if (editor === null) continue;
    const since = await deps.idleSince(worker, now);
    if (since === null || now - since < IDLE_MS) continue;
    //? Editor/status are probed once more after the TTL. The recovery prepare then performs
    //? the exact ticket/session CAS before Docker is allowed to stop the immutable container id.
    const revalidatedEditor = await deps.hasConnectedEditor(worker);
    if (revalidatedEditor === true) {
      await deps.clearIdle(worker);
      continue;
    }
    if (revalidatedEditor === null) continue;
    const result = await deps.recover(worker, target, now);
    if (!result.recovered) continue;
    await deps.clearIdle(worker);
    reaped.push(worker.name);
  }
  if (reaped.length > 0) console.log(`[worker-reaper] stopped ${String(reaped.length)} idle worker container(s): ${reaped.join(', ')}`);
  return { reaped };
}

async function loadRealTarget(prisma: PrismaClient, worker: WorkerContainerIdentity): Promise<WorkerReapTarget | null> {
  return runInTenant(worker.workspaceId, async () => {
    const ticket = await prisma.ticket.findFirst({
      where: {
        workspaceId: worker.workspaceId,
        projectId: worker.projectId,
        key: worker.ticketKey,
        status: 'needs-input',
        archived: false,
      },
      select: { id: true, key: true, projectId: true, stageId: true, status: true, needsInput: true },
    });
    if (!ticket) return null;
    const session = await prisma.agentSession.findFirst({
      where: {
        workspaceId: worker.workspaceId,
        ticketId: ticket.id,
        stageId: ticket.stageId,
        kind: 'worker',
        sessionKey: `worker:${ticket.id}:${ticket.stageId}`,
        status: { in: ['busy', 'paused'] },
        containerId: worker.containerId,
      },
      select: { id: true, status: true, containerId: true, runToken: true, runFence: true, startedAt: true },
    });
    if (!session?.containerId || !session.runToken || session.runFence <= 0 || (session.status !== 'busy' && session.status !== 'paused')) return null;
    return {
      target: {
        ticketId: ticket.id,
        ticketKey: ticket.key,
        projectId: ticket.projectId,
        stageId: ticket.stageId,
        sessionId: session.id,
      },
      expected: {
        ticketStatus: ticket.status,
        needsInputHash: needsInputHash(ticket.needsInput),
        sessionStatus: session.status,
        containerId: session.containerId,
        runToken: session.runToken,
        runFence: session.runFence,
        startedAt: session.startedAt.getTime(),
      },
    };
  });
}

async function stillReapable(
  prisma: PrismaClient,
  worker: WorkerContainerIdentity,
  target: WorkerReapTarget,
): Promise<boolean> {
  const editor = await editorSockState(worker.containerId);
  if (!editor.available || editor.connected) return false;
  return runInTenant(worker.workspaceId, async () => {
    const [ticket, session] = await Promise.all([
      prisma.ticket.findFirst({
        where: {
          id: target.target.ticketId,
          workspaceId: worker.workspaceId,
          projectId: worker.projectId,
          key: worker.ticketKey,
          stageId: target.target.stageId,
          status: target.expected.ticketStatus,
          archived: false,
        },
        select: { needsInput: true },
      }),
      prisma.agentSession.findFirst({
        where: {
          id: target.target.sessionId,
          workspaceId: worker.workspaceId,
          ticketId: target.target.ticketId,
          stageId: target.target.stageId,
          status: 'recovering',
          containerId: worker.containerId,
          runToken: target.expected.runToken,
          runFence: target.expected.runFence,
          startedAt: new Date(target.expected.startedAt),
        },
        select: { id: true },
      }),
    ]);
    return ticket !== null && session !== null && needsInputHash(ticket.needsInput) === target.expected.needsInputHash;
  });
}

function realDeps(prisma: PrismaClient): WorkerReapDeps {
  return {
    listWorkers: listRunningWorkerContainers,
    loadTarget: (worker) => loadRealTarget(prisma, worker),
    hasConnectedEditor: async (worker) => {
      const state = await editorSockState(worker.containerId);
      return state.available ? state.connected : null;
    },
    idleSince: async (worker, now) => {
      const key = idleKey(worker);
      const [readError, current] = await tryCatch(() => redis.get(key));
      if (readError) return null;
      if (current !== null) {
        const parsed = Number(current);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
      }
      const [writeError, written] = await tryCatch(() => redis.set(key, String(now), 'PX', IDLE_KEY_TTL_MS, 'NX'));
      return !writeError && written === 'OK' ? now : null;
    },
    clearIdle: async (worker) => { await tryCatch(() => redis.del(idleKey(worker))); },
    recover: async (worker, target, now) => {
      const prepare: AgentRecoveryTransitionInternalAction = {
        workspaceId: worker.workspaceId,
        op: 'agent-recovery-transition',
        target: target.target,
        payload: { phase: 'prepare', reason: 'worker-reap', expected: target.expected, observedAt: now },
        userId: 'worker-reaper',
        clientRequestId: `agent-recovery-prepare:worker-reap:${target.target.sessionId}:${target.expected.runToken}:${String(target.expected.runFence)}:${String(target.expected.startedAt)}`,
      };
      return runAgentRecovery({
        prepare,
        mode: 'stop-container',
        shouldProceed: () => stillReapable(prisma, worker, target),
      });
    },
  };
}

export async function runWorkerReapTick(): Promise<void> {
  await reapIdleWorkers(Date.now(), realDeps(getPrismaClient()));
}
