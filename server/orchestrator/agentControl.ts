//? Agent control-plane (C2) — exact fenced recovery for a human kill, watchdog repair, or
//? idle-worker stop. Docker/process work is procps-free; only recovery InternalOps mutate sessions.

import { spawn } from 'node:child_process';

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { claimActionOnce } from './cluster';
import { recoveryReservation, withReservationRenewal } from './capacity';
import { readRecoveryTransitionResult, reconstructAcceptedRecoveryPrepare } from './recoveryWriter';
import type { AgentRecoveryTransitionInternalAction } from './internalOps';
import { docker, inspectWorkerContainer, workerContainerRunning, DOCKER_BIN, type WorkerContainerIdentity } from '../container/runtime';

//? Kill Claude without procps, then prove the target process is absent. No initial match is an
//? idempotent success; a process that ignores TERM makes Docker exec nonzero and recovery cancels.
const KILL_SCRIPT = [
  'for d in /proc/[0-9]*; do',
  'if grep -qa claude "$d/cmdline" 2>/dev/null; then p="${d#/proc/}"; [ "$p" != "$$" ] && kill "$p" 2>/dev/null; fi;',
  'done;',
  'n=0; while [ "$n" -lt 10 ]; do found=0;',
  'for d in /proc/[0-9]*; do if grep -qa claude "$d/cmdline" 2>/dev/null; then p="${d#/proc/}"; [ "$p" != "$$" ] && found=1; fi; done;',
  '[ "$found" -eq 0 ] && exit 0; sleep 0.1; n=$((n + 1)); done; exit 1',
].join(' ');

//? Low-level: kill Claude in a container by immutable ID or a caller-validated name.
export function killClaudeByContainer(container: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(DOCKER_BIN, ['exec', container, 'sh', '-c', KILL_SCRIPT], { windowsHide: true });
    proc.on('error', () => { resolve(false); });
    proc.on('close', (code) => { resolve(code === 0); });
  });
}

export interface ExactRecoveryContainer {
  workspaceId: string;
  projectId: string;
  ticketKey: string;
  containerId: string;
  runToken: string;
  runFence: number;
}

export interface ExactRecoveryDependencies {
  inspect: (containerId: string) => Promise<WorkerContainerIdentity | null>;
  readOwner: (containerId: string) => Promise<{ runToken: string; runFence: number } | null>;
  killClaude: (containerId: string) => Promise<boolean>;
  stopContainer: (containerId: string) => Promise<boolean>;
  running: (containerId: string) => Promise<boolean | null>;
}

async function readRunOwner(containerId: string): Promise<{ runToken: string; runFence: number } | null> {
  const result = await docker(['exec', containerId, 'sh', '-c', 'cat /work/.workspaces-run-owner 2>/dev/null || true']);
  if (result.code !== 0) return null;
  const match = /^(\d+):([A-Za-z0-9._:-]{1,128})$/.exec(result.out.trim());
  if (!match) return null;
  const runFence = Number(match[1]);
  return Number.isSafeInteger(runFence) && runFence > 0 ? { runFence, runToken: match[2] ?? '' } : null;
}

const exactRecoveryDependencies: ExactRecoveryDependencies = {
  inspect: inspectWorkerContainer,
  readOwner: readRunOwner,
  killClaude: killClaudeByContainer,
  stopContainer: async (containerId) => {
    const result = await docker(['stop', containerId]);
    return result.code === 0;
  },
  running: workerContainerRunning,
};

export type ExactRecoveryMode = 'kill-claude' | 'stop-container';
export type ExactRecoveryResult =
  | { ok: true; container: WorkerContainerIdentity }
  | { ok: false; reason: 'inspect' | 'identity' | 'owner' | 'docker' | 'state' };

