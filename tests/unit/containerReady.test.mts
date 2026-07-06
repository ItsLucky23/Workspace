//? Unit test for the container readiness probe (server/container/health, C2). No Docker — the probe
//? runner is injected. Verifies: returns true once the port answers (and stops polling), returns
//? false after exhausting attempts, and that `acceptAnyStatus` drops curl's `-f` (a token-gated 401
//? still counts as ready for the editor).

import { assert, eq, report } from '../_helpers.mts';

const { waitForContainerReady } = await import('../../server/container/health.ts');

// 1) becomes ready on the 3rd poll — loop stops there
{
  let calls = 0;
  const ready = await waitForContainerReady('c1', 5173, {
    attempts: 10, delayMs: 1,
    run: async () => { calls += 1; return { code: calls >= 3 ? 0 : 1 }; },
  });
  assert(ready, 'returns ready once the port answers');
  eq(calls, 3, 'stops polling as soon as it is ready');
}

// 2) never ready → false after exactly `attempts` polls (no infinite fire-and-forget)
{
  let calls = 0;
  const ready = await waitForContainerReady('c2', 5173, {
    attempts: 4, delayMs: 1,
    run: async () => { calls += 1; return { code: 1 }; },
  });
  assert(!ready, 'returns not-ready after exhausting attempts');
  eq(calls, 4, 'polled exactly `attempts` times');
}

// 3) default probe demands a healthy status (curl -f); acceptAnyStatus drops it
{
  let defaultCmd = '';
  await waitForContainerReady('c3', 3000, { attempts: 1, delayMs: 1, run: async (_c, cmd) => { defaultCmd = cmd; return { code: 0 }; } });
  assert(defaultCmd.includes('-fsS'), 'default probe uses curl -fsS (needs a 2xx/3xx)');

  let anyCmd = '';
  await waitForContainerReady('c3', 3000, { attempts: 1, delayMs: 1, acceptAnyStatus: true, run: async (_c, cmd) => { anyCmd = cmd; return { code: 0 }; } });
  assert(anyCmd.includes('-sS') && !anyCmd.includes('-fsS'), 'acceptAnyStatus drops -f (a 401 counts as bound)');
}

report('tests/unit/containerReady.test.mts');
