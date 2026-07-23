import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { discoverNginxRoutes } from '../../server/proxy/reconcileOnBoot.ts';
import { renderRoute, resolveNginxRouteTarget } from '../../server/proxy/nginxProvider.ts';
import type { WorkerContainerIdentity } from '../../server/container/runtime.ts';

const identity: WorkerContainerIdentity = {
  workspaceId: '507f1f77bcf86cd799439011',
  projectId: '507f1f77bcf86cd799439012',
  ticketKey: 'DEV-42',
  containerId: 'container-42',
  name: 'ws-507f1f77bcf86cd799439011-dev-42',
};

const routes = await discoverNginxRoutes({
  dockerHealthy: async () => true,
  listContainers: async () => [identity, { ...identity, containerId: 'ref-container', name: `${identity.name}-ref-main` }],
  ticketBranch: async () => 'feature/DEV-42-recovery',
  portReady: async (_container, port) => port === 3000 || port === 5173,
});

assert.equal(routes.length, 2, 'one running canonical ticket container restores editor and preview routes');
assert.deepEqual(routes.map((route) => route.id).toSorted(), [
  'preview-507f1f77bcf86cd799439011-dev-42',
  'vscode-507f1f77bcf86cd799439011-dev-42',
]);
assert.ok(routes.every((route) => route.workspaceId === identity.workspaceId), 'every recovered route retains workspace ownership for edge auth');
assert.ok(routes.every((route) => route.target.startsWith(`${identity.name}:`)), 'recovery never points at a ref or foreign container');

const hostRoute = await resolveNginxRouteTarget(routes[0]!, async (container, network) => {
  assert.equal(container, identity.name);
  assert.equal(network, 'workspaces-net');
  return '172.30.0.42';
});
assert.equal(hostRoute?.target, '172.30.0.42:5173', 'host nginx receives a reachable bridge IP instead of an unresolvable Docker name');
assert.equal(await resolveNginxRouteTarget(routes[0]!, async () => null), null, 'route publication fails closed when the container has no proxy-network address');
const rendered = renderRoute({ ...hostRoute!, forwardAuth: '127.0.0.1:3003' });
assert.ok(rendered.includes('proxy_set_header Origin "";') && rendered.includes('proxy_set_header Referer "";'), 'trusted auth subrequests clear browser origin metadata before LuckyStack origin policy');
assert.ok(rendered.includes('proxy_pass http://172.30.0.42:5173;'), 'rendered host-nginx config uses the resolved bridge address');

const hostConfig = readFileSync('deploy/nginx/workspaces-app.conf', 'utf8');
assert.ok(hostConfig.includes('server_name *.workspace.keetlerop.nl;') && hostConfig.includes('return 404;'), 'unknown wildcard hosts fail closed instead of reaching an unrelated default vhost');

await assert.rejects(
  () => discoverNginxRoutes({
    dockerHealthy: async () => false,
    listContainers: async () => [],
    ticketBranch: async () => null,
    portReady: async () => false,
  }),
  /Docker unavailable/,
  'Docker failure aborts reconciliation instead of erasing the last good nginx config',
);

console.log('nginx route recovery unit tests passed');
