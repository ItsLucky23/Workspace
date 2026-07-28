//? Workspaces — multi-project / multi-service admin writes via `_sync` (ADR 0035).
//? `gitlab-resync` is deliberately split: RBAC first, bounded forge fetch outside
//? the writer lease, then public ControlOp dispatch of the credential-free snapshot.

import { tryCatch } from '@luckystack/core';

import { AuthProps, SessionLayout } from '../../../config';
import { Functions, SyncServerResponse } from '../../../src/_sockets/apiTypes.generated';
import {
  dispatchControlSync,
  type DispatchSyncInput,
  type DispatchSyncResult,
} from '../../../server/control/dispatchSync';
import { CAP, hasCapability } from '../../../server/control/rbac';
import { broadcastTicketDelta } from '../../../server/read/broadcast';
import { runInTenant } from '../../../server/tenant/tenantContext';
import { branchHead } from '../../../server/git/repoStore';
import { readCanonicalCiReport, runPublicCiAtCommit, type StageCiReport } from '../../../server/ci/runner';
import { enqueueInternalAction } from '../../../server/orchestrator/internalOps';
import type { EnqueuedControlAction } from '../../../server/orchestrator/conductor';
import { acquireSlot, releaseSlot, withReservationRenewal } from '../../../server/orchestrator/capacity';
import { ciPublicIntentId, ciPublicIntentSignalId } from '../../../server/orchestrator/actionIds';
import {
  abandonCiExternalExecution,
  claimCiExternalExecution,
  completeCiExternalExecution,
  withCiExternalClaimRenewal,
} from '../../../server/ci/externalClaim';
import {
  fetchForgeSnapshot,
  forgeTouchedKeys,
  type ForgeFetchSnapshotResult,
} from '../../../server/git/gitlabSync';
import type { ControlOp } from '../_functions/controlApi';

export const validation = 'relaxed' as const;
export const auth: AuthProps = { login: true, additional: [] };

const OPS = new Set<string>(['project-create', 'project-from-template', 'apply-design-tokens', 'service-create', 'service-delete', 'forge-connect', 'env-deploy', 'env-teardown', 'env-rollback', 'env-promote', 'build-export', 'ci-run', 'ci-allow-red', 'root-cause', 'plan-critique', 'index-memory', 'db-connect', 'db-migrate-create', 'db-migrate-apply', 'db-introspect', 'edit-budget', 'raise-cap', 'resume-spend', 'gitlab-resync']);

function isProjectAdminOp(op: string): op is ControlOp {
  return OPS.has(op);
}

export interface SyncParams {
  clientInput: { op: string; clientRequestId: string; projectId?: string; /*? per-service CI: null is the PROJECT ROOT unit, which is distinct from "not given" (= run every unit) */ serviceId?: string | null; envId?: string; ticketKey?: string; kind?: string; fromKind?: string; approved?: boolean; enabled?: boolean; disconnect?: boolean; clearExternalRefs?: boolean; trigger?: string; symptom?: string; template?: string; name?: string; gitUrl?: string; brief?: string; path?: string; buildCmd?: string; deployUnit?: string; mode?: string; baseUrl?: string; token?: string; repoPath?: string; url?: string; envKind?: string; sql?: string; rollbackSql?: string; migrationId?: string; connectionId?: string; pinnedCommit?: string; autoRedeploy?: boolean; subdomain?: string; customDomain?: string; cap?: number; alertPct?: number; budgetId?: string; label?: string; enforcement?: string; create?: boolean };
  user: SessionLayout;
  functions: Functions;
  roomCode: string;
}

type ProjectAdminPrisma = Functions['db']['prisma'];

export interface PublicCiTarget {
  workspaceId: string;
  ticketId: string;
  ticketKey: string;
  projectId: string;
  branch: string;
  commitHash: string;
  mergeRequestId: string | null;
}

export interface PublicCiPreparedIntent extends PublicCiTarget {
  id: string;
  signalId: string;
  trigger: string;
  //? The unit this intent tests — carried through to the container exec so CI runs in the service directory.
  serviceId?: string | null;
  servicePath?: string | null;
}

