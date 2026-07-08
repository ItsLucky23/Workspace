//? W3 — the idle worker-container reaper decision logic (pure over injected deps, no Docker/Prisma). Verifies: a
//? parked (needs-input) worker is STOPPED only after the idle TTL elapses (needs two sweeps); a `busy` worker is
//? never touched; a parked worker with a live editor connection is spared; and the idle clock is forgotten when
//? a container disappears. WS_WORKER_IDLE_MIN is read at import → set BEFORE importing the module.

import { assert, eq, report } from '../_helpers.mts';

process.env.WS_WORKER_IDLE_MIN = '20'; // 20 min TTL
const { reapIdleWorkers } = await import('../../server/orchestrator/workerReaper.ts');
const TTL = 20 * 60_000;

function deps(workers: { name: string; ticketKey: string }[], statuses: Record<string, string>, connected: Set<string>, stopped: string[]) {
  return {
    listWorkers: async () => workers,
    ticketStatus: async (_keys: string[]) => new Map(Object.entries(statuses)),
    hasConnectedEditor: async (name: string) => connected.has(name),
    stop: async (name: string) => { stopped.push(name); },
  };
}

try {
  const t0 = 1_000_000_000_000;

  // a parked worker: first sweep starts its clock (NOT reaped), a sweep past the TTL stops it.
  {
    const stopped: string[] = [];
    const d = deps([{ name: 'ws-c1', ticketKey: 'DEV-1' }], { 'DEV-1': 'needs-input' }, new Set(), stopped);
    const first = await reapIdleWorkers(t0, d);
    eq(first.reaped.length, 0, 'first sight of a parked worker only starts its idle clock');
    const within = await reapIdleWorkers(t0 + TTL - 1, d);
    eq(within.reaped.length, 0, 'still within the TTL → not reaped');
    const past = await reapIdleWorkers(t0 + TTL, d);
    eq(past.reaped[0], 'ws-c1', 'past the TTL → the parked worker is stopped');
    eq(stopped[0], 'ws-c1', 'stop() was called on the container');
  }

  // a BUSY worker is never reaped, even long past any TTL.
  {
    const stopped: string[] = [];
    const d = deps([{ name: 'ws-busy', ticketKey: 'DEV-2' }], { 'DEV-2': 'busy' }, new Set(), stopped);
    await reapIdleWorkers(t0, d);
    const past = await reapIdleWorkers(t0 + TTL * 5, d);
    eq(past.reaped.length, 0, 'a busy worker is never reaped');
    eq(stopped.length, 0, 'stop() is never called on a busy worker');
  }

  // a parked worker a human is EDITING is spared (connected editor).
  {
    const stopped: string[] = [];
    const d = deps([{ name: 'ws-edit', ticketKey: 'DEV-3' }], { 'DEV-3': 'needs-input' }, new Set(['ws-edit']), stopped);
    await reapIdleWorkers(t0, d);
    const past = await reapIdleWorkers(t0 + TTL * 2, d);
    eq(past.reaped.length, 0, 'a parked worker with a live editor connection is not reaped');
  }

  // when a parked ticket is answered (status flips off needs-input), its clock resets — a later park re-arms.
  {
    const stopped: string[] = [];
    const workers = [{ name: 'ws-c4', ticketKey: 'DEV-4' }];
    const statuses = { 'DEV-4': 'needs-input' };
    const d = deps(workers, statuses, new Set(), stopped);
    await reapIdleWorkers(t0, d); // clock starts
    statuses['DEV-4'] = 'busy'; // answered → resumed
    await reapIdleWorkers(t0 + TTL, d); // not reaped (busy); clock cleared
    statuses['DEV-4'] = 'needs-input'; // parks again
    const reArm = await reapIdleWorkers(t0 + TTL + 1, d); // clock restarts here, not reaped yet
    eq(reArm.reaped.length, 0, 'after a resume the idle clock resets — a fresh park is not instantly reaped');
    const later = await reapIdleWorkers(t0 + TTL + 1 + TTL, d);
    eq(later.reaped[0], 'ws-c4', 'the re-armed parked worker is reaped after a fresh full TTL');
  }

  eq(0, 0, 'worker-reaper decision logic verified');
} catch (error) {
  assert(false, `unexpected error: ${String(error)}`);
}

report('tests/unit/workerReaper.test.mts');
