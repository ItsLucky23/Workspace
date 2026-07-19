//? Proxy boot recovery is scheduled through cron, not called by each server instance. Two concurrent
//? simulated instance calls share cron's per-run Redis lease, so only one reconciliation executes.

import { readFileSync } from 'node:fs';

import {
  clearCronJobsForTests,
  registerCronJob,
  resetCronSchedulerForTests,
  runCronJobNow,
  stopCronScheduler,
} from '@luckystack/cron';

import {
  createProxyRouteReconciliationJob,
  PROXY_ROUTE_RECONCILIATION_JOB,
} from '../../server/proxy/reconciliationJob.ts';
import { assert, db, eq, report } from '../_helpers.mts';

await db();
await stopCronScheduler();
resetCronSchedulerForTests();
clearCronJobsForTests();

let reconciliations = 0;
let environmentReassertions = 0;
let releaseReconciliation: (() => void) | null = null;
let markReconciliationStarted: (() => void) | null = null;
const reconciliationStarted = new Promise<void>((resolve) => { markReconciliationStarted = resolve; });
const reconciliationCanFinish = new Promise<void>((resolve) => { releaseReconciliation = resolve; });
const jobName = `${PROXY_ROUTE_RECONCILIATION_JOB}-${String(Date.now())}`;

registerCronJob({
  ...createProxyRouteReconciliationJob({
    reconcileProxyRoutes: async () => {
      reconciliations += 1;
      markReconciliationStarted?.();
      await reconciliationCanFinish;
    },
    reassertEnvironmentRoutes: async () => {
      environmentReassertions += 1;
    },
  }),
  name: jobName,
});

const firstInstanceRun = runCronJobNow(jobName);
await reconciliationStarted;
const secondInstanceRun = await runCronJobNow(jobName);
releaseReconciliation?.();
const firstInstanceResult = await firstInstanceRun;

assert(firstInstanceResult === null && secondInstanceRun === null, 'both simulated instance calls complete without scheduler errors');
eq(reconciliations, 1, 'the cross-run lease executes proxy reconciliation exactly once');
eq(environmentReassertions, 1, 'the successful reconciliation run re-asserts environment routes once');

await stopCronScheduler();
clearCronJobsForTests();

const serverSource = readFileSync(new URL('../../server/server.ts', import.meta.url), 'utf8');
assert(!serverSource.includes('reconcileProxyRoutesOnBoot'), 'server boot does not directly reconcile proxy routes');
assert(!serverSource.includes('reassertEnvironmentRoutes'), 'server boot does not directly re-assert environment routes');

report('tests/integration/proxyReconciliationCron.test.mts');