export interface PublicCiRunDependencies {
  authorize: (prisma: ProjectAdminPrisma, workspaceId: string, userId: string) => Promise<boolean>;
  resolve: (prisma: ProjectAdminPrisma, workspaceId: string, projectId: string, ticketKey: string) => Promise<PublicCiTarget | null>;
  execute: (target: PublicCiPreparedIntent) => Promise<StageCiReport>;
  currentHead: (prisma: ProjectAdminPrisma, target: PublicCiPreparedIntent) => Promise<string>;
  dispatch: (input: DispatchSyncInput) => Promise<DispatchSyncResult>;
  complete: typeof enqueueInternalAction;
  broadcast: (prisma: ProjectAdminPrisma, workspaceId: string, keys: string[]) => Promise<void>;
  loadPrepared?: (prisma: ProjectAdminPrisma, workspaceId: string, signalId: string) => Promise<PublicCiPreparedIntent | null>;
  acquireCapacity?: typeof acquireSlot;
  releaseCapacity?: typeof releaseSlot;
  withCapacityRenewal?: typeof withReservationRenewal;
  claimExternal?: typeof claimCiExternalExecution;
  abandonExternal?: typeof abandonCiExternalExecution;
  completeExternal?: typeof completeCiExternalExecution;
  withExternalRenewal?: typeof withCiExternalClaimRenewal;
}

export type PublicCiDispatchResult = DispatchSyncResult
  | { ok: false; errorCode: 'capacity.unavailable' | 'ci.pending' };

export interface ForgeResyncDependencies {
  authorize: (prisma: ProjectAdminPrisma, workspaceId: string, userId: string) => Promise<boolean>;
  fetchSnapshot: (prisma: ProjectAdminPrisma, workspaceId: string, projectId: string) => Promise<ForgeFetchSnapshotResult>;
  dispatch: (input: DispatchSyncInput) => Promise<DispatchSyncResult>;
  broadcast: (prisma: ProjectAdminPrisma, workspaceId: string, keys: string[]) => Promise<void>;
}

async function resolvePublicCiTarget(
  prisma: ProjectAdminPrisma,
  workspaceId: string,
  projectId: string,
  ticketKey: string,
): Promise<PublicCiTarget | null> {
  const ticket = await prisma.ticket.findFirst({
    where: { workspaceId, projectId, key: ticketKey },
    select: { id: true, key: true, projectId: true, branch: true },
  });
  if (!ticket?.branch) return null;
  const mergeRequest = await prisma.mergeRequest.findFirst({
    where: { workspaceId, projectId, ticketId: ticket.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, headSha: true },
  });
  const commitHash = mergeRequest?.headSha ?? await branchHead(workspaceId, projectId, ticket.branch);
  return /^[a-f\d]{40,64}$/i.test(commitHash)
    ? {
        workspaceId,
        ticketId: ticket.id,
        ticketKey: ticket.key,
        projectId: ticket.projectId,
        branch: ticket.branch,
        commitHash,
        mergeRequestId: mergeRequest?.id ?? null,
      }
    : null;
}

function defaultPublicCiRunDependencies(): PublicCiRunDependencies {
  return {
    authorize: (prisma, workspaceId, userId) => hasCapability(prisma, workspaceId, userId, CAP.workTickets),
    resolve: (prisma, workspaceId, projectId, ticketKey) => runInTenant(
      workspaceId,
      () => resolvePublicCiTarget(prisma, workspaceId, projectId, ticketKey),
    ),
    execute: (target) => runPublicCiAtCommit({
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      ticketKey: target.ticketKey,
      branch: target.branch,
      commitHash: target.commitHash,
      intentId: target.id,
    }),
    currentHead: async (prisma, target) => {
      if (target.mergeRequestId === null) return branchHead(target.workspaceId, target.projectId, target.branch);
      const mergeRequest = await prisma.mergeRequest.findFirst({
        where: { workspaceId: target.workspaceId, projectId: target.projectId, ticketId: target.ticketId, id: target.mergeRequestId },
        select: { headSha: true },
      });
      return mergeRequest?.headSha ?? '';
    },
    dispatch: dispatchControlSync,
    complete: enqueueInternalAction,
    broadcast: (prisma, workspaceId, keys) => broadcastTicketDelta(prisma, workspaceId, keys),
  };
}