//? The only destructive recovery boundary. Immutable container id, all tenant/project/ticket
//? labels, and the mutable run-owner marker must match before Docker receives a kill/stop.
//? An exact already-stopped container is the idempotent replay after a crash between stop and complete;
//? it has no live process to authorize or destroy, and Docker exec cannot read its volume marker.
export async function recoverExactContainer(
  expected: ExactRecoveryContainer,
  mode: ExactRecoveryMode,
  dependencies: ExactRecoveryDependencies = exactRecoveryDependencies,
): Promise<ExactRecoveryResult> {
  const inspected = await dependencies.inspect(expected.containerId);
  if (!inspected) return { ok: false, reason: 'inspect' };
  if (inspected.containerId !== expected.containerId
    || inspected.workspaceId !== expected.workspaceId
    || inspected.projectId !== expected.projectId
    || inspected.ticketKey !== expected.ticketKey) return { ok: false, reason: 'identity' };

  if (mode === 'stop-container') {
    const runningBefore = await dependencies.running(expected.containerId);
    if (runningBefore === false) return { ok: true, container: inspected };
    if (runningBefore !== true) return { ok: false, reason: 'state' };
  }

  const owner = await dependencies.readOwner(expected.containerId);
  if (owner?.runToken !== expected.runToken || owner.runFence !== expected.runFence) return { ok: false, reason: 'owner' };

  if (mode === 'kill-claude') {
    if (!(await dependencies.killClaude(expected.containerId))) return { ok: false, reason: 'docker' };
    const running = await dependencies.running(expected.containerId);
    if (running !== true) return { ok: false, reason: 'state' };
    const ownerAfter = await dependencies.readOwner(expected.containerId);
    if (ownerAfter?.runToken !== expected.runToken || ownerAfter.runFence !== expected.runFence) return { ok: false, reason: 'owner' };
  } else {
    if (!(await dependencies.stopContainer(expected.containerId))) return { ok: false, reason: 'docker' };
    if (await dependencies.running(expected.containerId) !== false) return { ok: false, reason: 'state' };
  }
  return { ok: true, container: inspected };
}

export interface AgentRecoveryRequest {
  prepare: AgentRecoveryTransitionInternalAction;
  mode: ExactRecoveryMode;
  shouldProceed?: () => Promise<boolean>;
  provision?: () => Promise<boolean>;
}

export interface AgentRecoveryRunnerDependencies {
  claimExternal: (intentId: string) => Promise<boolean>;
  recover: typeof recoverExactContainer;
  maintain: typeof withReservationRenewal;
  proveSuccessor?: (prepare: AgentRecoveryTransitionInternalAction) => Promise<boolean>;
}

export type AgentRecoveryRunResult =
  | { recovered: true; intentId: string }
  | { recovered: false; reason: 'live' | 'stale' | 'unavailable' | 'duplicate' | 'race' | 'docker' | 'complete' };

async function proveRecoverySuccessor(prepare: AgentRecoveryTransitionInternalAction): Promise<boolean> {
  if (prepare.payload.phase !== 'prepare') return false;
  const session = await getPrismaClient().agentSession.findFirst({
    where: {
      id: prepare.target.sessionId,
      workspaceId: prepare.workspaceId,
      ticketId: prepare.target.ticketId,
      stageId: prepare.target.stageId,
      kind: 'worker',
      sessionKey: `worker:${prepare.target.ticketId}:${prepare.target.stageId}`,
      runFence: { gt: prepare.payload.expected.runFence },
      status: { in: ['busy', 'stopped'] },
    },
    select: { runToken: true },
  });
  return session?.runToken !== null
    && session?.runToken !== undefined
    && session.runToken !== prepare.payload.expected.runToken
    && !session.runToken.startsWith('recovery-');
}

const defaultRecoveryRunnerDependencies: AgentRecoveryRunnerDependencies = {
  claimExternal: (intentId) => claimActionOnce(`agent-recovery-external:${intentId}`),
  recover: recoverExactContainer,
  maintain: withReservationRenewal,
  proveSuccessor: proveRecoverySuccessor,
};

