//? Control ACK regression: internal Conductor failures never become success responses,
//? while dedup, successful void actions, and both serial queues remain usable.

import { tryCatch } from '@luckystack/core';

import type { WorkspaceLeaseGuard } from '../../server/orchestrator/cluster.ts';

import { db, cleanupWorkspace, assert, eq, report } from '../_helpers.mts';

const prisma = await db();
const { dispatchControlSync } = await import('../../server/control/dispatchSync');
const { enqueueControlAction, ControlActionEnqueueError } = await import('../../server/orchestrator/conductor');
const { WorkspaceLeaseLostError } = await import('../../server/orchestrator/cluster');
const { createBlankWorkspace } = await import('../../server/bootstrap/seedWorkspace');

const stamp = Date.now();
const owner = await prisma.user.create({ data: { email: `control-ack-owner-${String(stamp)}@youcomm.nl`, name: 'Control ACK owner' } });
const invitee = await prisma.user.create({ data: { email: `control-ack-invitee-${String(stamp)}@youcomm.nl`, name: 'Control ACK invitee' } });
let workspaceId: string | null = null;
const requestId = (suffix: string): string => `control-ack-${String(stamp)}-${suffix}`;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const [runError] = await tryCatch(async () => {
  const created = await createBlankWorkspace(prisma, owner.id, 'Control ACK WS');
  workspaceId = created.workspaceId;
  const wsId = created.workspaceId;

  // executeAction can reject semantically without throwing. That result must be an
  // invalid-request ACK, with no internal error identifier exposed.
  const semanticFailureId = requestId('semantic-failure');
  const semanticFailure = await dispatchControlSync({
    op: 'role-update', roomCode: wsId, userId: owner.id, prisma,
    target: { roleKey: 'member' }, payload: { label: 'Must stay immutable' },
    clientRequestId: semanticFailureId,
  });
  eq(semanticFailure, { ok: false, errorCode: 'sync.invalidRequest' }, 'an executeAction { ok:false } result becomes sync.invalidRequest');
  const replayedSemanticFailure = await dispatchControlSync({
    op: 'role-update', roomCode: wsId, userId: owner.id, prisma,
    target: { roleKey: 'member' }, payload: { label: 'Must stay immutable' },
    clientRequestId: semanticFailureId,
  });
  eq(replayedSemanticFailure, semanticFailure, 'the exact semantic-failure id replays failure instead of blind success');

  // A legitimate void action is still successful.
  const voidSuccess = await dispatchControlSync({
    op: 'mark-read', roomCode: wsId, userId: owner.id, prisma,
    target: { all: true }, clientRequestId: requestId('void-success'),
  });
  assert(voidSuccess.ok && voidSuccess.result === undefined, 'a successful void action remains successful');

  // Re-sending the same idempotency key remains a benign success.
  const dedupId = requestId('dedup');
  const first = await dispatchControlSync({ op: 'mark-read', roomCode: wsId, userId: owner.id, prisma, target: { all: true }, clientRequestId: dedupId });
  const duplicate = await dispatchControlSync({ op: 'mark-read', roomCode: wsId, userId: owner.id, prisma, target: { all: true }, clientRequestId: dedupId });
  assert(first.ok && duplicate.ok, 'a terminal-success duplicate remains a benign success');

  // A concurrent duplicate must wait for the pending owner; it may never return blind success.
  const pendingId = requestId('pending-success');
  let markLeaseEntered: () => void = () => undefined;
  let releaseLeaseRunner: () => void = () => undefined;
  const leaseEntered = new Promise<void>((resolve) => { markLeaseEntered = resolve; });
  const leaseGate = new Promise<void>((resolve) => { releaseLeaseRunner = resolve; });
  const heldController = new AbortController();
  const heldGuard: WorkspaceLeaseGuard = { signal: heldController.signal, assertHeld: () => undefined };
  const delayedLease = async <T>(
    _workspaceId: string,
    fn: (guard: WorkspaceLeaseGuard) => Promise<T>,
  ): Promise<T> => {
    markLeaseEntered();
    await leaseGate;
    return fn(heldGuard);
  };
  const pendingOwner = enqueueControlAction({
    workspaceId: wsId, op: 'mark-read', target: { all: true }, payload: {},
    userId: owner.id, clientRequestId: pendingId,
  }, { workspaceLease: delayedLease });
  await leaseEntered;
  let pendingDuplicateSettled = false;
  const pendingDuplicate = dispatchControlSync({
    op: 'mark-read', roomCode: wsId, userId: owner.id, prisma,
    target: { all: true }, clientRequestId: pendingId,
  }).then((outcome) => {
    pendingDuplicateSettled = true;
    return outcome;
  });
  await sleep(80);
  assert(!pendingDuplicateSettled, 'a duplicate does not report success while its owner is pending');
  releaseLeaseRunner();
  const [pendingOwnerError] = await tryCatch(() => pendingOwner);
  assert(pendingOwnerError === null, 'the pending owner completes successfully after its lease gate opens');
  assert((await pendingDuplicate).ok, 'the waiting duplicate replays the terminal success benignly');

  // A duplicate built-in role reaches Prisma and throws inside executeAction. Its exact id must
  // replay the scrubbed failure without executing again.
  const executeFailureId = requestId('execute-throw');
  const [executeError, executeResult] = await tryCatch(() => enqueueControlAction({
    workspaceId: wsId, op: 'role-create', target: {},
    payload: { key: 'member', label: 'Duplicate', perms: [] },
    userId: owner.id, clientRequestId: executeFailureId,
  }));
  assert(
    executeError instanceof ControlActionEnqueueError
      && executeError.code === 'control.executionFailure'
      && executeResult === null,
    'a thrown executeAction error rejects with a stable execution-failure code',
  );

  const mappedExecuteFailure = await dispatchControlSync({
    op: 'role-create', roomCode: wsId, userId: owner.id, prisma,
    payload: { key: 'member', label: 'Must not execute again', perms: [] },
    clientRequestId: executeFailureId,
  });
  eq(mappedExecuteFailure, { ok: false, errorCode: 'sync.invalidRequest' }, 'the exact thrown-failure id replays scrubbed failure');

  const afterExecuteFailure = await dispatchControlSync({
    op: 'mark-read', roomCode: wsId, userId: owner.id, prisma,
    target: { all: true }, clientRequestId: requestId('after-execute-failure'),
  });
  assert(afterExecuteFailure.ok, 'the workspace queue remains usable after an execute failure');

  // Inject a lease rejection so this regression stays cheap (no 8-second production timeout).
  // The default runner is still the real withWorkspaceLease; only this call uses the fixture.
  const leaseFailureId = requestId('lease-failure');
  const rejectLease = async <T>(
    _workspaceId: string,
    _fn: (guard: WorkspaceLeaseGuard) => Promise<T>,
  ): Promise<T> => {
    throw new Error('injected workspace-lease failure');
  };
  const [leaseError, leaseResult] = await tryCatch(() => enqueueControlAction({
    workspaceId: wsId, op: 'mark-read', target: { all: true }, payload: {},
    userId: owner.id, clientRequestId: leaseFailureId,
  }, { workspaceLease: rejectLease }));
  assert(
    leaseError instanceof ControlActionEnqueueError
      && leaseError.code === 'control.executionFailure'
      && leaseResult === null,
    'an injected lease failure rejects with the stable execution-failure code',
  );
  const replayedLeaseFailure = await dispatchControlSync({
    op: 'mark-read', roomCode: wsId, userId: owner.id, prisma,
    target: { all: true }, clientRequestId: leaseFailureId,
  });
  eq(replayedLeaseFailure, { ok: false, errorCode: 'sync.invalidRequest' }, 'the exact lease-failure id replays failure');

  const afterLeaseFailure = await dispatchControlSync({
    op: 'mark-read', roomCode: wsId, userId: owner.id, prisma,
    target: { all: true }, clientRequestId: requestId('after-lease-failure'),
  });
  assert(afterLeaseFailure.ok, 'the workspace queue remains usable after a lease failure');

  // The Conductor checks the renewable guard before seq, signal append, execute, and successful
  // completion. Inject loss at each boundary so ordering and the fail-closed ACK are observable.
  const signalExists = async (clientRequestId: string): Promise<boolean> => {
    const signals = await prisma.workspaceSignal.findMany({
      where: { workspaceId: wsId, kind: 'rename-workspace' },
      select: { payload: true },
    });
    return signals.some(({ payload }) => {
      if (typeof payload !== 'object' || payload === null || !('clientRequestId' in payload)) return false;
      return payload.clientRequestId === clientRequestId;
    });
  };
  const verifyLeaseBoundary = async (
    assertToLose: number,
    suffix: string,
    expectSignal: boolean,
    expectExecute: boolean,
  ): Promise<void> => {
    const clientRequestId = requestId(`lease-boundary-${suffix}`);
    const attemptedName = `Lease boundary ${suffix}`;
    const beforeName = (await prisma.workspace.findUnique({ where: { id: wsId }, select: { name: true } }))?.name;
    let assertions = 0;
    const controller = new AbortController();
    const boundaryLease = async <T>(
      guardedWorkspaceId: string,
      fn: (guard: WorkspaceLeaseGuard) => Promise<T>,
    ): Promise<T> => {
      const guard: WorkspaceLeaseGuard = {
        signal: controller.signal,
        assertHeld: (): void => {
          assertions += 1;
          if (assertions !== assertToLose) return;
          const loss = new WorkspaceLeaseLostError(guardedWorkspaceId, 'renewal-failed');
          controller.abort(loss);
          throw loss;
        },
      };
      return fn(guard);
    };
    const [boundaryError, boundaryResult] = await tryCatch(() => enqueueControlAction({
      workspaceId: wsId, op: 'rename-workspace', target: {}, payload: { name: attemptedName },
      userId: owner.id, clientRequestId,
    }, { workspaceLease: boundaryLease }));
    assert(
      boundaryError instanceof ControlActionEnqueueError
        && boundaryError.code === 'control.executionFailure'
        && boundaryResult === null,
      `lease loss at boundary ${suffix} fails the caller closed`,
    );
    eq(assertions, assertToLose, `lease boundary ${suffix} is checked before later work can start`);
    eq(await signalExists(clientRequestId), expectSignal, `lease boundary ${suffix} has the expected durable-signal state`);
    const afterName = (await prisma.workspace.findUnique({ where: { id: wsId }, select: { name: true } }))?.name;
    eq(afterName, expectExecute ? attemptedName : beforeName, `lease boundary ${suffix} has the expected execute state`);
  };

  await verifyLeaseBoundary(1, 'before-seq', false, false);
  await verifyLeaseBoundary(2, 'before-signal', false, false);
  await verifyLeaseBoundary(3, 'before-execute', true, false);
  await verifyLeaseBoundary(4, 'before-success', true, true);

  const recoveredName = 'Queue recovered after lease loss';
  const recoveredAfterBoundaryLoss = await enqueueControlAction({
    workspaceId: wsId, op: 'rename-workspace', target: {}, payload: { name: recoveredName },
    userId: owner.id, clientRequestId: requestId('after-boundary-loss'),
  });
  assert(recoveredAfterBoundaryLoss.signalSeq > 0, 'the workspace queue accepts a later action after boundary lease loss');
  eq((await prisma.workspace.findUnique({ where: { id: wsId } }))?.name, recoveredName, 'the recovered workspace queue executes the later action');

  // The login-only global chain follows the same rule: a duplicate membership throws,
  // then a different pending invite still succeeds on the recovered chain.
  const failedInviteToken = requestId('failed-invite-token');
  const validInviteToken = requestId('valid-invite-token');
  await prisma.invite.createMany({ data: [
    { workspaceId: wsId, email: owner.email, roleKey: 'member', invitedById: owner.id, token: failedInviteToken, status: 'pending' },
    { workspaceId: wsId, email: invitee.email, roleKey: 'member', invitedById: owner.id, token: validInviteToken, status: 'pending' },
  ] });
  const [globalError, globalResult] = await tryCatch(() => enqueueControlAction({
    workspaceId: '', op: 'accept-invite', target: { inviteToken: failedInviteToken }, payload: {},
    userId: owner.id, clientRequestId: requestId('global-failure'),
  }));
  assert(globalError !== null && globalResult === null, 'a global-chain execute error rejects enqueueControlAction');

  const recoveredGlobal = await enqueueControlAction({
    workspaceId: '', op: 'accept-invite', target: { inviteToken: validInviteToken }, payload: {},
    userId: invitee.id, clientRequestId: requestId('global-recovery'),
  });
  assert(recoveredGlobal.result === undefined, 'the recovered global queue accepts a successful void action');
  assert(await prisma.workspaceMember.findFirst({ where: { workspaceId: wsId, userId: invitee.id } }) !== null, 'the global action after the failure was executed');
});

if (runError) assert(false, `unexpected control ACK test error: ${runError.message}`);
if (workspaceId) await cleanupWorkspace(prisma, workspaceId, [owner.id, invitee.id]).catch(() => undefined);
else await prisma.user.deleteMany({ where: { id: { in: [owner.id, invitee.id] } } }).catch(() => undefined);

report('tests/integration/controlAck.test.mts');