function defaultForgeResyncDependencies(): ForgeResyncDependencies {
  return {
    authorize: (prisma, workspaceId, userId) => hasCapability(prisma, workspaceId, userId, CAP.workspaceSettings),
    fetchSnapshot: (prisma, workspaceId, projectId) => runInTenant(
      workspaceId,
      () => fetchForgeSnapshot(prisma, workspaceId, projectId),
    ),
    dispatch: dispatchControlSync,
    broadcast: (prisma, workspaceId, keys) => broadcastTicketDelta(prisma, workspaceId, keys),
  };
}

function preparedPublicCiIntent(value: unknown, workspaceId: string): PublicCiPreparedIntent | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !('intent' in value)) return null;
  const intent = value.intent;
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) return null;
  if (!('id' in intent) || typeof intent.id !== 'string') return null;
  if (!('signalId' in intent) || typeof intent.signalId !== 'string') return null;
  if (!('ticketId' in intent) || typeof intent.ticketId !== 'string') return null;
  if (!('ticketKey' in intent) || typeof intent.ticketKey !== 'string') return null;
  if (!('projectId' in intent) || typeof intent.projectId !== 'string') return null;
  if (!('branch' in intent) || typeof intent.branch !== 'string') return null;
  if (!('commitHash' in intent) || typeof intent.commitHash !== 'string') return null;
  if (!('trigger' in intent) || typeof intent.trigger !== 'string') return null;
  if (!('mergeRequestId' in intent) || (intent.mergeRequestId !== null && typeof intent.mergeRequestId !== 'string')) return null;
  return {
    workspaceId,
    id: intent.id,
    signalId: intent.signalId,
    ticketId: intent.ticketId,
    ticketKey: intent.ticketKey,
    projectId: intent.projectId,
    branch: intent.branch,
    commitHash: intent.commitHash,
    mergeRequestId: intent.mergeRequestId,
    trigger: intent.trigger,
  };
}

async function loadPreparedPublicCiIntent(
  prisma: ProjectAdminPrisma,
  workspaceId: string,
  signalId: string,
): Promise<PublicCiPreparedIntent | null> {
  const signal = await prisma.workspaceSignal.findFirst({
    where: { id: signalId, workspaceId, kind: 'ci-run', processedAt: { not: null } },
    select: { payload: true },
  });
  return preparedPublicCiIntent(signal?.payload, workspaceId);
}

function internalCompletionPersisted(value: EnqueuedControlAction, ticketKey: string): boolean {
  if (value.result === null || typeof value.result !== 'object' || Array.isArray(value.result)) return false;
  if ('applied' in value.result && value.result.applied === true) return true;
  return 'keys' in value.result && Array.isArray(value.result.keys) && value.result.keys.includes(ticketKey);
}