//? Prepare/complete/cancel are the only session writers. Docker runs after prepare and after
//? the workspace lease is gone; the renewable recovery owner remains the stage fence throughout.
export async function runAgentRecovery(
  request: AgentRecoveryRequest,
  dependencies: AgentRecoveryRunnerDependencies = defaultRecoveryRunnerDependencies,
): Promise<AgentRecoveryRunResult> {
  if (request.prepare.payload.phase !== 'prepare') return { recovered: false, reason: 'stale' };
  const { enqueueInternalAction } = await import('./internalOps');

  const finishWithSuccessor = async (intentId: string): Promise<AgentRecoveryRunResult> => {
    if (!request.provision) return { recovered: true, intentId };
    const [provisionError, provisioned] = await tryCatch(request.provision);
    if (provisionError || provisioned !== true) return { recovered: false, reason: 'unavailable' };
    const prove = dependencies.proveSuccessor ?? proveRecoverySuccessor;
    const [proofError, successor] = await tryCatch(() => prove(request.prepare));
    return !proofError && successor === true
      ? { recovered: true, intentId }
      : { recovered: false, reason: 'unavailable' };
  };

  const cancel = async (intentId: string): Promise<boolean> => {
    const canceledAction: AgentRecoveryTransitionInternalAction = {
      workspaceId: request.prepare.workspaceId,
      op: 'agent-recovery-transition',
      target: request.prepare.target,
      payload: {
        phase: 'cancel',
        reason: request.prepare.payload.reason,
        expected: request.prepare.payload.expected,
        intentId,
      },
      userId: 'agent-recovery',
      clientRequestId: `agent-recovery-cancel:${intentId}`,
    };
    const [cancelError, canceledEnqueue] = await tryCatch(() => enqueueInternalAction(canceledAction));
    const canceled = readRecoveryTransitionResult(canceledEnqueue?.result);
    return !cancelError && canceled?.applied === true && canceled.phase === 'cancel';
  };

  const [prepareError, preparedAction] = await tryCatch(() => enqueueInternalAction(request.prepare));
  if (prepareError || !preparedAction) return { recovered: false, reason: 'unavailable' };
  const direct = readRecoveryTransitionResult(preparedAction.result);
  const [reconstructError, reconstructed] = await tryCatch(() => reconstructAcceptedRecoveryPrepare(
    getPrismaClient(),
    request.prepare,
  ));
  if (reconstructError) return { recovered: false, reason: 'unavailable' };
  if (!reconstructed) {
    return direct?.phase === 'prepare' && !direct.applied
      ? { recovered: false, reason: direct.reason }
      : { recovered: false, reason: 'stale' };
  }
  const prepared = reconstructed.result;

  //? A crash may land after Redis cancel but before the session restore. The old fence
  //? proves that partial cancel, so replay only the cancel writer; Docker must not run again.
  if (reconstructed.state === 'canceling') {
    return await cancel(prepared.intentId)
      ? { recovered: false, reason: 'race' }
      : { recovered: false, reason: 'unavailable' };
  }
  //? `stopped` with the exact old token/fence proves complete already crossed its writer
  //? boundary. Retry only the missing successor; never kill the container a second time.
  if (reconstructed.state === 'stopped') return finishWithSuccessor(prepared.intentId);

  const [claimError, claimed] = await tryCatch(() => dependencies.claimExternal(prepared.intentId));
  if (claimError) return { recovered: false, reason: 'unavailable' };
  if (!claimed) return { recovered: false, reason: 'duplicate' };
  const recovery = recoveryReservation(
    request.prepare.workspaceId,
    request.prepare.target.ticketKey,
    prepared.intentId,
    request.prepare.payload.expected.runFence,
  );
  const expectedContainer: ExactRecoveryContainer = {
    workspaceId: request.prepare.workspaceId,
    projectId: request.prepare.target.projectId,
    ticketKey: request.prepare.target.ticketKey,
    containerId: request.prepare.payload.expected.containerId,
    runToken: request.prepare.payload.expected.runToken,
    runFence: request.prepare.payload.expected.runFence,
  };
  const [externalError, external] = await tryCatch(() => dependencies.maintain(
    recovery,
    async (guard): Promise<{ raced: boolean; result: ExactRecoveryResult | null }> => {
      await guard.assertOwned();
      if (await request.shouldProceed?.() === false) return { raced: true, result: null };
      const result = await dependencies.recover(expectedContainer, request.mode);
      await guard.assertOwned();
      return { raced: false, result };
    },
  ));
  if (externalError || !external || external.raced || external.result?.ok !== true) {
    if (!(await cancel(prepared.intentId))) return { recovered: false, reason: 'unavailable' };
    return { recovered: false, reason: externalError || external?.raced ? 'race' : 'docker' };
  }

  const completedAction: AgentRecoveryTransitionInternalAction = {
    workspaceId: request.prepare.workspaceId,
    op: 'agent-recovery-transition',
    target: request.prepare.target,
    payload: {
      phase: 'complete',
      reason: request.prepare.payload.reason,
      expected: request.prepare.payload.expected,
      intentId: prepared.intentId,
    },
    userId: 'agent-recovery',
    clientRequestId: `agent-recovery-complete:${prepared.intentId}`,
  };
  const [completeError, completedEnqueue] = await tryCatch(() => enqueueInternalAction(completedAction));
  if (completeError || !completedEnqueue) return { recovered: false, reason: 'unavailable' };
  const complete = readRecoveryTransitionResult(completedEnqueue.result);
  if (!complete?.applied || complete.phase !== 'complete') return { recovered: false, reason: 'complete' };
  return finishWithSuccessor(prepared.intentId);
}
