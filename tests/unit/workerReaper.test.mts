//? Worker-reaper regressions: exact cross-tenant container identity, Redis-shaped shared
//? idle clock across alternating cron leaders, editor/status revalidation, and failed stop.

import { assert, eq, report } from '../_helpers.mts';
import type { WorkerContainerIdentity } from '../../server/container/runtime.ts';
import type { WorkerReapDeps, WorkerReapTarget } from '../../server/orchestrator/workerReaper.ts';

process.env.WS_WORKER_IDLE_MIN = '20';
const { reapIdleWorkers, workerContainerIdentity } = await import('../../server/orchestrator/workerReaper.ts');
const TTL = 20 * 60_000;
const t0 = 1_000_000_000_000;

function worker(workspaceId: string, projectId: string, containerId: string, name: string): WorkerContainerIdentity {
  return { workspaceId, projectId, ticketKey: 'DEV-1', containerId, name };
}

function targetFor(value: WorkerContainerIdentity): WorkerReapTarget {
  return {
    target: { ticketId: `${value.workspaceId}-ticket`, ticketKey: value.ticketKey, projectId: value.projectId, stageId: 'code', sessionId: `${value.containerId}-session` },
    expected: {
      ticketStatus: 'needs-input',
      needsInputHash: 'a'.repeat(64),
      sessionStatus: 'busy',
      containerId: value.containerId,
      runToken: `${value.containerId}-token`,
      runFence: 3,
      startedAt: t0 - 1000,
    },
  };
}

function createDeps(input: {
  workers: WorkerContainerIdentity[];
  sharedIdle: Map<string, number>;
  targets?: Set<string>;
  editors?: Set<string>;
  editorFailures?: Set<string>;
  recovery?: Map<string, 'ok' | 'race' | 'docker'>;
  calls: string[];
}): WorkerReapDeps {
  const targets = input.targets ?? new Set(input.workers.map(workerContainerIdentity));
  const editors = input.editors ?? new Set<string>();
  return {
    listWorkers: async () => input.workers,
    loadTarget: async (value) => targets.has(workerContainerIdentity(value)) ? targetFor(value) : null,
    hasConnectedEditor: async (value) => {
      const identity = workerContainerIdentity(value);
      return input.editorFailures?.has(identity) === true ? null : editors.has(identity);
    },
    idleSince: async (value, now) => {
      const identity = workerContainerIdentity(value);
      const current = input.sharedIdle.get(identity);
      if (current !== undefined) return current;
      input.sharedIdle.set(identity, now);
      return now;
    },
    clearIdle: async (value) => { input.sharedIdle.delete(workerContainerIdentity(value)); },
    recover: async (value) => {
      const identity = workerContainerIdentity(value);
      input.calls.push(identity);
      const outcome = input.recovery?.get(identity) ?? 'ok';
      return outcome === 'ok'
        ? { recovered: true, intentId: `${value.containerId}-intent` }
        : { recovered: false, reason: outcome };
    },
  };
}

try {
  // Alternating cron leaders share the host-global timestamp: B reaches the TTL started by A.
  {
    const value = worker('ws-a', 'project-a', 'container-a', 'worker-a');
    const sharedIdle = new Map<string, number>();
    const calls: string[] = [];
    const leaderA = createDeps({ workers: [value], sharedIdle, calls });
    const leaderB = createDeps({ workers: [value], sharedIdle, calls });
    eq((await reapIdleWorkers(t0, leaderA)).reaped.length, 0, 'leader A starts the shared idle clock');
    eq((await reapIdleWorkers(t0 + TTL - 1, leaderB)).reaped.length, 0, 'leader B preserves the prior clock within TTL');
    eq((await reapIdleWorkers(t0 + TTL, leaderA)).reaped, ['worker-a'], 'alternating instances still reap at one full shared TTL');
    eq(calls.length, 1, 'one recovery/stop is attempted');
  }

  // Identical ticket keys in two workspaces never collapse into one map entry.
  {
    const a = worker('ws-a', 'project-a', 'container-same-a', 'same-a');
    const b = worker('ws-b', 'project-b', 'container-same-b', 'same-b');
    const sharedIdle = new Map<string, number>();
    sharedIdle.set(workerContainerIdentity(a), t0);
    sharedIdle.set(workerContainerIdentity(b), t0);
    const calls: string[] = [];
    const targets = new Set([workerContainerIdentity(b)]);
    const result = await reapIdleWorkers(t0 + TTL, createDeps({ workers: [a, b], sharedIdle, targets, calls }));
    eq(result.reaped, ['same-b'], 'only the exact workspace/project/container identity is stopped');
    eq(calls, [workerContainerIdentity(b)], 'same DEV key in workspace A never selects workspace B by key');
  }

  // Editor and status races are revalidated and perform no stop.
  {
    const value = worker('ws-race', 'project-race', 'container-race', 'worker-race');
    const identity = workerContainerIdentity(value);
    const sharedIdle = new Map([[identity, t0]]);
    const calls: string[] = [];
    const editor = await reapIdleWorkers(t0 + TTL, createDeps({ workers: [value], sharedIdle, editors: new Set([identity]), calls }));
    eq(editor.reaped.length, 0, 'a connected editor cancels the reap before recovery prepare');
    eq(calls.length, 0, 'editor race sends no stop');

    sharedIdle.set(identity, t0);
    const status = await reapIdleWorkers(t0 + TTL, createDeps({ workers: [value], sharedIdle, targets: new Set(), calls }));
    eq(status.reaped.length, 0, 'ticket/session status change fails the exact target re-read');
    eq(calls.length, 0, 'status race sends no stop');

    sharedIdle.set(identity, t0);
    const probeFailure = await reapIdleWorkers(t0 + TTL, createDeps({ workers: [value], sharedIdle, editorFailures: new Set([identity]), calls }));
    eq(probeFailure.reaped.length, 0, 'an unavailable editor probe fails closed');
    assert(sharedIdle.has(identity), 'editor-probe failure preserves the shared idle age for retry');
    eq(calls.length, 0, 'editor-probe failure sends no stop');
  }

  // A Docker failure is not reported as reaped and the idle clock remains retryable.
  {
    const value = worker('ws-fail', 'project-fail', 'container-fail', 'worker-fail');
    const identity = workerContainerIdentity(value);
    const sharedIdle = new Map([[identity, t0]]);
    const calls: string[] = [];
    const recovery = new Map([[identity, 'docker' as const]]);
    const result = await reapIdleWorkers(t0 + TTL, createDeps({ workers: [value], sharedIdle, recovery, calls }));
    eq(result.reaped.length, 0, 'failed Docker stop never becomes a successful reap');
    assert(sharedIdle.has(identity), 'failed stop keeps the shared idle timestamp for a later retry');
  }
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/workerReaper.test.mts');