export async function dispatchPublicCiRun(
  input: {
    prisma: ProjectAdminPrisma;
    workspaceId: string;
    userId: string;
    projectId: string;
    ticketKey: string;
    trigger: string;
    clientRequestId: string;
    //? Which monorepo unit this run tests. `null`/absent = the project root, which is what a single-unit
    //? repo always is — so every existing caller keeps its exact behaviour.
    serviceId?: string | null;
    servicePath?: string | null;
  },
  dependencies?: PublicCiRunDependencies,
): Promise<PublicCiDispatchResult> {
  const deps = dependencies ?? defaultPublicCiRunDependencies();
  //? RBAC comes first: a denied caller cannot read the repo, start Docker, or spend CI capacity.
  if (!(await deps.authorize(input.prisma, input.workspaceId, input.userId))) return { ok: false, errorCode: 'auth.forbidden' };
  const target = await deps.resolve(input.prisma, input.workspaceId, input.projectId, input.ticketKey);
  if (!target) return { ok: false, errorCode: 'sync.invalidRequest' };

  //? Prepare/dedup happens BEFORE Docker and authorizes only an immutable intent. The
  //? intent is server-deterministic; terminal prepare replay reloads that durable intent
  //? instead of pretending the external execution already completed.
  //? Every id along this path is scoped to the UNIT. A fan-out sends one request per unit under a single
  //? user action, so an unscoped intent/signal/request id would make the second unit look like a replay of
  //? the first and its run would be dropped without a word.
  const serviceId = input.serviceId ?? null;
  const unitRequestId = `${input.clientRequestId}:${serviceId ?? 'root'}`;
  //? Derived from the UNIT-scoped request id, exactly as the Conductor derives them from the request id it
  //? receives. One source of uniqueness, so the two can never disagree.
  const intentId = ciPublicIntentId(input.workspaceId, target.projectId, unitRequestId);
  const prepareSignalId = ciPublicIntentSignalId(input.workspaceId, unitRequestId);
  const prepared = await deps.dispatch({
    op: 'ci-run',
    roomCode: input.workspaceId,
    userId: input.userId,
    prisma: input.prisma,
    clientRequestId: unitRequestId,
    target: { ticketId: target.ticketKey, projectId: target.projectId },
    payload: {
      phase: 'prepare',
      intentId,
      binding: {
        ticketId: target.ticketId,
        branch: target.branch,
        commitHash: target.commitHash,
        ...(target.mergeRequestId ? { mergeRequestId: target.mergeRequestId } : {}),
        trigger: input.trigger,
      },
    },
  });
  if (!prepared.ok) return prepared;
  const loadPrepared = deps.loadPrepared ?? loadPreparedPublicCiIntent;
  const intent = preparedPublicCiIntent(prepared.result, input.workspaceId)
    ?? await loadPrepared(input.prisma, input.workspaceId, prepareSignalId);
  const exactIntent = intent?.id === intentId
    && intent.signalId === prepareSignalId
    && intent.ticketId === target.ticketId
    && intent.ticketKey === target.ticketKey
    && intent.projectId === target.projectId
    && intent.branch === target.branch
    && intent.commitHash === target.commitHash
    && intent.mergeRequestId === target.mergeRequestId
    && intent.trigger === input.trigger;
  if (!intent || !exactIntent) return { ok: false, errorCode: 'sync.invalidRequest' };

  const claimExternal = deps.claimExternal ?? claimCiExternalExecution;
  const external = await claimExternal(intent.id);
  if (external.state === 'success') {
    //? Completion may have committed immediately before a process/broadcast crash. A terminal
    //? external replay must heal room clients instead of returning success with stale UI state.
    await tryCatch(() => deps.broadcast(input.prisma, input.workspaceId, [intent.ticketKey]));
    return { ok: true, result: { keys: [intent.ticketKey] } };
  }
  if (external.state === 'pending') return { ok: false, errorCode: 'ci.pending' };
  if (external.state !== 'claimed') return { ok: false, errorCode: 'sync.invalidRequest' };

  const abandonExternal = deps.abandonExternal ?? abandonCiExternalExecution;
  const acquireCapacity = deps.acquireCapacity ?? acquireSlot;
  const capacity = await acquireCapacity(`ci:${intent.id}`, input.workspaceId, false, Date.now());
  if (!capacity.acquired) {
    await abandonExternal(external.claim);
    return { ok: false, errorCode: capacity.reason === 'duplicate' ? 'ci.pending' : 'capacity.unavailable' };
  }

  const withCapacityRenewal = deps.withCapacityRenewal ?? withReservationRenewal;
  const withExternalRenewal = deps.withExternalRenewal ?? withCiExternalClaimRenewal;
  const [executionError, completed] = await tryCatch(() => withExternalRenewal(external.claim, (externalGuard) => (
    withCapacityRenewal(capacity.reservation, async (capacityGuard) => {
      await externalGuard.assertOwned();
      await capacityGuard.assertOwned();
      const report = readCanonicalCiReport(await deps.execute({ ...intent, serviceId, servicePath: input.servicePath ?? null }));
      if (report?.commitHash !== intent.commitHash) throw new Error('[ci] execution report does not match its prepared commit');
      await externalGuard.assertOwned();
      await capacityGuard.assertOwned();
      const observedHead = await deps.currentHead(input.prisma, intent);
      if (!/^[a-f\d]{40,64}$/i.test(observedHead)) throw new Error('[ci] current head is unavailable');
      const completion = await deps.complete({
        workspaceId: input.workspaceId,
        op: 'ci-public-complete',
        target: { ticketId: intent.ticketId, ticketKey: intent.ticketKey, projectId: intent.projectId, serviceId },
        payload: {
          intentId: intent.id,
          prepareSignalId: intent.signalId,
          branch: intent.branch,
          commitHash: intent.commitHash,
          observedHead,
          mergeRequestId: intent.mergeRequestId,
          trigger: intent.trigger,
          report,
        },
        userId: 'ci-runner',
        clientRequestId: `ci-public-complete:${intent.id}`,
      });
      if (!internalCompletionPersisted(completion, intent.ticketKey)) throw new Error('[ci] completion was not persisted');
      await externalGuard.assertOwned();
      await capacityGuard.assertOwned();
      return completion;
    })
  )));
  //? Owner-safe release is the finally-equivalent: it runs after success and every
  //? captured failure, and an expired owner can never free a successor reservation.
  const releaseCapacity = deps.releaseCapacity ?? releaseSlot;
  await releaseCapacity(capacity.reservation);
  if (executionError || !completed) {
    await abandonExternal(external.claim);
    return { ok: false, errorCode: 'sync.invalidRequest' };
  }
  const completeExternal = deps.completeExternal ?? completeCiExternalExecution;
  if (!(await completeExternal(external.claim))) return { ok: false, errorCode: 'sync.invalidRequest' };
  //? Broadcast is post-commit delivery, not part of CI durability. Failure is healed by the
  //? terminal replay branch above and must not turn a persisted completion into a false failure.
  await tryCatch(() => deps.broadcast(input.prisma, input.workspaceId, [intent.ticketKey]));
  return { ok: true, result: completed.result };
}

