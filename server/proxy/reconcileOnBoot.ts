//? Boot self-heal for proxy routes. Caddy owns durable route state through its Admin API; nginx's
//? generated include is rebuilt from the running, labelled ticket containers so app/controller restarts
//? neither lose live editor/preview routes nor retain routes to dead containers.

import { getPrismaClient, tryCatch } from '@luckystack/core';

import { docker, containerName, listRunningWorkerContainers, type WorkerContainerIdentity } from '../container/runtime';
import { waitForContainerReady } from '../container/health';
import { EDITOR_IN_CONTAINER_PORT } from '../container/editorServer';
import { editorRoute } from '../container/editorSession';
import { runInTenant } from '../tenant/tenantContext';
import { getProxyProvider, previewRoute, proxyKind, type ProxyRoute } from './index';

const CADDY_ADMIN = process.env.WS_CADDY_ADMIN ?? 'http://localhost:2019';
const CADDY_SERVER = process.env.WS_CADDY_SERVER ?? 'srv0';
const ID_PREFIX = 'ws-route-';
const PREVIEW_PORT = Number(process.env.WS_PREVIEW_PORT ?? '5173');

interface CaddyRoute { '@id'?: string; handle?: { upstreams?: { dial?: string }[] }[] }

export interface NginxRouteDiscoveryDependencies {
  dockerHealthy: () => Promise<boolean>;
  listContainers: () => Promise<WorkerContainerIdentity[]>;
  ticketBranch: (workspaceId: string, ticketKey: string) => Promise<string | null>;
  portReady: (containerName: string, port: number, acceptAnyStatus: boolean) => Promise<boolean>;
}

const defaultNginxDiscoveryDependencies: NginxRouteDiscoveryDependencies = {
  dockerHealthy: async () => {
    const result = await docker(['info']);
    return result.code === 0;
  },
  listContainers: listRunningWorkerContainers,
  ticketBranch: (workspaceId, ticketKey) => runInTenant(workspaceId, async () => {
    const ticket = await getPrismaClient().ticket.findFirst({ where: { workspaceId, key: ticketKey }, select: { branch: true } });
    return ticket?.branch ?? null;
  }),
  portReady: (name, port, acceptAnyStatus) => waitForContainerReady(name, port, { attempts: 1, delayMs: 0, acceptAnyStatus }),
};

export async function discoverNginxRoutes(
  dependencies: NginxRouteDiscoveryDependencies = defaultNginxDiscoveryDependencies,
): Promise<ProxyRoute[]> {
  if (!(await dependencies.dockerHealthy())) throw new Error('Docker unavailable during nginx route discovery');
  const live: ProxyRoute[] = [];
  for (const identity of await dependencies.listContainers()) {
    // Ref/time-travel containers have their own ephemeral route identity. They are deliberately not
    // reconstructed: only the canonical ticket container has a durable editor/preview contract.
    if (identity.name !== containerName(identity.workspaceId, identity.ticketKey)) continue;
    const branch = await dependencies.ticketBranch(identity.workspaceId, identity.ticketKey);
    if (!branch) continue;
    if (await dependencies.portReady(identity.name, PREVIEW_PORT, false)) {
      live.push(previewRoute({
        workspaceId: identity.workspaceId,
        ticketKey: identity.ticketKey,
        branch,
        containerName: identity.name,
        port: PREVIEW_PORT,
      }));
    }
    if (await dependencies.portReady(identity.name, EDITOR_IN_CONTAINER_PORT, true)) {
      live.push(editorRoute({
        workspaceId: identity.workspaceId,
        ticketKey: identity.ticketKey,
        branch,
        containerName: identity.name,
      }));
    }
  }
  return live;
}

//? Reconcile the selected provider. Best-effort on integration unavailability: preserving the last known-good
//? nginx include is safer than replacing it with an empty file when Docker or Mongo cannot be inspected.
export async function reconcileProxyRoutesOnBoot(): Promise<{ ok: boolean; pruned: string[] }> {
  const provider = getProxyProvider();
  if (!(await provider.available())) {
    console.log(`[proxy] boot-reconcile: ${proxyKind()} unavailable — skipped.`);
    return { ok: false, pruned: [] };
  }

  if (proxyKind() === 'nginx') {
    const [discoveryError, live] = await tryCatch(discoverNginxRoutes);
    if (discoveryError || !live) {
      console.error('[proxy] boot-reconcile: nginx discovery failed; preserving last good include.', discoveryError);
      return { ok: false, pruned: [] };
    }
    const result = await provider.reconcile(live);
    console.log(`[proxy] boot-reconcile: nginx restored ${String(live.length)} live route(s).`);
    return result;
  }

  const [fetchErr, res] = await tryCatch(() => fetch(`${CADDY_ADMIN}/config/apps/http/servers/${CADDY_SERVER}/routes`));
  if (fetchErr || !res?.ok) return { ok: false, pruned: [] };
  const [textErr, text] = await tryCatch(() => res.text());
  if (textErr || text === null) return { ok: false, pruned: [] };
  const [parseErr, routes] = await tryCatch(() => JSON.parse(text) as CaddyRoute[]);
  if (parseErr || routes === null) return { ok: false, pruned: [] };

  const ps = await docker(['ps', '--format', '{{.Names}}']);
  const alive = new Set(ps.out.split('\n').map((name) => name.trim()).filter((name) => name.length > 0));
  const pruned: string[] = [];
  for (const route of routes) {
    const id = route['@id'];
    if (!id?.startsWith(ID_PREFIX)) continue;
    const dial = route.handle?.[0]?.upstreams?.[0]?.dial ?? '';
    const container = dial.split(':')[0] ?? '';
    if (container.length > 0 && !alive.has(container)) {
      await provider.removeRoute(id.slice(ID_PREFIX.length));
      pruned.push(id);
    }
  }
  if (pruned.length > 0) console.log(`[proxy] boot-reconcile: pruned ${String(pruned.length)} stale route(s): ${pruned.join(', ')}`);
  return { ok: true, pruned };
}
