//? Shared proxy recovery job. Cron supplies cluster leadership and a cross-run Redis lease, so
//? concurrent backend boots cannot reconcile Caddy/environment routes more than once.

import { tryCatch } from '@luckystack/core';
import type { CronJobDefinition } from '@luckystack/cron';

import { reassertEnvironmentRoutes } from '../deploy/environment';
import { reconcileProxyRoutesOnBoot } from './reconcileOnBoot';

export const PROXY_ROUTE_RECONCILIATION_JOB = 'proxy-route-reconciliation';
export const PROXY_ROUTE_RECONCILIATION_INTERVAL_MS = 5 * 60_000;

type ReconcileProxyRoutes = () => Promise<unknown>;
type ReassertEnvironmentRoutes = () => Promise<unknown>;

interface ProxyRouteReconciliationDependencies {
  reconcileProxyRoutes: ReconcileProxyRoutes;
  reassertEnvironmentRoutes: ReassertEnvironmentRoutes;
}

const defaultDependencies: ProxyRouteReconciliationDependencies = {
  reconcileProxyRoutes: reconcileProxyRoutesOnBoot,
  reassertEnvironmentRoutes,
};

//? The handler tries both recovery legs even when one fails. Cron captures the resulting failure,
//? while its leader election plus per-run lease prevents duplicate boot recovery across instances.
export function createProxyRouteReconciliationJob(
  dependencies: ProxyRouteReconciliationDependencies = defaultDependencies,
): CronJobDefinition {
  return {
    name: PROXY_ROUTE_RECONCILIATION_JOB,
    schedule: { everyMs: PROXY_ROUTE_RECONCILIATION_INTERVAL_MS },
    runOnStart: true,
    handler: async () => {
      const [proxyError] = await tryCatch(dependencies.reconcileProxyRoutes);
      if (proxyError) console.error('[proxy] reconciliation error:', proxyError);

      const [environmentError] = await tryCatch(dependencies.reassertEnvironmentRoutes);
      if (environmentError) console.error('[env] route re-assert error:', environmentError);

      if (proxyError) throw proxyError;
      if (environmentError) throw environmentError;
    },
  };
}