//? Per-service CI: one user action runs EVERY unit of the project, because "is this MR green?" is a
//? question about the whole change, not about whichever unit someone remembered to click. A monorepo
//? otherwise needs N clicks to turn one MR green, and forgetting one is indistinguishable from passing.
//?
//? Each unit gets its own durable intent, its own container at the same commit, and its own PipelineRun —
//? so a red unit is attributable, retryable on its own, and cannot be masked by a green sibling.
//?
//? A project with no Service rows resolves to exactly one unit (the root), which is the pre-existing
//? behaviour byte for byte: a single-unit repo pays nothing for this.
export async function dispatchPublicCiRunAllUnits(
  input: {
    prisma: ProjectAdminPrisma;
    workspaceId: string;
    userId: string;
    projectId: string;
    ticketKey: string;
    trigger: string;
    clientRequestId: string;
    //? Narrow the fan-out to ONE unit — the per-service retry button on the MR panel.
    onlyServiceId?: string | null;
  },
  dependencies?: PublicCiRunDependencies,
): Promise<PublicCiDispatchResult> {
  const services = input.onlyServiceId === undefined
    ? await input.prisma.service.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId }, select: { id: true, path: true } })
    : await input.prisma.service.findMany({ where: { workspaceId: input.workspaceId, projectId: input.projectId, id: input.onlyServiceId ?? '' }, select: { id: true, path: true } });

  //? The root unit runs whenever the whole project was asked for, or when the caller explicitly asked for
  //? it (`onlyServiceId: null`). It is not skipped just because services exist: a monorepo root commonly
  //? carries its own lint/typecheck job.
  const units: { serviceId: string | null; servicePath: string | null }[] = [];
  if (input.onlyServiceId === undefined || input.onlyServiceId === null) units.push({ serviceId: null, servicePath: null });
  for (const service of services) units.push({ serviceId: service.id, servicePath: service.path });

  //? Sequential, not parallel: each unit launches its own container at the same commit, and a monorepo
  //? firing N Docker builds at once is how a dev box falls over. CI capacity is reserved per unit anyway.
  let lastFailure: PublicCiDispatchResult | null = null;
  let anySucceeded = false;
  const keys: string[] = [];
  for (const unit of units) {
    const result = await dispatchPublicCiRun({ ...input, serviceId: unit.serviceId, servicePath: unit.servicePath }, dependencies);
    if (result.ok) {
      anySucceeded = true;
      const resultKeys = result.result !== undefined && result.result !== null && typeof result.result === 'object' && 'keys' in result.result && Array.isArray(result.result.keys) ? result.result.keys : [];
      for (const key of resultKeys) if (typeof key === 'string' && !keys.includes(key)) keys.push(key);
      continue;
    }
    //? A unit with no ci.yml is not a failure — CI is opt-in per unit, and a monorepo where only one
    //? service has a pipeline is the normal case, not an error.
    lastFailure = result;
  }
  //? Report failure only when NOTHING ran: a partial fan-out already produced attributable per-unit runs,
  //? and the gates read those rows rather than this return value.
  if (!anySucceeded && lastFailure) return lastFailure;
  return { ok: true, result: { keys } };
}

export async function dispatchForgeResync(
  input: {
    prisma: ProjectAdminPrisma;
    workspaceId: string;
    userId: string;
    projectId: string;
    clientRequestId: string;
  },
  dependencies?: ForgeResyncDependencies,
): Promise<DispatchSyncResult> {
  const deps = dependencies ?? defaultForgeResyncDependencies();
  //? The explicit pre-fetch check prevents an unauthorized caller from spending
  //? forge quota or probing connectivity. dispatch re-checks RBAC before apply.
  const allowed = await deps.authorize(input.prisma, input.workspaceId, input.userId);
  if (!allowed) return { ok: false, errorCode: 'auth.forbidden' };

  const fetched = await deps.fetchSnapshot(input.prisma, input.workspaceId, input.projectId);
  if (!fetched.ok) return { ok: false, errorCode: 'sync.invalidRequest' };
  const dispatched = await deps.dispatch({
    op: 'gitlab-resync',
    roomCode: input.workspaceId,
    userId: input.userId,
    prisma: input.prisma,
    clientRequestId: input.clientRequestId,
    target: { projectId: input.projectId },
    payload: { snapshot: fetched.snapshot },
  });
  if (!dispatched.ok) return dispatched;
  const keys = forgeTouchedKeys(dispatched.result);
  if (keys.length > 0) await deps.broadcast(input.prisma, input.workspaceId, keys);
  return dispatched;
}

export const main = async ({ clientInput, user, functions, roomCode }: SyncParams): Promise<SyncServerResponse> => {
  const { op, clientRequestId, projectId, serviceId, envId, ...payload } = clientInput;
  if (!isProjectAdminOp(op)) return { status: 'error', errorCode: 'sync.invalidRequest' };

  if (op === 'ci-run') {
    const ticketKey = typeof payload.ticketKey === 'string' ? payload.ticketKey : '';
    if (!projectId || ticketKey.length === 0) return { status: 'error', errorCode: 'sync.invalidRequest' };
    //? No `serviceId` on the request = run every unit (the MR button); an explicit one = the per-unit
    //? retry. `serviceId` was already destructured off the input here and then dropped on the floor.
    const [ciError, ciRun] = await functions.tryCatch.tryCatch(() => dispatchPublicCiRunAllUnits({
      prisma: functions.db.prisma,
      workspaceId: roomCode,
      userId: user.id,
      projectId,
      ticketKey,
      trigger: typeof payload.trigger === 'string' ? payload.trigger : 'manual',
      clientRequestId,
      ...(serviceId === undefined ? {} : { onlyServiceId: serviceId }),
    }));
    if (ciError || !ciRun) return { status: 'error', errorCode: 'sync.invalidRequest' };
    if (!ciRun.ok) return { status: 'error', errorCode: ciRun.errorCode };
    return { status: 'success' };
  }

  if (op === 'gitlab-resync') {
    if (!projectId) return { status: 'error', errorCode: 'sync.invalidRequest' };
    const [resyncError, resync] = await functions.tryCatch.tryCatch(() => dispatchForgeResync({
      prisma: functions.db.prisma,
      workspaceId: roomCode,
      userId: user.id,
      projectId,
      clientRequestId,
    }));
    if (resyncError || !resync) return { status: 'error', errorCode: 'sync.invalidRequest' };
    if (!resync.ok) return { status: 'error', errorCode: resync.errorCode };
    return { status: 'success' };
  }

  const result = await dispatchControlSync({
    op,
    roomCode,
    userId: user.id,
    prisma: functions.db.prisma,
    clientRequestId,
    target: {
      ...(projectId ? { projectId } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(envId ? { envId } : {}),
    },
    payload,
  });
  if (!result.ok) return { status: 'error', errorCode: result.errorCode };
  return { status: 'success' };
};
